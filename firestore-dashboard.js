/************************************************************
 * firestore-dashboard.js (OPTIMIZED)
 * ----------------------------------------------------------
 * Goals:
 * - Prefetch latest assessment record from Firestore (best-effort)
 * - Normalize to a canonical local schema (schema-safe, legacy-safe)
 * - Cache to localStorage for:
 *   + Dashboard
 *   + Results
 *   + Charts / Trends
 *   + GateGuard
 *
 * Design principles:
 * - Fail-closed for Gate status (unknown => treat as blocked)
 * - Never crash UI: all errors are caught and logged
 * - Backward compatible:
 *   + ES module named export for <script type="module">
 *   + window.initFirestoreDashboardPrefetch for legacy callers
 ************************************************************/

"use strict";

/* =========================================================
   UTILS
   ========================================================= */

function safeJsonParse(raw) {
    try { return JSON.parse(raw); } catch { return null; }
}

function safeJsonSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) { console.warn("[firestore-dashboard] safeJsonSet failed:", key, e); }
}

function toISO(ts) {
    try {
        if (!ts) return null;
        if (typeof ts.toDate === "function") return ts.toDate().toISOString();           // Firestore Timestamp
        if (typeof ts === "object" && typeof ts.seconds === "number") return new Date(ts.seconds * 1000).toISOString();
        if (ts instanceof Date) return ts.toISOString();
        if (typeof ts === "string") {
            const d = new Date(ts);
            return Number.isNaN(d.getTime()) ? null : d.toISOString();
        }
        return null;
    } catch {
        return null;
    }
}

function pickQueryParam(name) {
    try {
        const url = new URL(window.location.href);
        return url.searchParams.get(name);
    } catch {
        return null;
    }
}

function pickAssessmentId() {
    const q = pickQueryParam("assessment_id");
    if (q && q.trim()) return q.trim();

    const s1 = sessionStorage.getItem("current_assessment_id");
    if (s1 && s1.trim()) return s1.trim();

    const s2 = sessionStorage.getItem("assessment_id");
    if (s2 && s2.trim()) return s2.trim();

    const l1 = localStorage.getItem("current_assessment_id");
    if (l1 && l1.trim()) return l1.trim();

    const l2 = localStorage.getItem("assessment_id");
    if (l2 && l2.trim()) return l2.trim();

    return null;
}

function pickShopId() {
    // 1) shop_info
    const shopInfoRaw = localStorage.getItem("shop_info");
    const shopInfo = shopInfoRaw ? safeJsonParse(shopInfoRaw) : null;
    const s0 = shopInfo?.shop_id || shopInfo?.shopId || shopInfo?.id;
    if (s0 && String(s0).trim()) return String(s0).trim();

    // 2) hard gate snapshot (session)
    const hardRaw = sessionStorage.getItem("validatedHardKO");
    const hard = hardRaw ? safeJsonParse(hardRaw) : null;
    const s1 = hard?.shopInfo?.shop_id || hard?.shopInfo?.shopId || hard?.shop_info?.shop_id;
    if (s1 && String(s1).trim()) return String(s1).trim();

    // 3) gate snapshot stored
    const gateRaw = localStorage.getItem("assessment_gate");
    const gate = gateRaw ? safeJsonParse(gateRaw) : null;
    const s2 = gate?.shop_id || gate?.shopId;
    if (s2 && String(s2).trim()) return String(s2).trim();

    return null;
}

/* =========================================================
   GATE NORMALIZATION (FAIL-CLOSED)
   ========================================================= */

function normalizeGateStatus(raw) {
    if (!raw) return "G0"; // fail-closed

    const v = String(raw).toUpperCase();
    if (v === "PASS") return "PASS";
    if (v === "G0" || v === "HARD_FAIL" || v === "HARD_KO" || v === "FAIL") return "G0";
    if (v === "G1" || v === "SOFT_PENDING" || v === "PENDING") return "G1";
    if (v === "G2" || v === "SOFT_OVERDUE" || v === "OVERDUE") return "G2";
    return "G0";
}

function extractGate(data) {
    const raw = data?.assessment_result?.gate || data?.gate_snapshot || data?.gate || data?.Gate || null;

    if (!raw || typeof raw !== "object") {
        return { gate_status: "G0", reason: "Missing gate", failed_rules: [] };
    }

    return {
        gate_status: normalizeGateStatus(raw.gate_status || raw.status),
        reason: raw.reason || raw.note || null,
        failed_rules: Array.isArray(raw.failed_rules) ? raw.failed_rules : (Array.isArray(raw.failed) ? raw.failed : []),
        soft: raw.soft || null,
        hard: raw.hard || null,
    };
}

function ensureResultShape(result, gate) {
    // Prefer MRSM payload if present; fallback to 0 when blocked
    const score =
        Number.isFinite(Number(result?.score)) ? Number(result.score)
            : Number.isFinite(Number(result?.totalScore)) ? Number(result.totalScore)
                : Number.isFinite(Number(result?.final_score)) ? Number(result.final_score)
                    : 0;

    const maxScore = Number.isFinite(Number(result?.max_score)) ? Number(result.max_score) : 100;

    const updatedAt = toISO(result?.updated_at || result?.computedAt || result?.computed_at) || new Date().toISOString();

    return {
        score,
        max_score: maxScore,
        gate_status: gate.gate_status,
        gate_reason: gate.reason || null,
        updated_at: updatedAt,
        // keep raw breakdown if present; consumers will adapt
        breakdown: result?.breakdown || result?.kpis || result?.results || result?.mrsm?.breakdown || null,
        tier: result?.tier || null,
        note: result?.note || result?.message || null,
    };
}

function ensureLegacyAssessmentData(raw) {
    if (!raw || typeof raw !== "object") return {};
    return {
        ...raw,
        assessment_result: raw.assessment_result || raw.result || raw.assessmentResult || {},
        shop_info: raw.shop_info || raw.shop || raw.shopInfo || {},
    };
}

function normalizeAssessmentRecord(doc) {
    const raw = ensureLegacyAssessmentData(doc);
    const gate = extractGate(raw);
    const result = ensureResultShape(raw.assessment_result, gate);

    return {
        assessment_id: raw.assessment_id || raw.assessmentId || doc.id || null,
        shop_id: raw.shop_id || raw.shopId || raw.shop_info?.shop_id || raw.shop_info?.shopId || null,
        shop_info: raw.shop_info || {},
        assessment_result: result,
        gate,
        created_at: toISO(raw.created_at) || toISO(raw.createdAt) || null,
        updated_at: toISO(raw.updated_at) || toISO(raw.updatedAt) || result.updated_at || null,
        // keep full raw snapshot for audit/debug (optional)
        __raw: raw,
    };
}

/* =========================================================
   FIRESTORE FETCH (best-effort)
   ========================================================= */

function mustHaveFirestore() {
    if (!window._firestore || !window._firestore_api) {
        throw new Error("Firestore not initialized (window._firestore / window._firestore_api missing)");
    }
}

async function fetchByUserAssessmentId(uid, assessmentId) {
    mustHaveFirestore();
    const { doc, getDoc } = window._firestore_api;
    if (typeof doc !== "function" || typeof getDoc !== "function") return null;

    const ref = doc(window._firestore, `users/${uid}/assessments/${assessmentId}`);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
}

async function fetchByGlobalAssessmentId(assessmentId) {
    mustHaveFirestore();
    const { doc, getDoc } = window._firestore_api;
    if (typeof doc !== "function" || typeof getDoc !== "function") return null;

    const ref = doc(window._firestore, `assessments/${assessmentId}`);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
}

async function fetchLatestByShopId(shopId) {
    mustHaveFirestore();
    const { collection, query, where, orderBy, limit, getDocs } = window._firestore_api;
    if (![collection, query, where, orderBy, limit, getDocs].every((fn) => typeof fn === "function")) return null;

    const q = query(
        collection(window._firestore, "assessments"),
        where("shop_id", "==", shopId),
        orderBy("updated_at", "desc"),
        limit(1)
    );

    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() };
}

/* =========================================================
   LOCAL CACHE (multi-consumer)
   ========================================================= */

function writeLocalSnapshot(record) {
    if (!record || typeof record !== "object") return;

    // Sticky current ids for navigation
    try {
        if (record.assessment_id) {
            sessionStorage.setItem("current_assessment_id", String(record.assessment_id));
            localStorage.setItem("current_assessment_id", String(record.assessment_id));
        }
        if (record.shop_id) {
            localStorage.setItem("current_shop_id", String(record.shop_id));
        }
    } catch (_) { }

    // Canonical keys used by dashboard.js / result.js
    safeJsonSet("assessment_record_local", record);
    safeJsonSet("assessment_record_latest", record);
    if (record.assessment_id) safeJsonSet(`assessment_record__${record.assessment_id}`, record);

    safeJsonSet("assessment_gate", record.gate || {});
    safeJsonSet("assessment_result", record.assessment_result || {});
    if (record.assessment_id) safeJsonSet(`assessment_result__${record.assessment_id}`, record.assessment_result || {});
}

/* =========================================================
   ENTRY POINT
   ========================================================= */

/**
 * initFirestoreDashboardPrefetch(options)
 * ----------------------------------------------------------
 * Best-effort prefetch:
 * 1) If assessment_id present:
 *    - try users/{uid}/assessments/{assessment_id} (if logged in)
 *    - else try assessments/{assessment_id}
 * 2) Else if shop_id available:
 *    - query latest assessments where shop_id == shop_id
 *
 * Returns:
 * - { ok: true, record } on success
 * - { ok: false, reason, error? } on failure
 */
export async function initFirestoreDashboardPrefetch(options = {}) {
    const assessmentId = String(options.assessmentId || pickAssessmentId() || "").trim() || null;
    const shopId = String(options.shopId || pickShopId() || "").trim() || null;

    // If no Firestore context, just exit (do not throw)
    if (!window._firestore || !window._firestore_api) {
        return { ok: false, reason: "firestore_not_initialized" };
    }

    try {
        let raw = null;

        if (assessmentId) {
            const uid = window._auth?.currentUser?.uid || null;
            if (uid) raw = await fetchByUserAssessmentId(uid, assessmentId);
            if (!raw) raw = await fetchByGlobalAssessmentId(assessmentId);
        }

        if (!raw && shopId) {
            raw = await fetchLatestByShopId(shopId);
        }

        if (!raw) {
            return { ok: false, reason: "no_firestore_data" };
        }

        const record = normalizeAssessmentRecord(raw);
        writeLocalSnapshot(record);

        return { ok: true, record };
    } catch (e) {
        console.error("[firestore-dashboard] Prefetch failed:", e);
        return { ok: false, reason: "prefetch_failed", error: String(e?.message || e) };
    }
}

// Backward-compat for non-module callers
try {
    window.initFirestoreDashboardPrefetch = initFirestoreDashboardPrefetch;
    window.normalizeAssessmentRecord = normalizeAssessmentRecord;
} catch (_) { }
