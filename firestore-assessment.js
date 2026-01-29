// firestore-assessment.js
// =====================================================
// CHỨC NĂNG TỔNG THỂ
// -----------------------------------------------------
// - Lưu assessment_result từ localStorage lên Firestore
// - Path lưu: users/{uid}/assessments/{assessmentId}
// - Áp dụng nguyên tắc FAIL-CLOSED:
//   + Nếu assessment đã có score
//   + Nhưng thiếu hard gate hoặc soft gate không PASS
//   => KHÔNG cho phép save
// - Lưu kèm metadata để audit và trace quyết định
// - Đồng bộ assessment_id giữa URL và sessionStorage
// =====================================================

import { db, auth } from "./firebase-init.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/**
 * safeParseJson
 * -----------------------------------------------------
 * Mục đích:
 * - Parse JSON từ localStorage / sessionStorage
 * - Tránh crash khi dữ liệu bị hỏng hoặc format sai
 *
 * Nguyên tắc:
 * - Parse lỗi => trả null
 * - Không có permissive default
 *
 * @param {string} raw
 * @returns {object|null}
 */
function safeParseJson(raw) {
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/**
 * getAssessmentId
 * -----------------------------------------------------
 * Mục đích:
 * - Lấy assessment_id nhất quán giữa các page
 * - Tránh lệch state khi reload / mở tab mới
 *
 * Thứ tự ưu tiên:
 * 1) URL query param (?assessment_id=)
 * 2) sessionStorage.current_assessment_id
 * 3) sessionStorage.assessment_id (legacy)
 *
 * @returns {string|null}
 */
function getAssessmentId() {
    const url = new URL(window.location.href);
    const qid = url.searchParams.get("assessment_id");
    if (qid && qid.trim()) return qid.trim();

    const sid1 = sessionStorage.getItem("current_assessment_id");
    if (sid1 && sid1.trim()) return sid1.trim();

    const sid2 = sessionStorage.getItem("assessment_id");
    if (sid2 && sid2.trim()) return sid2.trim();

    return null;
}

/**
 * getStorageResultFailClosed
 * -----------------------------------------------------
 * Mục đích:
 * - Lấy assessment_result đã tính toán từ localStorage
 * - Dùng cho integrity check trước khi save
 *
 * Đặc điểm:
 * - Không parse được => null
 * - Không tự tạo dữ liệu mặc định
 *
 * @returns {object|null}
 */
function getStorageResultFailClosed() {
    const resultKey =
        window.MRSM_CONFIG?.ASSESSMENT_RESULT_KEY || "assessment_result";

    const raw = localStorage.getItem(resultKey);
    return raw ? safeParseJson(raw) : null;
}

/**
 * getGateSnapshotFailClosed
 * -----------------------------------------------------
 * Mục đích:
 * - Lấy snapshot trạng thái gate tại thời điểm save
 * - Đảm bảo quyết định lưu là explainable
 *
 * Quy ước:
 * - Hard gate: sessionStorage
 * - Soft gate: localStorage
 *
 * Nguyên tắc:
 * - Không tồn tại / parse lỗi => null
 *
 * @returns {{hard: object|null, soft: object|null}}
 */
function getGateSnapshotFailClosed() {
    const hardKey =
        window.MRSM_CONFIG?.HARD_GATE_KEY || "validatedHardKO";
    const softKey =
        window.MRSM_CONFIG?.SOFT_GATE_KEY || "soft_ko_gate";

    const hardRaw = sessionStorage.getItem(hardKey);
    const softRaw = localStorage.getItem(softKey);

    const hard = hardRaw ? safeParseJson(hardRaw) : null;
    const soft = softRaw ? safeParseJson(softRaw) : null;

    return { hard, soft };
}

/**
 * computeIntegrityCheck
 * -----------------------------------------------------
 * Mục đích:
 * - Kiểm tra toàn vẹn logic trước khi cho phép save
 * - Áp dụng nguyên tắc fail-closed
 *
 * Logic:
 * - Nếu không có result => failed
 * - Nếu có score:
 *   + Bắt buộc có assessment_id
 *   + Bắt buộc có hard gate + verifiedAt
 *   + Bắt buộc soft gate PASS
 * - Nếu chưa có score:
 *   + Cho phép save (draft)
 *
 * @param {object|null} result
 * @param {{hard: object|null, soft: object|null}} gateSnapshot
 * @param {string|null} assessmentId
 * @returns {{integrity_check: string, integrity_reasons: string[]}}
 */
function computeIntegrityCheck(result, gateSnapshot, assessmentId) {
    const reasons = [];

    if (!result || typeof result !== "object") {
        return {
            integrity_check: "failed",
            integrity_reasons: ["missing_assessment_result"],
        };
    }

    const hasScore =
        result.totalScore !== undefined ||
        result.final_score !== undefined ||
        result.mrsm?.final_score !== undefined;

    if (!hasScore) {
        return {
            integrity_check: "skipped",
            integrity_reasons: [],
        };
    }

    if (!assessmentId) {
        reasons.push("missing_assessment_id");
    }

    const hard = gateSnapshot?.hard;
    if (!hard || typeof hard !== "object") {
        reasons.push("missing_hard_evidence");
    } else if (!hard.verifiedAt && !hard.verified_at) {
        reasons.push("hard_evidence_missing_verifiedAt");
    }

    const soft = gateSnapshot?.soft;
    if (!soft || typeof soft !== "object") {
        reasons.push("missing_soft_gate");
    } else if (
        String(soft.gate_status || "").toUpperCase() !== "PASS"
    ) {
        reasons.push("soft_gate_not_pass");
    }

    return {
        integrity_check: reasons.length ? "failed" : "passed",
        integrity_reasons: reasons,
    };
}

/**
 * saveAssessmentToFirestore
 * -----------------------------------------------------
 * Mục đích:
 * - Hàm public duy nhất để lưu assessment
 * - Được gọi ở RESULTS hoặc DASHBOARD
 *
 * Flow:
 * 1) Kiểm tra user đã login chưa
 * 2) Lấy assessment_id, result, gate snapshot
 * 3) Chạy integrity check
 * 4) Nếu failed => chặn save
 * 5) Build payload + metadata
 * 6) setDoc lên Firestore (merge)
 *
 * @returns {Promise<{ok: boolean, assessmentId?: string, error?: string, integrity?: any}>}
 */
export async function saveAssessmentToFirestore() {
    const user = auth.currentUser;
    if (!user) {
        return { ok: false, error: "not_authenticated" };
    }

    const assessmentId = getAssessmentId();
    const result = getStorageResultFailClosed();
    const gateSnapshot = getGateSnapshotFailClosed();

    const integrity = computeIntegrityCheck(
        result,
        gateSnapshot,
        assessmentId
    );

    if (integrity.integrity_check === "failed") {
        return {
            ok: false,
            error: "integrity_failed",
            integrity,
        };
    }

    if (!assessmentId) {
        return { ok: false, error: "missing_assessment_id" };
    }

    sessionStorage.setItem("current_assessment_id", assessmentId);
    sessionStorage.setItem("assessment_id", assessmentId);

    const appVersion =
        window.MRSM_CONFIG?.APP_VERSION || "unknown";
    const schemaVersion =
        window.MRSM_CONFIG?.SCHEMA_VERSION || "unknown";
    const computedAt =
        result?.computedAt || new Date().toISOString();

    const payload = {
        assessment_id: assessmentId,
        user_id: user.uid,

        schema_version: schemaVersion,
        app_version: appVersion,
        computed_at: computedAt,

        integrity_check: integrity.integrity_check,
        integrity_reasons: integrity.integrity_reasons,

        gate_snapshot: {
            hard: gateSnapshot.hard || null,
            soft: gateSnapshot.soft || null,
            gate_status: gateSnapshot.soft?.gate_status || null,
        },

        result: result || null,

        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
    };

    const ref = doc(
        db,
        "users",
        user.uid,
        "assessments",
        assessmentId
    );

    await setDoc(ref, payload, { merge: true });

    return { ok: true, assessmentId };
}
