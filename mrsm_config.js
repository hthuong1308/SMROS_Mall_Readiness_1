/* =========================================================
   mrsm_config.js
   =========================================================
MỤC TIÊU TỔNG THỂ:
   - Single Source of Truth (SSOT) cho toàn bộ MRSM flow
   - Dùng chung cho:
     + KO_GATE
     + SOFT_KO
     + KPI_SCORING
     + RESULTS
     + DASHBOARD
   - Giảm config drift giữa các page
   - Ép Fail-Closed làm mặc định (an toàn học thuật)

 NGUYÊN TẮC CỐT LÕI:
   - Thiếu dữ liệu            => FAIL
   - JSON parse lỗi           => FAIL
   - Schema sai / mơ hồ       => FAIL
   - KHÔNG CÓ permissive default
========================================================= */

(function () {
    "use strict";
    // Strict mode:
    // - Cấm biến global ngầm
    // - Lỗi silent sẽ bị throw
    // - Phù hợp môi trường nghiên cứu / audit

    const CONFIG = {

        /* =====================================================
           1️. STORAGE KEYS – ĐỊNH NGHĨA NƠI LƯU DỮ LIỆU
           ===================================================== */

        /**
         * HARD_GATE_KEY
         * -----------------------------------------------------
         * - Lưu Hard KO evidence đã được verify
         * - CHỈ sống trong session hiện tại (sessionStorage)
         * - Mặc định: mất khi đóng tab
         */
        HARD_GATE_KEY: "validatedHardKO",

        /**
         * SOFT_GATE_KEY
         * -----------------------------------------------------
         * - Lưu kết quả Soft KO gate
         * - Dùng lại giữa nhiều page
         * - Cho phép tồn tại cross-page
         */
        SOFT_GATE_KEY: "soft_ko_gate",


        /* =====================================================
           2️. HARD KO MIRROR CACHE (LOCALSTORAGE)
           ===================================================== */

        /**
         * HARD_GATE_CACHE_PREFIX
         * -----------------------------------------------------
         * - Prefix cho key mirror Hard KO
         * - Kết hợp với assessment_id
         * - Dùng để:
         *   + reload page
         *   + mở tab mới
         *   + tránh mất hard evidence đã verify
         */
        HARD_GATE_CACHE_PREFIX: "hard_ko_cache:",

        /**
         * HARD_GATE_CACHE_TTL_HOURS
         * -----------------------------------------------------
         * - TTL cho Hard KO mirror
         * - Tránh reuse evidence quá lâu
         * - Đảm bảo tính thời điểm (temporal validity)
         */
        HARD_GATE_CACHE_TTL_HOURS: 24,


        /* =====================================================
           3️. SOFT KO DEFINITIONS (THEO THESIS)
           ===================================================== */

        /**
         * SOFT_KO_IDS
         * -----------------------------------------------------
         * - Danh sách Soft KO codes có ảnh hưởng gate
         * - Mapping trực tiếp với thesis / policy Shopee Mall
         */
        SOFT_KO_IDS: ["OP-04", "PEN-01", "CO-01", "SC-02"],

        /* =====================================================
           3.1. GateRegistry (compatibility layer)
           -----------------------------------------------------
           - Một số page (dashboard/gate-guard) kỳ vọng:
             window.MRSM_CONFIG.GateRegistry.softKoIds
           - Nếu thiếu sẽ bị schema_mismatch & redirect KO_GATE
           ===================================================== */
        GateRegistry: {
            softKoIds: ["OP-04", "PEN-01", "CO-01", "SC-02"],

            /**
             * getRule(ruleId)
             * ---------------------------------------------------
             * - Trả về cấu hình rule cho SOFT KO (best-effort)
             * - Dùng để render mô tả/threshold trong Dashboard/Results
             */
            getRule(ruleId) {
                const id = String(ruleId || "").trim().toUpperCase();
                const defs = {
                    "OP-04": { type: "percentage", direction: "min", threshold: 85, unit: "%", label: "Tỷ lệ giao hàng nhanh (Soft KO)" },
                    "PEN-01": { type: "number", direction: "max", threshold: 2, unit: " điểm", label: "Điểm phạt Sao Quả Tạ (Soft KO)" },
                    "CO-01": { type: "percentage", direction: "max", threshold: 10, unit: "%", label: "Tỷ lệ hàng đặt trước (Soft KO)" },
                    "SC-02": { type: "number", direction: "min", threshold: 150, unit: " đơn", label: "Số đơn hàng 4 tuần (Soft KO)" },
                };
                return defs[id] || null;
            },
        },




        /* =====================================================
           3.5. KPI METADATA (SSOT) – dùng cho Tooltip/Explainability
           -----------------------------------------------------
           - Bạn chỉ cần điền helpText cho từng KPI
           - scoring_logic.js / KPI_SCORING.html sẽ đọc MRSM_CONFIG.getHelpText(id)
        ===================================================== */
        kpis: [
            { id: "OP-01", group: "Vận hành", name: "Tỷ lệ giao hàng trễ (LSR)", method: "RANGE", risk_tier: "sla_risk", governance_severity: 2, enforcement_duration: 30, ed_rank: 2, sla_impact_rank: 3, index: 23, policy_priority: 3, local_weight: 0.103603603604, global_weight: 0.5, weight: 0.051801801802, direction: "LE", t1: 8, t2: 12, helpText: "" },
            { id: "OP-02", group: "Vận hành", name: "Tỷ lệ đơn hàng không thành công (NFR)", method: "RANGE", risk_tier: "sla_risk", governance_severity: 2, enforcement_duration: 30, ed_rank: 2, sla_impact_rank: 3, index: 23, policy_priority: 3, local_weight: 0.103603603604, global_weight: 0.5, weight: 0.051801801802, direction: "LE", t1: 8, t2: 12, helpText: "" },
            { id: "OP-03", group: "Vận hành", name: "Tỷ lệ đánh giá tiêu cực (NRR)", method: "RANGE", risk_tier: "sla_risk", governance_severity: 2, enforcement_duration: 30, ed_rank: 2, sla_impact_rank: 3, index: 23, policy_priority: 3, local_weight: 0.103603603604, global_weight: 0.5, weight: 0.051801801802, direction: "LE", t1: 2, t2: 5, helpText: "" },
            { id: "OP-04", group: "Vận hành", name: "Fast Handling Rate", method: "RANGE", risk_tier: "sla_priority", governance_severity: 3, enforcement_duration: 30, ed_rank: 2, sla_impact_rank: 3, index: 23, policy_priority: 3, local_weight: 0.103603603604, global_weight: 0.5, weight: 0.051801801802, direction: "GE", t1: 95, t2: 80, helpText: "" },
            { id: "CS-01", group: "Vận hành", name: "Chat Response Rate", method: "RANGE", risk_tier: "sla_risk", governance_severity: 2, enforcement_duration: 30, ed_rank: 2, sla_impact_rank: 2, index: 22, policy_priority: 2, local_weight: 0.099099099099, global_weight: 0.5, weight: 0.04954954955, direction: "GE", t1: 80, t2: 60, helpText: "" },
            { id: "CS-02", group: "Vận hành", name: "Chat Response Time (h)", method: "RANGE", risk_tier: "sla_risk", governance_severity: 2, enforcement_duration: 30, ed_rank: 2, sla_impact_rank: 2, index: 22, policy_priority: 2, local_weight: 0.099099099099, global_weight: 0.5, weight: 0.04954954955, direction: "LE", t1: 4, t2: 8, helpText: "" },
            { id: "PEN-01", group: "Vận hành", name: "Điểm phạt Sao Quả Tạ", method: "RANGE", risk_tier: "governance_risk", governance_severity: 3, enforcement_duration: 90, ed_rank: 3, sla_impact_rank: 2, index: 32, policy_priority: 2, local_weight: 0.144144144144, global_weight: 0.5, weight: 0.072072072072, direction: "LE", t1: 0, t2: 2, helpText: "" },
            { id: "CO-01", group: "Vận hành", name: "Tỷ lệ hàng đặt trước (%)", method: "RANGE", risk_tier: "sla_risk", governance_severity: 2, enforcement_duration: 30, ed_rank: 2, sla_impact_rank: 2, index: 22, policy_priority: 2, local_weight: 0.099099099099, global_weight: 0.5, weight: 0.04954954955, direction: "LE", t1: 5, t2: 10, helpText: "" },
            { id: "CO-02", group: "Vận hành", name: "Community Violations", method: "BINARY", risk_tier: "governance_risk", governance_severity: 3, enforcement_duration: 90, ed_rank: 3, sla_impact_rank: 2, index: 32, policy_priority: 2, local_weight: 0.144144144144, global_weight: 0.5, weight: 0.072072072072, direction: "BOOL", helpText: "" },
            { id: "BR-01", group: "Thương hiệu", name: "Website ổn định (domain check)", method: "CUSTOM", risk_tier: "structural", governance_severity: 1, enforcement_duration: 0, ed_rank: 1, sla_impact_rank: 1, index: 11, policy_priority: 1, local_weight: 0.314285714286, global_weight: 0.2, weight: 0.062857142857, direction: "URL_OK", helpText: "" },
            { id: "BR-02", group: "Thương hiệu", name: "Social Media", method: "CUSTOM", risk_tier: "eligibility", governance_severity: 2, enforcement_duration: 0, ed_rank: 1, sla_impact_rank: 2, index: 12, policy_priority: 2, local_weight: 0.342857142857, global_weight: 0.2, weight: 0.068571428571, direction: "SOCIAL_2COND", t1: 5000, helpText: "" },
            { id: "BR-03", group: "Thương hiệu", name: "Độ phủ offline", method: "CUSTOM", risk_tier: "eligibility", governance_severity: 2, enforcement_duration: 0, ed_rank: 1, sla_impact_rank: 2, index: 12, policy_priority: 2, local_weight: 0.342857142857, global_weight: 0.2, weight: 0.068571428571, direction: "NONEMPTY_TEXT", helpText: "" },
            { id: "CAT-01", group: "Danh mục", name: "Số lượng sản phẩm hoạt động (SKU)", method: "RANGE", risk_tier: "structural", governance_severity: 1, enforcement_duration: 0, ed_rank: 1, sla_impact_rank: 1, index: 11, policy_priority: 1, local_weight: 0.112244897959, global_weight: 0.15, weight: 0.016836734694, direction: "GE", t1: 50, t2: 5, helpText: "" },
            { id: "CAT-02", group: "Danh mục", name: "Ảnh đạt chuẩn (white bg + lifestyle + không vi phạm)", method: "CUSTOM", risk_tier: "compliance", governance_severity: 2, enforcement_duration: 30, ed_rank: 2, sla_impact_rank: 2, index: 22, policy_priority: 2, local_weight: 0.224489795918, global_weight: 0.15, weight: 0.033673469388, direction: "IMG_2CHECK", helpText: "" },
            { id: "CAT-03", group: "Danh mục", name: "Sản phẩm bị khóa/xóa", method: "BINARY", risk_tier: "governance_risk", governance_severity: 3, enforcement_duration: 90, ed_rank: 3, sla_impact_rank: 3, index: 33, policy_priority: 3, local_weight: 0.336734693878, global_weight: 0.15, weight: 0.050510204082, direction: "BOOL", helpText: "" },
            { id: "CAT-04", group: "Danh mục", name: "Các vi phạm khác", method: "BINARY", risk_tier: "governance_risk", governance_severity: 3, enforcement_duration: 90, ed_rank: 3, sla_impact_rank: 2, index: 32, policy_priority: 2, local_weight: 0.326530612245, global_weight: 0.15, weight: 0.048979591837, direction: "BOOL", helpText: "" },
            { id: "SC-01", group: "Quy mô", name: "Doanh số 4 tuần (Triệu VNĐ)", method: "RANGE", risk_tier: "structural", governance_severity: 2, enforcement_duration: 0, ed_rank: 1, sla_impact_rank: 2, index: 12, policy_priority: 2, local_weight: 0.260869565217, global_weight: 0.15, weight: 0.039130434783, direction: "GE", t1: 50, t2: 30, helpText: "" },
            { id: "SC-02", group: "Quy mô", name: "Số đơn 4 tuần (Soft KO)", method: "RANGE", risk_tier: "sla_priority", governance_severity: 3, enforcement_duration: 30, ed_rank: 2, sla_impact_rank: 3, index: 23, policy_priority: 3, local_weight: 0.5, global_weight: 0.15, weight: 0.075, direction: "GE", t1: 250, t2: 150, helpText: "" },
            { id: "SC-03", group: "Quy mô", name: "Tăng trưởng 4w", method: "RANGE", risk_tier: "structural", governance_severity: 2, enforcement_duration: 0, ed_rank: 1, sla_impact_rank: 1, index: 11, policy_priority: 1, local_weight: 0.239130434783, global_weight: 0.15, weight: 0.035869565217, direction: "GE", t1: 5, t2: 0, helpText: "" },
        ],

        /**
         * getKpiMeta(id)
         * -----------------------------------------------------
         * - Lấy metadata theo KPI id (FAIL-CLOSED: không có -> null)
         */
        getKpiMeta(id) {
            if (!id) return null;
            const key = String(id).trim().toUpperCase();
            const found = Array.isArray(CONFIG.kpis) ? CONFIG.kpis.find(k => String(k.id).toUpperCase() === key) : null;
            return found || null;
        },

        /**
         * getHelpText(id)
         * -----------------------------------------------------
         * - Tooltip text (FAIL-CLOSED: không có -> "")
         */
        getHelpText(id) {
            const m = CONFIG.getKpiMeta(id);
            const t = m?.helpText;
            return (typeof t === "string") ? t.trim() : "";
        },
        /* =====================================================
                   4️. ENUM TRẠNG THÁI GATE (CHUẨN HÓA)
                   ===================================================== */

        /**
         * GATE_STATUS
         * -----------------------------------------------------
         * - Enum chính thức cho toàn bộ hệ thống
         * - GateGuard / Dashboard / Result đều dùng chung
         */
        GATE_STATUS: {
            PASS: "PASS",          // Qua gate hoàn toàn
            HARD_FAIL: "G0",       // Hard KO – fail ngay
            SOFT_PENDING: "G1",    // Soft KO – trong remediation window
            SOFT_OVERDUE: "G2",    // Soft KO – quá hạn remediation
            UNKNOWN: "UNKNOWN",   // Trạng thái không xác định (fail-safe)
        },


        /* =====================================================
           5.  UTILS – HÀM PHỤ TRỢ AN TOÀN
           ===================================================== */

        /**
         * safeParseJson(raw)
         * -----------------------------------------------------
         * - Parse JSON an toàn
         * - Nếu lỗi => return null
         * - Bất kỳ JSON lỗi nào => FAIL-CLOSED
         * - Không cho phép permissive parsing
         */
        safeParseJson(raw) {
            try {
                return JSON.parse(raw);
            } catch {
                return null;
            }
        },

        /**
         * getAssessmentId()
         * -----------------------------------------------------
         * Lấy assessment_id theo thứ tự ưu tiên:
         * 1. URL query (?assessment_id=...)
         * 2. sessionStorage.current_assessment_id
         * 3. sessionStorage.assessment_id (legacy)
         *
         * Không tìm được => return null (FAIL)
         */
        getAssessmentId() {
            try {
                const url = new URL(window.location.href);
                const q = url.searchParams.get("assessment_id");
                if (q && q.trim()) return q.trim();
            } catch { }

            const sid1 = sessionStorage.getItem("current_assessment_id");
            if (sid1 && sid1.trim()) return sid1.trim();

            const sid2 = sessionStorage.getItem("assessment_id");
            if (sid2 && sid2.trim()) return sid2.trim();

            return null; // fail-closed
        },


        /* =====================================================
           6️. HARD KO CACHE – INTERNAL HELPERS
           ===================================================== */

        /**
         * _hardCacheKey(assessmentId)
         * -----------------------------------------------------
         * - Tạo key localStorage cho Hard KO mirror
         * - Nếu thiếu assessment_id => return null
         */
        _hardCacheKey(assessmentId) {
            if (!assessmentId) return null;
            return `${CONFIG.HARD_GATE_CACHE_PREFIX}${assessmentId}`;
        },

        /**
         * _readHardGateCache(assessmentId)
         * -----------------------------------------------------
         * Đọc Hard KO từ localStorage mirror:
         * - Check tồn tại
         * - Check TTL
         * - Check schema tối thiểu
         *
         * Lỗi ở BẤT KỲ bước nào => return null
         */
        _readHardGateCache(assessmentId) {
            const key = CONFIG._hardCacheKey(assessmentId);
            if (!key) return null;

            const raw = localStorage.getItem(key);
            if (!raw) return null;

            const cached = CONFIG.safeParseJson(raw);

            const expiresAt = cached?.expiresAt || cached?.expires_at;
            if (!expiresAt) {
                localStorage.removeItem(key);
                return null;
            }

            const exp = new Date(expiresAt).getTime();
            if (!Number.isFinite(exp) || Date.now() > exp) {
                localStorage.removeItem(key);
                return null;
            }

            const hard = cached?.hard || cached?.data;
            if (!hard || typeof hard !== "object") return null;
            if (!hard.verifiedAt && !hard.verified_at) return null;

            return hard;
        },

        /**
         * _writeHardGateCache(assessmentId, hard)
         * -----------------------------------------------------
         * - Ghi Hard KO evidence vào localStorage mirror
         * - Gắn TTL
         * - Dùng khi:
         *   + vừa verify hard KO
         *   + restore từ session
         */
        _writeHardGateCache(assessmentId, hard) {
            const key = CONFIG._hardCacheKey(assessmentId);
            if (!key) return false;

            try {
                const now = Date.now();
                const ttlHours = Number(CONFIG.HARD_GATE_CACHE_TTL_HOURS) || 24;

                const payload = {
                    schema_version: "hard_ko_cache_v1",
                    assessment_id: assessmentId,
                    hard,
                    cachedAt: new Date(now).toISOString(),
                    expiresAt: new Date(now + ttlHours * 3600 * 1000).toISOString(),
                };

                localStorage.setItem(key, JSON.stringify(payload));
                return true;
            } catch (e) {
                console.warn("[MRSM_CONFIG] writeHardGateCache failed:", e);
                return false;
            }
        },


        /* =====================================================
           7️. GATE GETTERS – FAIL-CLOSED
           ===================================================== */

        /**
         * getHardGate()
         * -----------------------------------------------------
         * Lấy Hard KO evidence theo thứ tự:
         * 1. localStorage mirror (cross-tab)
         * 2. sessionStorage (tab hiện tại)
         * 3. mirror lại cache nếu cần
         *
         * Bất kỳ bước nào fail => return null
         */
        getHardGate() {
            const assessmentId = CONFIG.getAssessmentId();

            const cached = CONFIG._readHardGateCache(assessmentId);
            if (cached) return cached;

            const raw = sessionStorage.getItem(CONFIG.HARD_GATE_KEY);
            const hard = raw ? CONFIG.safeParseJson(raw) : null;
            if (!hard || typeof hard !== "object") return null;
            if (!hard.verifiedAt && !hard.verified_at) return null;

            if (assessmentId) CONFIG._writeHardGateCache(assessmentId, hard);
            return hard;
        },

        /**
         * getSoftGate()
         * -----------------------------------------------------
         * - Lấy Soft KO gate từ localStorage
         * - KHÔNG validate sâu ở đây
         * - GateGuard sẽ chịu trách nhiệm validate logic
         */
        getSoftGate() {
            const raw = localStorage.getItem(CONFIG.SOFT_GATE_KEY);
            return raw ? CONFIG.safeParseJson(raw) : null;
        },


        /* =====================================================
           8️. REDIRECT HELPERS
           ===================================================== */

        /**
         * requireHardGateOrRedirect()
         * -----------------------------------------------------
          Legacy helper
         * - Dùng cho page cũ
         * - Không có reason code
         *  Page mới nên dùng GateGuard.*
         */
        requireHardGateOrRedirect() {
            const hard = CONFIG.getHardGate();
            if (!hard) {
                window.location.href = "./KO_GATE.html";
                return false;
            }
            return true;
        },

        /**
         * requireSoftGatePassOrRedirect()
         * -----------------------------------------------------
         Legacy helper
         * - Chỉ check PASS
         * - Không phân biệt G1 / G2
         */
        requireSoftGatePassOrRedirect() {
            const soft = CONFIG.getSoftGate();
            if (!soft || !soft.gate_status) {
                window.location.href = "./SOFT_KO.html";
                return false;
            }
            if (String(soft.gate_status).toUpperCase() !== "PASS") {
                window.location.href = "./SOFT_KO.html";
                return false;
            }
            return true;
        },
    };

    // Expose global SSOT
    window.MRSM_CONFIG = CONFIG;
})();
