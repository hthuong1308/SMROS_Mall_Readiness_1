/**
 * ============================================================
 * GATE-GUARD.JS (PHẦN A)
 * ============================================================
 * Vai trò:
 * - Guard FAIL-CLOSED cho toàn bộ các trang “hậu cổng”
 *   (SOFT_KO, KPI_SCORING, RESULTS, DASHBOARD)
 *
 * Trách nhiệm cốt lõi:
 * 1) Nếu thiếu bất kỳ điều kiện bắt buộc nào → REDIRECT NGAY
 * 2) Tập trung hóa logic kiểm tra Gate (Hard / Soft)
 * 3) Tuyệt đối KHÔNG permissive default:
 *    - JSON lỗi
 *    - Schema lệch
 *    - Thiếu field
 *    → coi như FAIL
 *
 * Điều kiện tiên quyết:
 * - window.MRSM_CONFIG phải được load trước
 * ============================================================
 */

(function () {
    "use strict";

    /**
     * ============================================================
     * REASON CODES
     * ============================================================
     * Dùng để gắn query param khi redirect
     * → phục vụ debug, log, hoặc hiển thị message UI
     */
    const REASON_CODES = {
        MISSING_ASSESSMENT_ID: "missing_assessment_id",
        MISSING_HARD_EVIDENCE: "missing_hard_evidence",
        MISSING_SOFT_GATE: "missing_soft_gate",
        SOFT_GATE_NOT_PASS: "soft_gate_not_pass",
        INTEGRITY_FAILED: "integrity_failed",
        PARSE_ERROR: "parse_error",
        SCHEMA_MISMATCH: "schema_mismatch",
    };

    /**
     * ============================================================
     * SAFE JSON PARSE (FAIL-SAFE)
     * ============================================================
     * - Parse JSON
     * - Nếu lỗi → return null (KHÔNG throw)
     * - Fail-closed: caller phải coi null là FAIL
     */
    function safeJsonParse(raw) {
        try {
            return JSON.parse(raw);
        } catch (e) {
            console.warn("[GateGuard] JSON parse error:", e);
            return null;
        }
    }

    /**
     * ============================================================
     * GET ASSESSMENT CONTEXT
     * ============================================================
     * Nhiệm vụ:
     * - Xác định assessment_id hiện tại
     * - Thứ tự ưu tiên:
     *   1) URL query (?assessment_id=)
     *   2) sessionStorage (current_assessment_id)
     *   3) sessionStorage legacy (assessment_id)
     *
     * Fail-closed:
     * - Không tìm được → return null
     * - Nếu redirectOnMissing = true → redirect ngay
     */
    function getAssessmentContext(opts = {}) {
        const { fallbackToSession = true, redirectOnMissing = false } = opts;

        // Ưu tiên 1: query param trên URL
        const url = new URL(window.location.href);
        const urlId = url.searchParams.get("assessment_id");
        if (urlId && urlId.trim()) return urlId.trim();

        // Ưu tiên 2: sessionStorage (để support reload / page nội bộ)
        if (fallbackToSession) {
            const sid1 = sessionStorage.getItem("current_assessment_id");
            if (sid1 && sid1.trim()) return sid1.trim();

            // legacy fallback
            const sid2 = sessionStorage.getItem("assessment_id");
            if (sid2 && sid2.trim()) return sid2.trim();
        }

        // Không tìm được assessment_id
        if (redirectOnMissing) {
            attachReasonAndRedirect("./KO_GATE.html", REASON_CODES.MISSING_ASSESSMENT_ID);
        }
        return null;
    }

    /**
     * ============================================================
     * GET HARD GATE (HARD KO)
     * ============================================================
     * Trách nhiệm:
     * - Lấy bằng chứng Hard KO đã PASS
     * - Ưu tiên cache localStorage (cross-tab / reload)
     * - Fallback sessionStorage (legacy)
     * - Có TTL → hết hạn là FAIL
     *
     * Fail-closed tuyệt đối:
     * - Thiếu expiresAt
     * - Sai schema
     * - JSON lỗi
     * → return null
     */
    function getHardGate() {
        const hardKey = (window.MRSM_CONFIG && window.MRSM_CONFIG.HARD_GATE_KEY) || "validatedHardKO";
        const cachePrefix = (window.MRSM_CONFIG && window.MRSM_CONFIG.HARD_GATE_CACHE_PREFIX) || "hard_ko_cache:";
        const ttlHours = Number((window.MRSM_CONFIG && window.MRSM_CONFIG.HARD_GATE_CACHE_TTL_HOURS) || 24) || 24;

        const assessmentId = getAssessmentContext({ redirectOnMissing: false });
        const cacheKey = assessmentId ? `${cachePrefix}${assessmentId}` : null;

        /**
         * Validate schema tối thiểu của Hard KO
         * - Phải có verifiedAt / verified_at
         * - Phải là object
         */
        const validateHard = (hardObj) => {
            if (!hardObj || typeof hardObj !== "object") return null;
            if (!hardObj.verifiedAt && !hardObj.verified_at) return null;
            return hardObj;
        };

        // ===== 1️⃣ Ưu tiên đọc từ localStorage (bản mới, có TTL) =====
        if (cacheKey) {
            const cachedRaw = localStorage.getItem(cacheKey);
            if (cachedRaw) {
                const cached = safeJsonParse(cachedRaw);
                const expiresAt = cached?.expiresAt || cached?.expires_at || null;

                if (expiresAt) {
                    const exp = new Date(expiresAt).getTime();
                    if (Number.isFinite(exp) && Date.now() <= exp) {
                        const hardFromCache = validateHard(cached?.hard || cached?.data || null);
                        if (hardFromCache) {
                            // Restore về sessionStorage để support code legacy
                            try {
                                sessionStorage.setItem(hardKey, JSON.stringify(hardFromCache));
                            } catch { }
                            return hardFromCache;
                        }
                    } else {
                        // Hết hạn → dọn cache
                        localStorage.removeItem(cacheKey);
                    }
                } else {
                    // Không có expiresAt → coi như INVALID
                    localStorage.removeItem(cacheKey);
                }
            }
        }

        // ===== 2️⃣ Fallback: sessionStorage (legacy flow) =====
        const raw = sessionStorage.getItem(hardKey);
        if (!raw) {
            console.warn(`[GateGuard] Hard KO evidence missing (sessionStorage.${hardKey})`);
            return null;
        }

        const hard = validateHard(safeJsonParse(raw));
        if (!hard) {
            console.warn("[GateGuard] Hard KO evidence parse failed or invalid schema");
            return null;
        }

        // ===== 3️⃣ Mirror sang localStorage kèm TTL =====
        if (cacheKey) {
            try {
                const now = Date.now();
                const payload = {
                    schema_version: "hard_ko_cache_v1",
                    assessment_id: assessmentId,
                    hard,
                    cachedAt: new Date(now).toISOString(),
                    expiresAt: new Date(now + ttlHours * 60 * 60 * 1000).toISOString(),
                };
                localStorage.setItem(cacheKey, JSON.stringify(payload));
            } catch (e) {
                console.warn("[GateGuard] Failed to cache hard evidence:", e);
            }
        }

        return hard;
    }

    /**
     * ============================================================
     * GET SOFT GATE
     * ============================================================
     * - Đọc Soft KO từ localStorage
     * - Phải có gate_status
     * - Không validate PASS ở đây
     */
    function getSoftGate() {
        const softKey = (window.MRSM_CONFIG && window.MRSM_CONFIG.SOFT_GATE_KEY) || "soft_ko_gate";
        const raw = localStorage.getItem(softKey);
        if (!raw) {
            console.warn(`[GateGuard] Soft KO gate missing (localStorage.${softKey})`);
            return null;
        }

        const soft = safeJsonParse(raw);
        if (!soft || typeof soft !== "object") {
            console.warn("[GateGuard] Soft KO gate parse failed or invalid schema");
            return null;
        }

        if (!soft.gate_status) {
            console.warn("[GateGuard] Soft KO gate missing gate_status field");
            return null;
        }

        return soft;
    }

    /**
     * Check Soft Gate có PASS hay không
     */
    function isSoftGatePass(soft) {
        if (!soft) return false;
        return String(soft.gate_status).toUpperCase() === "PASS";
    }

    /**
     * ============================================================
     * REQUIRE HARD GATE
     * ============================================================
     * - Nếu thiếu Hard KO → redirect
     * - Dùng cho mọi page hậu Hard Gate
     */
    function requireHardGateOrRedirect(opts = {}) {
        const {
            redirectUrl = "./KO_GATE.html",
            reason = REASON_CODES.MISSING_HARD_EVIDENCE,
            redirectOnMissing = true,
        } = opts;

        const hard = getHardGate();
        if (!hard) {
            if (redirectOnMissing) attachReasonAndRedirect(redirectUrl, reason);
            return false;
        }
        return true;
    }

    /**
     * Require Soft Gate tồn tại (KHÔNG check PASS)
     */
    function requireSoftGateOrRedirect(opts = {}) {
        const {
            redirectUrl = "./SOFT_KO.html",
            reason = REASON_CODES.MISSING_SOFT_GATE,
            redirectOnMissing = true,
        } = opts;

        const soft = getSoftGate();
        if (!soft) {
            if (redirectOnMissing) attachReasonAndRedirect(redirectUrl, reason);
            return false;
        }
        return true;
    }

    /**
     * Require Soft Gate PASS
     */
    function requireSoftGatePassOrRedirect(opts = {}) {
        const {
            redirectUrl = "./SOFT_KO.html",
            reason = REASON_CODES.SOFT_GATE_NOT_PASS,
            redirectOnMissing = true,
        } = opts;

        const soft = getSoftGate();
        if (!soft) {
            if (redirectOnMissing) attachReasonAndRedirect(redirectUrl, REASON_CODES.MISSING_SOFT_GATE);
            return false;
        }

        if (!isSoftGatePass(soft)) {
            if (redirectOnMissing) attachReasonAndRedirect(redirectUrl, reason);
            return false;
        }

        return true;
    }

    /**
     * ============================================================
     * REDIRECT HELPER
     * ============================================================
     * - Gắn reason vào query param
     * - KHÔNG double encode
     */
    function attachReasonAndRedirect(baseUrl, reason, extra = {}) {
        try {
            const url = new URL(baseUrl, window.location.origin);

            if (reason) {
                url.searchParams.set("reason", String(reason));
            }

            for (const [key, value] of Object.entries(extra)) {
                if (value !== undefined && value !== null && String(value).trim() !== "") {
                    url.searchParams.set(key, String(value));
                }
            }

            console.log("[GateGuard] Redirecting to:", url.href);
            window.location.href = url.href;
        } catch (err) {
            console.warn("[GateGuard] Redirect fallback:", err);
            window.location.href = baseUrl;
        }
    }

    /**
     * ============================================================
     * CHECK ASSESSMENT INTEGRITY
     * ============================================================
     * Logic:
     * - Nếu đã có SCORE → bắt buộc:
     *   + Hard Gate tồn tại
     *   + Soft Gate tồn tại & PASS
     *   + Có assessment_id
     */
    function checkAssessmentIntegrity(result) {
        const reasons = [];

        if (!result) {
            return { valid: false, reasons: ["missing_assessment_result"] };
        }

        const hasScore =
            result.totalScore !== undefined ||
            result.final_score !== undefined ||
            result.mrsm?.final_score !== undefined;

        if (hasScore) {
            if (!getHardGate()) reasons.push("missing_hard_evidence");

            const soft = getSoftGate();
            if (!soft) reasons.push("missing_soft_gate");
            else if (!isSoftGatePass(soft)) reasons.push("soft_gate_not_pass");

            if (!getAssessmentContext({ redirectOnMissing: false })) {
                reasons.push("missing_assessment_id");
            }
        }

        return { valid: reasons.length === 0, reasons };
    }

    /**
     * ============================================================
     * PUBLIC API
     * ============================================================
     */
    const GateGuard = {
        REASON_CODES,
        getAssessmentContext,
        getHardGate,
        getSoftGate,
        isSoftGatePass,
        requireHardGateOrRedirect,
        requireSoftGateOrRedirect,
        requireSoftGatePassOrRedirect,
        attachReasonAndRedirect,
        checkAssessmentIntegrity,
        _safeJsonParse: safeJsonParse, // expose cho test/debug
    };

    window.GateGuard = GateGuard;
    console.log("[GateGuard] Loaded. Call GateGuard.requireHardGateOrRedirect() etc.");
})();
