/**
 * ============================================================
 * SMRSS – MRSM KPI SCORING CORE LOGIC (WSM v2) — CLEAN v2
 * ============================================================
 * Fixes:
 * 1) SSOT registry: hoist BACKUP_KPI_ORDER + declare KPI_WEIGHT_SUM (no implicit globals).
 * 2) Normalize weights -> weight_final sums to 1 (stable totalScore 0–100).
 * 3) BR-02 threshold t1=5000 (followers) even when CUSTOM.
 * 4) CAT-02 rule: +50 if Lifestyle uploaded, +50 if White-bg passes (draft-evidence fallback).
 * 5) Group names normalized to EN: Operation / Brand / Category / Scale (RESULTS/DASHBOARD compatible).
 * 6) Remove stray text / naming inconsistencies.
 * 7) ✅ FIX: Save normalized weights (weight_final) to both breakdown & kpis in assessment_result
 * 8) ✅ FIX: Ensure gate_status is properly saved as "PASS" when soft gate passes
 */

// =========================
// Backup registry (hoisted)
// =========================
const BACKUP_KPI_ORDER = [
    "OP-01",
    "OP-02",
    "OP-03",
    "OP-04",
    "CS-01",
    "CS-02",
    "PEN-01",
    "CO-01",
    "CO-02",
    "BR-01",
    "BR-02",
    "BR-03",
    "CAT-01",
    "CAT-02",
    "CAT-03",
    "CAT-04",
    "SC-01",
    "SC-02",
    "SC-03",
];

const BACKUP_KPI_RULES = {
    "OP-01": { name: "Tỷ lệ giao hàng trễ (LSR)", method: "RANGE", direction: "LE", t1: 8, t2: 12, weight: 0.08 },
    "OP-02": { name: "Tỷ lệ đơn hàng không thành công (NFR)", method: "RANGE", direction: "LE", t1: 8, t2: 12, weight: 0.08 },
    "OP-03": { name: "Tỷ lệ đánh giá tiêu cực (NRR)", method: "RANGE", direction: "LE", t1: 2, t2: 5, weight: 0.05 },
    "OP-04": { name: "Tỷ lệ giao hàng nhanh", method: "RANGE", direction: "GE", t1: 95, t2: 80, weight: 0.05 },
    "CS-01": { name: "Tỷ lệ phản hồi Chat", method: "RANGE", direction: "GE", t1: 80, t2: 60, weight: 0.08 },
    "CS-02": { name: "Thời gian phản hồi Chat (h)", method: "RANGE", direction: "LE", t1: 4, t2: 8, weight: 0.04 },
    "PEN-01": { name: "Điểm phạt Sao Quả Tạ", method: "RANGE", direction: "LE", t1: 2, t2: 2, weight: 0.08 },
    "CO-01": { name: "Tỷ lệ hàng đặt trước (%)", method: "RANGE", direction: "LE", t1: 5, t2: 10, weight: 0.04 },
    "CO-02": { name: "Không vi phạm cộng đồng", method: "BINARY", direction: "BOOL", weight: 0.05 },
    "BR-01": { name: "Website ổn định (domain check)", method: "CUSTOM", direction: "CUSTOM", weight: 0.05, t1: 0, t2: 0 },
    "BR-02": { name: "Hiện diện MXH (followers + post link)", method: "CUSTOM", direction: "CUSTOM", weight: 0.05, t1: 5000, t2: 0 },
    "BR-03": { name: "Độ phủ Offline (địa chỉ cửa hàng)", method: "CUSTOM", direction: "CUSTOM", weight: 0.05, t1: 0, t2: 0 },
    "CAT-01": { name: "Số lượng sản phẩm hoạt động (SKU)", method: "RANGE", direction: "GE", t1: 50, t2: 5, weight: 0.05 },
    "CAT-02": { name: "Ảnh đạt chuẩn (white bg + lifestyle)", method: "CUSTOM", direction: "CUSTOM", weight: 0.05, t1: 0, t2: 0 },
    "CAT-03": { name: "Sản phẩm bị khóa/xóa", method: "BINARY", direction: "BOOL", weight: 0.1 },
    "CAT-04": { name: "Các vi phạm khác", method: "BINARY", direction: "BOOL", weight: 0.05 },
    "SC-01": { name: "Doanh số 4w (Triệu VNĐ)", method: "RANGE", direction: "GE", t1: 50, t2: 30, weight: 0.04 },
    "SC-02": { name: "Số đơn hàng 4w", method: "RANGE", direction: "GE", t1: 250, t2: 150, weight: 0.04 },
    "SC-03": { name: "Tăng trưởng doanh số (%)", method: "RANGE", direction: "GE", t1: 5, t2: 0, weight: 0.02 },
};

// =========================
// SSOT registry (MRSM_CONFIG)
// =========================
let KPI_ORDER = [];
const KPI_RULES = {};
let KPI_WEIGHT_SUM = 1; // declared (no implicit global)

(function initKpiRegistryFromSSOT() {
    // reset
    KPI_ORDER.length = 0;
    for (const k of Object.keys(KPI_RULES)) delete KPI_RULES[k];
    KPI_WEIGHT_SUM = 0;

    try {
        const cfg = window.MRSM_CONFIG;
        const list = cfg?.kpis;
        if (!Array.isArray(list) || list.length === 0) throw new Error("MRSM_CONFIG.kpis missing/empty");

        const specialCustomIds = new Set(["BR-01", "BR-02", "BR-03", "CAT-02"]);

        list.forEach((k) => {
            if (!k?.id) return;

            let method = String(k.method || "RANGE").toUpperCase();
            if (method === "BOOLEAN") method = "BINARY";
            if (method === "COMPLEX") method = "CUSTOM";
            if (specialCustomIds.has(k.id)) method = "CUSTOM";

            const weightRaw = Number(k.weight ?? 0);

            const rule = {
                name: k.name || k.id,
                method,
                direction: "GE",
                t1: 0,
                t2: 0,
                weight_raw: weightRaw,
                weight_final: 0, // fill after sum known
            };

            if (method === "BINARY") {
                rule.direction = "BOOL";
            } else if (method === "CUSTOM") {
                rule.direction = "CUSTOM";
                // IMPORTANT: still keep t1/t2 from config if present (BR-02 followers threshold)
                if (k.t1 !== undefined) rule.t1 = Number(k.t1);
                if (k.t2 !== undefined) rule.t2 = Number(k.t2);
            } else {
                rule.direction = String(k.direction || "GE").toUpperCase();
                rule.t1 = k.t1 !== undefined ? Number(k.t1) : 0;
                rule.t2 = k.t2 !== undefined ? Number(k.t2) : 0;
            }

            // Ensure BR-02 threshold default = 5000 if missing
            if (k.id === "BR-02" && !(rule.t1 > 0)) rule.t1 = 5000;

            KPI_RULES[k.id] = rule;
            KPI_ORDER.push(k.id);
            KPI_WEIGHT_SUM += Number(weightRaw || 0);
        });

        if (!(KPI_WEIGHT_SUM > 0)) KPI_WEIGHT_SUM = KPI_ORDER.length || 1;

        // normalize weights
        KPI_ORDER.forEach((id) => {
            const r = KPI_RULES[id];
            r.weight_final = Number(r.weight_raw || 0) / KPI_WEIGHT_SUM;
            if (!Number.isFinite(r.weight_final)) r.weight_final = 0;
        });

        console.log("[SSOT] KPI registry loaded:", KPI_ORDER.length, "weightSum=", KPI_WEIGHT_SUM);
        return;
    } catch (e) {
        console.warn("[SSOT] initKpiRegistryFromSSOT failed:", e);
    }

    // fallback to backup
    KPI_ORDER = BACKUP_KPI_ORDER.slice();
    KPI_WEIGHT_SUM = KPI_ORDER.reduce((s, id) => s + Number(BACKUP_KPI_RULES[id]?.weight || 0), 0) || (KPI_ORDER.length || 1);

    KPI_ORDER.forEach((id) => {
        const b = BACKUP_KPI_RULES[id];
        KPI_RULES[id] = {
            name: b.name || id,
            method: String(b.method || "RANGE").toUpperCase(),
            direction: String(b.direction || "GE").toUpperCase(),
            t1: Number(b.t1 ?? 0),
            t2: Number(b.t2 ?? 0),
            weight_raw: Number(b.weight ?? 0),
            weight_final: Number(b.weight ?? 0) / KPI_WEIGHT_SUM,
        };
    });

    console.log("[SSOT] KPI registry loaded from BACKUP:", KPI_ORDER.length, "weightSum=", KPI_WEIGHT_SUM);
})();

// =========================
// DOM helpers
// =========================
function $(id) {
    return document.getElementById(id);
}

function safeParseJson(raw) {
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

// =========================
// Draft Storage
// =========================
const KPI_DRAFT_KEY = "SMROS_KPI_DRAFT_V1";
const KPI_COMPLETED_KEY = "SMROS_KPI_COMPLETED_V1";

function getAssessmentIdFromUrl() {
    try {
        const u = new URL(window.location.href);
        const id = u.searchParams.get("assessment_id");
        if (id) return id;
    } catch (_) { }

    const cand =
        sessionStorage.getItem("current_assessment_id") ||
        sessionStorage.getItem("assessment_id") ||
        localStorage.getItem("current_assessment_id") ||
        localStorage.getItem("assessment_id");

    return cand || "";
}

function getDraftKey() {
    const uid = window._auth?.currentUser?.uid || localStorage.getItem("smros_uid") || "anon";

    let shopId = "unknown";
    try {
        const shop = safeParseJson(localStorage.getItem("shop_info") || "{}") || {};
        shopId = shop.shop_id || shop.shopId || shopId;
    } catch (_) { }

    const assessmentId = getAssessmentIdFromUrl() || "no_assessment";
    return `${KPI_DRAFT_KEY}__${uid}__${shopId}__${assessmentId}`;
}

function getCompletedKey() {
    const uid = window._auth?.currentUser?.uid || localStorage.getItem("smros_uid") || "anon";

    let shopId = "unknown";
    try {
        const shop = safeParseJson(localStorage.getItem("shop_info") || "{}") || {};
        shopId = shop.shop_id || shop.shopId || shopId;
    } catch (_) { }

    const assessmentId = getAssessmentIdFromUrl() || "no_assessment";
    return `${KPI_COMPLETED_KEY}__${uid}__${shopId}__${assessmentId}`;
}

function getDraft() {
    const raw = localStorage.getItem(getDraftKey());
    if (raw) return safeParseJson(raw);

    // backward compat (older builds)
    const legacy = localStorage.getItem(KPI_DRAFT_KEY);
    if (legacy) {
        const obj = safeParseJson(legacy);
        if (obj && typeof obj === "object") {
            try {
                localStorage.setItem(getDraftKey(), legacy);
                localStorage.removeItem(KPI_DRAFT_KEY);
            } catch (_) { }
            return obj;
        }
    }

    return null;
}

function saveDraftNow() {
    const draft = {};
    KPI_ORDER.forEach((id) => {
        const el = $(id);
        if (!el) return;
        if (el.tagName === "SELECT") {
            draft[id] = el.value || "";
        } else if (el.type === "checkbox") {
            draft[id] = el.checked;
        } else {
            draft[id] = el.value || "";
        }
    });

    // BR-02 custom
    const br02Followers = $("BR-02_followers");
    const br02Post = $("BR-02_post");
    if (br02Followers || br02Post) {
        draft["BR-02"] = {
            followers: br02Followers?.value || "",
            post: br02Post?.checked || false,
        };
    }

    // CAT-02 custom
    const cat02White = $("CAT-02_white");
    const cat02Life = $("CAT-02_life");
    if (cat02White || cat02Life) {
        draft["CAT-02"] = {
            white: cat02White?.checked || false,
            life: cat02Life?.checked || false,
        };
    }

    localStorage.setItem(getDraftKey(), JSON.stringify(draft));
    console.log("[DRAFT] Saved.");
}

let saveDraftTimeout = null;
function saveDraftDebounced() {
    if (saveDraftTimeout) clearTimeout(saveDraftTimeout);
    saveDraftTimeout = setTimeout(saveDraftNow, 500);
}

function loadDraft() {
    const draft = getDraft();
    if (!draft) {
        console.log("[DRAFT] No draft found.");
        return;
    }

    console.log("[DRAFT] Loading draft:", draft);

    KPI_ORDER.forEach((id) => {
        const el = $(id);
        if (!el) return;

        const val = draft[id];

        if (id === "BR-02") {
            const br02Val = draft["BR-02"];
            if (typeof br02Val === "object") {
                const followers = $("BR-02_followers");
                const post = $("BR-02_post");
                if (followers) followers.value = br02Val.followers || "";
                if (post) post.checked = br02Val.post || false;
            }
            return;
        }

        if (id === "CAT-02") {
            const cat02Val = draft["CAT-02"];
            if (typeof cat02Val === "object") {
                const white = $("CAT-02_white");
                const life = $("CAT-02_life");
                if (white) white.checked = cat02Val.white || false;
                if (life) life.checked = cat02Val.life || false;
            }
            return;
        }

        if (el.tagName === "SELECT") {
            el.value = val || "";
        } else if (el.type === "checkbox") {
            el.checked = Boolean(val);
        } else {
            el.value = val || "";
        }
    });

    console.log("[DRAFT] Loaded.");
}

function resetDraft() {
    if (confirm("Bạn có chắc muốn xóa draft hiện tại?")) {
        localStorage.removeItem(getDraftKey());
        location.reload();
    }
}

// =========================
// KPI Rule Scoring
// =========================

function getGroupOfKpi(ruleId) {
    const id = String(ruleId).toUpperCase();
    if (id.startsWith("OP-") || id.startsWith("CS-") || id.startsWith("PEN-") || id.startsWith("CO-")) return "Operation";
    if (id.startsWith("BR-")) return "Brand";
    if (id.startsWith("CAT-")) return "Category";
    if (id.startsWith("SC-")) return "Scale";
    return "Operation";
}

// ✅ FIX: Use consistent group naming function (same as analysis_engine.js)
function groupOfKpi(ruleId) {
    return getGroupOfKpi(ruleId);
}

function scoreKpi(ruleId) {
    const rule = KPI_RULES[ruleId];
    if (!rule) {
        console.warn("[KPI] Rule not found:", ruleId);
        return 0;
    }

    const value = (() => {
        const el = $(ruleId);
        if (!el) return null;

        if (ruleId === "BR-02") {
            const followers = Number($("BR-02_followers")?.value || 0);
            return followers;
        }

        if (ruleId === "CAT-02") {
            const white = $("CAT-02_white")?.checked || false;
            const life = $("CAT-02_life")?.checked || false;
            return { white, life };
        }

        if (el.type === "checkbox") return el.checked ? 1 : 0;
        return Number(el.value || 0);
    })();

    if (value === null || value === "") return 0;

    // ===== SCORING ======
    if (rule.method === "RANGE") {
        const v = Number(value || 0);
        const t1 = Number(rule.t1 ?? 0);
        const t2 = Number(rule.t2 ?? 0);
        const dir = String(rule.direction || "GE").toUpperCase();

        if (dir === "GE") {
            if (v >= t1) return 100;
            if (v >= t2) return 50;
            return 0;
        }

        if (dir === "LE") {
            if (v <= t1) return 100;
            if (v <= t2) return 50;
            return 0;
        }

        return 0;
    }

    if (rule.method === "BINARY") {
        return value ? 100 : 0;
    }

    if (rule.method === "CUSTOM") {
        // BR-02: followers check
        if (ruleId === "BR-02") {
            const followers = Number(value || 0);
            const t1 = Number(rule.t1 ?? 5000);
            return followers >= t1 ? 100 : 0;
        }

        // CAT-02: white-bg + lifestyle
        if (ruleId === "CAT-02") {
            const { white = false, life = false } = value || {};
            let score = 0;
            if (white) score += 50;
            if (life) score += 50;
            return score; // 0 / 50 / 100
        }

        // BR-01, BR-03: offline (placeholder)
        return 0;
    }

    return 0;
}

// =========================
// Checklist UI
// =========================

function syncKpiCardsFromRules() {
    // Ensure all KPI in KPI_ORDER have corresponding cards/inputs
    // (If not, create placeholder divs)
    const container = $("kpiCardsContainer");
    if (!container) return;

    const existing = new Set(
        Array.from(container.querySelectorAll("[data-kpi]")).map((el) => el.getAttribute("data-kpi"))
    );

    KPI_ORDER.forEach((id) => {
        if (!existing.has(id)) {
            console.warn(`[KPI] No card for ${id} — skipping sync`);
        }
    });
}

function updateChecklistItem(ruleId) {
    const rule = KPI_RULES[ruleId];
    if (!rule) return;

    const score = scoreKpi(ruleId);

    const item = document.querySelector(`[data-kpi="${ruleId}"]`);
    if (item) {
        item.setAttribute("data-score", score);
        item.classList.toggle("scored", score > 0);
        item.classList.toggle("missing", score === 0);

        const badge = item.querySelector(".badge");
        if (badge) {
            badge.textContent = score === 100 ? "✓" : score === 50 ? "◐" : "◯";
            badge.classList.toggle("full", score === 100);
            badge.classList.toggle("partial", score === 50);
            badge.classList.toggle("empty", score === 0);
        }
    }
}

function renderChecklist() {
    const html = KPI_ORDER.map((id) => {
        const rule = KPI_RULES[id];
        if (!rule) return "";

        const group = groupOfKpi(id);

        let inputHtml = "";
        if (rule.method === "RANGE") {
            inputHtml = `<input type="number" id="${id}" placeholder="Nhập giá trị" />`;
        } else if (rule.method === "BINARY") {
            inputHtml = `<select id="${id}">
        <option value="">Chọn</option>
        <option value="1">Có</option>
        <option value="0">Không</option>
      </select>`;
        } else if (rule.method === "CUSTOM") {
            if (id === "BR-02") {
                inputHtml = `
          <div class="custom-input">
            <input type="number" id="BR-02_followers" placeholder="Followers" />
            <label><input type="checkbox" id="BR-02_post" /> Post link (✓ có)</label>
          </div>
        `;
            } else if (id === "CAT-02") {
                inputHtml = `
          <div class="custom-input">
            <label><input type="checkbox" id="CAT-02_white" /> White-bg</label>
            <label><input type="checkbox" id="CAT-02_life" /> Lifestyle</label>
          </div>
        `;
            } else {
                inputHtml = `<input type="text" id="${id}" placeholder="N/A" disabled />`;
            }
        }

        return `
      <div class="kpi-card" data-kpi="${id}" data-group="${group}">
        <div class="badge empty">◯</div>
        <div class="content">
          <div class="label">${id}</div>
          <div class="name">${rule.name}</div>
          <div class="input-wrap">${inputHtml}</div>
        </div>
      </div>
    `;
    }).join("");

    const container = $("kpiCardsContainer");
    if (container) container.innerHTML = html;
}

function updateProgress() {
    const total = KPI_ORDER.length;
    const scored = KPI_ORDER.filter((id) => scoreKpi(id) > 0).length;
    const pct = total > 0 ? Math.round((scored / total) * 100) : 0;

    const progressBar = $("progressBar");
    if (progressBar) progressBar.style.width = pct + "%";

    const progressLabel = $("progressLabel");
    if (progressLabel) progressLabel.textContent = `${scored} / ${total}`;
}

function validateAll() {
    const missing = [];
    for (const id of KPI_ORDER) {
        if (scoreKpi(id) === 0) missing.push(id);
    }

    return {
        ok: missing.length === 0,
        missing,
    };
}

// =========================
// MRSM Computation (Core)
// =========================

async function computeMRSM() {
    const breakdown = [];
    let totalScore = 0;

    KPI_ORDER.forEach((id) => {
        const rule = KPI_RULES[id];
        if (!rule) return;

        const score = scoreKpi(id);
        const group = groupOfKpi(id);

        // ✅ FIX #7: Save weight_final (normalized) not weight_raw
        breakdown.push({
            id,
            rule_id: id,
            name: rule.name,
            score,
            group,
            weight: rule.weight_raw,
            weight_final: rule.weight_final, // ✅ Use normalized weight
            method: rule.method,
            direction: rule.direction,
            t1: rule.t1,
            t2: rule.t2,
        });
    });

    // Compute total weighted score
    const sumW = breakdown.reduce((s, k) => s + (k.weight_final || 0), 0) || 1;
    totalScore = breakdown.reduce((s, k) => s + k.score * (k.weight_final || 0), 0) / sumW;

    if (!Number.isFinite(totalScore)) totalScore = 0;

    const tier = (() => {
        if (totalScore < 50) return "NOT_READY";
        if (totalScore <= 69) return "PARTIALLY_READY";
        if (totalScore <= 84) return "NEAR_MALL_READY";
        return "MALL_READY";
    })();

    console.log("[MRSM] Computed:", { totalScore, tier, breakdown });

    return {
        breakdown,
        totalScore: Math.round(totalScore * 100) / 100,
        tier,
    };
}

// =========================
// Hard KO validation (no change)
// =========================

function requireHardGateOrRedirect() {
    const hardRaw = sessionStorage.getItem("validatedHardKO");
    const hard = hardRaw ? safeParseJson(hardRaw) : null;
    if (!hard || typeof hard !== "object") {
        window.location.href = "KO_GATE.html";
        return false;
    }
    return true;
}

function requireSoftGatePassOrRedirect() {
    const softRaw = localStorage.getItem("soft_ko_gate");
    const soft = softRaw ? safeParseJson(softRaw) : null;
    if (!soft || typeof soft !== "object" || !soft.gate_status) {
        window.location.href = "SOFT_KO.html";
        return false;
    }
    if (String(soft.gate_status).toUpperCase() !== "PASS") {
        window.location.href = "SOFT_KO.html";
        return false;
    }
    return true;
}

// =========================
// Storage & Redirect -> RESULTS
// =========================
function saveAndRedirect(resultObj) {
    const getQueryParam = (name) => {
        try {
            return new URL(window.location.href).searchParams.get(name);
        } catch {
            return null;
        }
    };

    const softGate = safeParseJson(localStorage.getItem("soft_ko_gate") || "null");

    // ✅ FIX #8: Ensure gate_status is "PASS" when soft gate passes
    const payload = {
        ...resultObj,
        breakdown: Array.isArray(resultObj?.breakdown) ? resultObj.breakdown : [],
        kpis: Array.isArray(resultObj?.breakdown) ? resultObj.breakdown : [], // ✅ FIX: Sync kpis with breakdown
        computedAt: resultObj?.computedAt || new Date().toISOString(),
        version: resultObj?.version || "MRSM_WSM_v2",

        gate: (() => {
            const hard = safeParseJson(sessionStorage.getItem("validatedHardKO") || "null");
            const softStatus = softGate?.gate_status ? String(softGate.gate_status).toUpperCase() : "UNKNOWN";
            return {
                status: softStatus, // ✅ Should be "PASS" if soft gate passes
                hard: {
                    verified_at: hard?.verifiedAt || hard?.verified_at || null,
                    metrics: hard?.metrics || null,
                    files: hard?.files || null,
                    files_meta: hard?.files_meta || null,
                },
                soft: softGate ? softGate.soft || null : null,
            };
        })(),
    };

    localStorage.setItem("assessment_result", JSON.stringify(payload));

    // ✅ FIX #7: Normalize for dashboard local adapter - ensure weight_final is included
    const kpisNormalized = (payload.breakdown || []).map((k) => {
        const id = k.id || k.rule_id || k.kpiId;
        const wf = Number(k.weight_final ?? k.weight ?? 0);
        return {
            ...k,
            id,
            rule_id: id,
            kpiId: id,
            group: k.group || groupOfKpi(id),
            weight_final: wf,
            weight: wf,
        };
    });

    const assessmentRecordLocal = {
        assessment_id: "LOCAL_" + Date.now(),
        evaluated_at: payload.computedAt,
        shop: { shop_name: "—", shop_id: "—" },
        gate: payload.gate || { status: "UNKNOWN" },
        mrsm: {
            final_score: Number(payload.totalScore ?? 0),
            tier: payload.tier || "NOT_READY",
        },
        groups: {},
        kpis: kpisNormalized,
    };

    localStorage.setItem("assessment_record_local", JSON.stringify(assessmentRecordLocal));

    // Resolve shop info best-effort
    let shop_name = String(getQueryParam("shop_name") || getQueryParam("shopName") || "").trim();
    let shop_id = String(getQueryParam("shop_id") || getQueryParam("shopId") || "").trim();

    if (!shop_name || !shop_id) {
        const sObj = safeParseJson(localStorage.getItem("shop_info") || "null");
        if (sObj) {
            shop_name = shop_name || String(sObj.shop_name || sObj.shopName || "").trim();
            shop_id = shop_id || String(sObj.shop_id || sObj.shopId || "").trim();
        }
    }

    shop_name = shop_name || "—";
    shop_id = shop_id || "—";
    localStorage.setItem("shop_info", JSON.stringify({ shop_name, shop_id }));

    // redirect with assessment_id (sync keys for RESULTS)
    const url = new URL(window.location.href);
    let aid = url.searchParams.get("assessment_id") || sessionStorage.getItem("current_assessment_id") || `LOCAL_${Date.now()}`;
    sessionStorage.setItem("current_assessment_id", aid);

    try {
        assessmentRecordLocal.assessment_id = aid;
        assessmentRecordLocal.shop = { shop_name, shop_id };

        localStorage.setItem("assessment_record_local", JSON.stringify(assessmentRecordLocal));
        localStorage.setItem("assessment_record_latest", JSON.stringify(assessmentRecordLocal));
        localStorage.setItem(`assessment_record__${aid}`, JSON.stringify(assessmentRecordLocal));
        localStorage.setItem(`assessment_result__${aid}`, JSON.stringify(payload));
    } catch (e) {
        console.warn("SYNC local record failed:", e);
    }

    window.location.href = `RESULTS.html?assessment_id=${encodeURIComponent(aid)}`;
}

// =========================
// Events
// =========================
function bindEvents() {
    KPI_ORDER.forEach((id) => {
        // BR-02
        if (id === "BR-02") {
            ["BR-02_followers", "BR-02_post"].forEach((fid) => {
                const el = document.getElementById(fid);
                if (!el) return;
                el.addEventListener("input", () => {
                    updateChecklistItem("BR-02");
                    updateProgress();
                    saveDraftDebounced();
                });
                el.addEventListener("change", () => {
                    updateChecklistItem("BR-02");
                    updateProgress();
                    saveDraftDebounced();
                });
            });
            return;
        }

        // CAT-02
        if (id === "CAT-02") {
            ["CAT-02_white", "CAT-02_life"].forEach((fid) => {
                const el = document.getElementById(fid);
                if (!el) return;
                el.addEventListener("change", () => {
                    updateChecklistItem("CAT-02");
                    updateProgress();
                    saveDraftDebounced();
                });
            });
            return;
        }

        const el = document.getElementById(id);
        if (!el) return;

        const evt = el.tagName === "SELECT" ? "change" : "input";
        el.addEventListener(evt, () => {
            updateChecklistItem(id);
            updateProgress();
            saveDraftDebounced();
        });
        el.addEventListener("change", () => {
            updateChecklistItem(id);
            updateProgress();
            saveDraftDebounced();
        });
    });

    const btnBack = document.getElementById("btnBack");
    if (btnBack) btnBack.addEventListener("click", () => history.back());

    const btn = document.getElementById("btnResult");
    if (btn) {
        btn.addEventListener("click", async () => {
            const v = validateAll();
            if (!v.ok) {
                showToast("error", "Thiếu dữ liệu", `Bạn chưa nhập đủ KPI: ${v.missing.join(", ")}`);
                v.missing.forEach(updateChecklistItem);
                updateProgress();
                return;
            }

            const result = await computeMRSM();
            saveDraftNow();

            saveAndRedirect({
                ...result,
                computedAt: new Date().toISOString(),
                version: "MRSM_WSM_v2",
            });
        });
    }

    const resetBtn = document.getElementById("btnResetDraft");
    if (resetBtn) resetBtn.addEventListener("click", resetDraft);
}

// =========================
// Toast (placeholder)
// =========================
function showToast(type, title, message) {
    console.log(`[${type.toUpperCase()}] ${title}: ${message}`);
}

// =========================
// Init
// =========================
document.addEventListener("DOMContentLoaded", () => {
    if (!requireHardGateOrRedirect()) return;
    if (!requireSoftGatePassOrRedirect()) return;

    syncKpiCardsFromRules();

    const params = new URLSearchParams(window.location.search);
    const restoreDraft = params.get("restore_draft") === "1";
    if (restoreDraft) loadDraft();

    renderChecklist();
    KPI_ORDER.forEach(updateChecklistItem);
    updateProgress();

    bindEvents();
});
