/************************************************************
 * ----------------------------------------------------------
 * Mục tiêu:
 * - Fetch assessment mới nhất từ Firestore
 * - Chuẩn hóa dữ liệu (schema-safe, legacy-safe)
 * - Áp dụng logic Gate-based (FAIL-CLOSED)
 * - Cache dữ liệu cho:
 *   + Dashboard
 *   + Result page
 *   + Chart / Analytics
 *   + GateGuard
 ************************************************************/

"use strict";

/* =========================================================
   UTILS – HÀM TIỆN ÍCH CƠ BẢN
   ========================================================= */

/**
 * Chuẩn hóa mọi dạng timestamp về ISO string
 * ----------------------------------------------------------
 * Firestore có thể trả:
 * - Timestamp (ts.toDate)
 * - Object { seconds }
 * - String ISO
 * - Date object
 *
 * Nếu không parse được → return null
 * => tránh crash UI khi schema không đồng nhất
 */
function toISO(ts) {
    try {
        if (!ts) return null;

        // Firestore Timestamp
        if (typeof ts.toDate === "function") {
            return ts.toDate().toISOString();
        }

        // Firestore timestamp dạng { seconds }
        if (typeof ts === "object" && typeof ts.seconds === "number") {
            return new Date(ts.seconds * 1000).toISOString();
        }

        // Date object
        if (ts instanceof Date) {
            return ts.toISOString();
        }

        // ISO string
        if (typeof ts === "string") {
            const d = new Date(ts);
            return isNaN(d.getTime()) ? null : d.toISOString();
        }

        return null;
    } catch {
        return null;
    }
}


/**
 * Ghi JSON vào localStorage một cách an toàn
 * ----------------------------------------------------------
 * - Tự stringify
 * - Không làm crash flow nếu:
 *   + Quota exceeded
 *   + Circular structure
 */
function safeJSONSet(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        console.warn("[safeJSONSet] Failed:", key, e);
    }
}


/**
 * Lấy assessment_id theo thứ tự ưu tiên
 * ----------------------------------------------------------
 * 1. URL param (?assessment_id=...)
 * 2. sessionStorage
 * 3. localStorage
 *
 * → đảm bảo reload / mở tab mới vẫn giữ đúng assessment
 */
function pickAssessmentId() {
    try {
        const url = new URL(window.location.href);
        const q = url.searchParams.get("assessment_id");
        if (q && q.trim()) return q.trim();
    } catch { }

    const s1 = sessionStorage.getItem("assessment_id");
    if (s1 && s1.trim()) return s1.trim();

    const s2 = localStorage.getItem("assessment_id");
    if (s2 && s2.trim()) return s2.trim();

    return null;
}


/* =========================================================
   GATE LOGIC – CORE LOGIC (FAIL-CLOSED)
   ========================================================= */

/**
 * Chuẩn hóa trạng thái Gate về enum chuẩn
 * ----------------------------------------------------------
 * Các trạng thái hợp lệ:
 * - PASS
 * - G0  (Hard KO)
 * - G1  (Soft KO – pending)
 * - G2  (Soft KO – overdue)
 *
 * QUY TẮC CỐT LÕI:
 * - UNKNOWN / null / undefined → FAIL (fail-closed)
 */
function normalizeGateStatus(raw) {
    if (!raw) return "G0";

    const v = String(raw).toUpperCase();

    if (v === "PASS") return "PASS";
    if (v === "G0" || v === "HARD_FAIL") return "G0";
    if (v === "G1") return "G1";
    if (v === "G2") return "G2";

    // fail-closed
    return "G0";
}


/**
 * Trích xuất Gate từ nhiều schema khác nhau
 * ----------------------------------------------------------
 * Firestore có thể chứa:
 * - assessment_result.gate
 * - gate_snapshot
 * - gate
 * - legacy fields
 *
 * → luôn trả về object gate chuẩn
 */
function extractGate(data) {
    const raw =
        data?.assessment_result?.gate ||
        data?.gate_snapshot ||
        data?.gate ||
        null;

    if (!raw || typeof raw !== "object") {
        return {
            gate_status: "G0",
            reason: "Missing gate",
            failed_rules: []
        };
    }

    return {
        gate_status: normalizeGateStatus(raw.gate_status || raw.status),
        reason: raw.reason || null,
        failed_rules: Array.isArray(raw.failed_rules) ? raw.failed_rules : []
    };
}


/**
 * Đảm bảo result LUÔN có gate
 * ----------------------------------------------------------
 * Không cho phép:
 * - Có score nhưng không có gate
 * - Gate mơ hồ
 */
function ensureResultShape(result, gate) {
    return {
        score: typeof result?.score === "number" ? result.score : 0,
        max_score: result?.max_score || 100,
        gate_status: gate.gate_status,
        gate_reason: gate.reason || null,
        updated_at: toISO(result?.updated_at) || new Date().toISOString()
    };
}


/**
 * Adapter cho dữ liệu legacy
 * ----------------------------------------------------------
 * - Chuyển schema cũ → schema mới
 * - KHÔNG làm mất field cũ
 */
function ensureLegacyAssessmentData(raw) {
    if (!raw || typeof raw !== "object") return {};

    return {
        ...raw,
        assessment_result: raw.assessment_result || raw.result || {},
        shop_info: raw.shop_info || raw.shop || {}
    };
}


/* =========================================================
   NORMALIZE – CANONICAL ASSESSMENT RECORD
   ========================================================= */

/**
 * Chuẩn hóa Firestore document về record chuẩn
 * ----------------------------------------------------------
 * → đây là "single source of truth"
 */
function normalizeAssessmentRecord(doc) {
    const raw = ensureLegacyAssessmentData(doc);

    const gate = extractGate(raw);
    const result = ensureResultShape(raw.assessment_result, gate);

    return {
        assessment_id: raw.assessment_id || doc.id || null,
        shop_id: raw.shop_id || raw.shop_info?.shop_id || null,
        shop_info: raw.shop_info || {},
        assessment_result: result,
        gate,
        created_at: toISO(raw.created_at),
        updated_at: toISO(raw.updated_at)
    };
}


/* =========================================================
   HISTORY / TREND
   ========================================================= */

/**
 * Tạo history gọn cho list / timeline
 */
function buildAssessmentHistory(records) {
    return records.map(r => ({
        assessment_id: r.assessment_id,
        score: r.assessment_result.score,
        gate_status: r.gate.gate_status,
        date: r.updated_at || r.created_at
    }));
}


/**
 * History đầy đủ – phục vụ audit
 */
function buildAssessmentHistoryFull(records) {
    return records;
}


/**
 * Trend – so sánh score theo thời gian
 */
function buildAssessmentTrend(history) {
    return history.map(h => ({
        x: h.date,
        y: h.score,
        gate: h.gate_status
    }));
}


/* =========================================================
   FIRESTORE FETCH
   ========================================================= */

/**
 * Fetch assessment mới nhất của shop
 * ----------------------------------------------------------
 * - orderBy updated_at DESC
 * - fallback created_at
 */
async function fetchLatestAssessmentFromFirestore(shopId) {
    if (!window._firestore) {
        throw new Error("Firestore not initialized");
    }

    const { collection, query, where, orderBy, limit, getDocs } =
        window._firestore_api;

    const q = query(
        collection(window._firestore, "assessments"),
        where("shop_id", "==", shopId),
        orderBy("updated_at", "desc"),
        limit(1)
    );

    const snap = await getDocs(q);
    if (snap.empty) return null;

    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() };
}


/* =========================================================
   LOCAL CACHE – MULTI CONSUMER
   ========================================================= */

/**
 * Ghi snapshot vào localStorage
 * ----------------------------------------------------------
 * Các consumer dùng chung:
 * - dashboard.js
 * - result.js
 * - chart.js
 * - gate-guard.js
 */
function writeLocalSnapshot(payload) {
    safeJSONSet("assessment_record_local", payload);
    safeJSONSet("assessment_result", payload.assessment_result);
    safeJSONSet("assessment_gate", payload.gate);
}


/* =========================================================
   ENTRY POINT – CHỈ GỌI 1 LẦN
   ========================================================= */

/**
 * Init Firestore Dashboard
 * ----------------------------------------------------------
 * FLOW:
 * 1. Lấy assessment_id
 * 2. Normalize
 * 3. Cache local
 */
async function initFirestoreDashboardPrefetch() {
    const assessmentId = pickAssessmentId();
    if (!assessmentId) {
        console.warn("[Dashboard] Missing assessment_id");
        return;
    }

    try {
        const raw = await fetchLatestAssessmentFromFirestore(assessmentId);
        if (!raw) return;

        const record = normalizeAssessmentRecord(raw);
        writeLocalSnapshot(record);

        console.log("[Dashboard] Prefetch OK", record);
    } catch (e) {
        console.error("[Dashboard] Prefetch failed", e);
    }
}


// Expose để page gọi
window.initFirestoreDashboardPrefetch = initFirestoreDashboardPrefetch;
