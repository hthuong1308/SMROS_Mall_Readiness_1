/**
 * ============================================================
 * SMRSS – MRSM KPI SCORING CORE LOGIC (WSM v2) — OPTIMIZED v1
 * ============================================================
 * Optimizations:
 * 1) Strict checklist (no "fake ✓"): BR-02 requires BOTH fields; CAT-02 requires BOTH images or draft-evidence.
 * 2) Never disable "Xem kết quả" button; validate on click with clear missing list.
 * 3) CAT-02 file restore limitation workaround:
 *    - Browser can't restore file inputs; if draft has 2 filenames -> treat as completed + score=100 (flag meta).
 */

const KPI_RULES = {
    // OPERATION (0.50)
    "OP-01": { name: "Tỷ lệ giao hàng trễ (LSR)", method: "RANGE", direction: "LE", t1: 8, t2: 12, weight: 0.08 },
    "OP-02": { name: "Tỷ lệ đơn hàng không thành công (NFR)", method: "RANGE", direction: "LE", t1: 8, t2: 12, weight: 0.08 },
    "OP-03": { name: "Tỷ lệ đánh giá tiêu cực (NRR)", method: "RANGE", direction: "LE", t1: 2, t2: 5, weight: 0.05 },
    "OP-04": { name: "Tỷ lệ giao hàng nhanh", method: "RANGE", direction: "GE", t1: 95, t2: 80, weight: 0.05 },

    "CS-01": { name: "Tỷ lệ phản hồi Chat", method: "RANGE", direction: "GE", t1: 80, t2: 60, weight: 0.05 },
    "CS-02": { name: "Thời gian phản hồi Chat (h)", method: "RANGE", direction: "LE", t1: 4, t2: 8, weight: 0.05 },

    "PEN-01": { name: "Điểm phạt Sao Quả Tạ", method: "RANGE", direction: "LE", t1: 0, t2: 2, weight: 0.04 },

    "CO-01": { name: "Tỷ lệ hàng đặt trước (%)", method: "RANGE", direction: "LE", t1: 5, t2: 10, weight: 0.05 },
    "CO-02": { name: "Không vi phạm cộng đồng", method: "BINARY", direction: "BOOL", t1: null, t2: null, weight: 0.05 },

    // BRAND (0.20)
    "BR-01": { name: "Website ổn định (domain check)", method: "CUSTOM", direction: "URL_OK", t1: null, t2: null, weight: 0.08 },
    "BR-02": { name: "Hiện diện MXH (followers + post link)", method: "CUSTOM", direction: "SOCIAL_2COND", t1: 5000, t2: null, weight: 0.08 },
    "BR-03": { name: "Độ phủ Offline (địa chỉ cửa hàng)", method: "CUSTOM", direction: "NONEMPTY_TEXT", t1: null, t2: null, weight: 0.04 },

    // CATEGORY (0.15)
    "CAT-01": { name: "Số lượng sản phẩm hoạt động (SKU)", method: "RANGE", direction: "GE", t1: 50, t2: 5, weight: 0.0375 },
    "CAT-02": { name: "Ảnh đạt chuẩn (white bg + lifestyle + không vi phạm)", method: "CUSTOM", direction: "IMG_2CHECK", t1: null, t2: null, weight: 0.0375 },
    "CAT-03": { name: "Sản phẩm bị khóa/xóa", method: "BINARY", direction: "BOOL", t1: null, t2: null, weight: 0.0525 },
    "CAT-04": { name: "Các vi phạm khác", method: "BINARY", direction: "BOOL", t1: null, t2: null, weight: 0.0225 },

    // SCALE (0.15)
    "SC-01": { name: "Doanh số 4w (Triệu VNĐ)", method: "RANGE", direction: "GE", t1: 50, t2: 30, weight: 0.075 },
    "SC-02": { name: "Số đơn hàng 4w", method: "RANGE", direction: "GE", t1: 250, t2: 150, weight: 0.045 },
    "SC-03": { name: "Tăng trưởng doanh số (%)", method: "RANGE", direction: "GE", t1: 5, t2: 0, weight: 0.03 },
};

const KPI_ORDER = [
    "OP-01", "OP-02", "OP-03", "OP-04", "CS-01", "CS-02", "PEN-01",
    "BR-01", "BR-02", "BR-03",
    "CAT-01", "CAT-02", "CAT-03", "CAT-04",
    "SC-01", "SC-02", "SC-03",
    "CO-01", "CO-02"
];

function $(id) { return document.getElementById(id); }

/* =========================
   Draft Storage (Autosave + Rehydrate)
========================= */
const KPI_DRAFT_KEY = "SMROS_KPI_DRAFT_V1";
const KPI_COMPLETED_KEY = "SMROS_KPI_COMPLETED_V1";

function getDraftKey() {
    // Priority 1: sessionStorage
    const sid = (sessionStorage.getItem("current_assessment_id") || "").trim();
    if (sid) return "SMROS_DRAFT_" + sid;

    // Priority 2: URL param
    try {
        const qid = (new URL(window.location.href).searchParams.get("assessment_id") || "").trim();
        if (qid) return "SMROS_DRAFT_" + qid;
    } catch (_) { }

    // Fallback
    return "SMROS_DRAFT_TEMP";
}

function getCompletedKey() {
    const dk = getDraftKey();
    if (dk === "SMROS_DRAFT_TEMP") return KPI_COMPLETED_KEY; // safe fallback
    return "SMROS_KPI_COMPLETED_" + dk.replace("SMROS_DRAFT_", "");
}

function safeJsonParse(s) { try { return JSON.parse(s); } catch { return null; } }


function resetDraft() {
    if (!confirm("Bạn có chắc muốn xóa toàn bộ dữ liệu đã nhập không?")) return;

    const key = getDraftKey();
    // Xóa draft theo assessment_id (nếu có)
    if (key && key !== "SMROS_DRAFT_TEMP") {
        localStorage.removeItem(key);
    } else if (key) {
        // temp draft cũng nên xóa nếu có
        localStorage.removeItem(key);
    }

    // Dọn legacy keys (nếu còn)
    try { localStorage.removeItem("SMROS_KPI_DRAFT_V1"); } catch (_) { }
    try { localStorage.removeItem("SMROS_KPI_COMPLETED_V1"); } catch (_) { }
    try { localStorage.removeItem(KPI_COMPLETED_KEY); } catch (_) { }

    // Reload lại đúng URL hiện tại
    window.location.reload();
}

function getDraft() {
    const key = getDraftKey();
    if (key === "SMROS_DRAFT_TEMP") return null;

    // Migrate legacy draft to dynamic key (one-time best effort)
    if (!localStorage.getItem(key)) {
        const legacy = localStorage.getItem(KPI_DRAFT_KEY);
        if (legacy) localStorage.setItem(key, legacy);
    }

    return safeJsonParse(localStorage.getItem(key) || "");
}

function getDraftCat02Names() {
    const d = getDraft()?.data || {};
    const wn = (d["CAT-02_white_name"] || "").trim();
    const ln = (d["CAT-02_life_name"] || "").trim();
    return { wn, ln, hasBoth: !!wn && !!ln, hasAny: !!wn || !!ln };
}

function collectDraft() {
    const data = {};

    KPI_ORDER.forEach((id) => {
        if (id === "BR-02" || id === "CAT-02") return;
        const el = document.getElementById(id);
        if (!el) return;
        data[id] = el.value;
    });

    // BR-02
    data["BR-02_followers"] = document.getElementById("BR-02_followers")?.value ?? "";
    data["BR-02_post"] = document.getElementById("BR-02_post")?.value ?? "";

    // CAT-02: file names only (browser cannot restore file inputs)
    data["CAT-02_white_name"] = document.getElementById("CAT-02_white")?.files?.[0]?.name ?? "";
    data["CAT-02_life_name"] = document.getElementById("CAT-02_life")?.files?.[0]?.name ?? "";

    // Optional hybrid controls (if later you add)
    data["CAT-02_decision"] = document.getElementById("CAT-02_decision")?.value ?? "";
    data["CAT-02_passcount"] = document.getElementById("CAT-02_passcount")?.value ?? "";
    data["CAT-02_reason"] = document.getElementById("CAT-02_reason")?.value ?? "";

    return data;
}

function isFilledStrict(ruleId) {
    // BR-02: STRICT = both required
    if (ruleId === "BR-02") {
        const f = String($("BR-02_followers")?.value ?? "").trim();
        const u = String($("BR-02_post")?.value ?? "").trim();
        return !!f && !!u;
    }

    // CAT-02: STRICT = both files OR draft evidence has both
    if (ruleId === "CAT-02") {
        const a = $("CAT-02_white")?.files?.length ? 1 : 0;
        const b = $("CAT-02_life")?.files?.length ? 1 : 0;
        if (a && b) return true;
        return getDraftCat02Names().hasBoth;
    }

    const el = $(ruleId);
    if (!el) return false;

    if (el.tagName === "SELECT") return el.value !== "";

    const raw = el.value;
    if (raw === "" || raw === null || raw === undefined) return false;

    if (el.type === "text" || el.type === "url") return String(raw).trim().length > 0;

    const n = Number(raw);
    return !Number.isNaN(n);
}

function computeCompletionFromDom() {
    let count = 0;
    KPI_ORDER.forEach((id) => { if (isFilledStrict(id)) count++; });
    return { completed: count === 19, count };
}

function saveDraftNow() {
    const key = getDraftKey();
    if (key === "SMROS_DRAFT_TEMP") return; // never persist without an assessment_id

    const payload = { savedAt: new Date().toISOString(), data: collectDraft() };
    localStorage.setItem(key, JSON.stringify(payload));

    const { completed } = computeCompletionFromDom();
    localStorage.setItem(getCompletedKey(), completed ? "1" : "0");

    // Review: cập nhật bảng tóm tắt theo realtime
    updateReviewStep();
}

let saveTimer = null;
function saveDraftDebounced(delay = 250) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveDraftNow(), delay);
}

function applyDraft(payload) {
    if (!payload?.data) return false;
    const d = payload.data;

    // restore simple inputs/selects
    KPI_ORDER.forEach((id) => {
        if (id === "BR-02" || id === "CAT-02") return;
        const el = document.getElementById(id);
        if (!el) return;
        if (d[id] !== undefined && d[id] !== null) el.value = d[id];
    });

    // restore BR-02
    const f = document.getElementById("BR-02_followers");
    const u = document.getElementById("BR-02_post");
    if (f && d["BR-02_followers"] != null) f.value = d["BR-02_followers"];
    if (u && d["BR-02_post"] != null) u.value = d["BR-02_post"];

    // optional hybrid controls
    const dec = document.getElementById("CAT-02_decision");
    const pc = document.getElementById("CAT-02_passcount");
    const rs = document.getElementById("CAT-02_reason");
    if (dec && d["CAT-02_decision"] != null) dec.value = d["CAT-02_decision"];
    if (pc && d["CAT-02_passcount"] != null) pc.value = d["CAT-02_passcount"];
    if (rs && d["CAT-02_reason"] != null) rs.value = d["CAT-02_reason"];

    // NOTE: cannot restore file inputs
    return true;
}

function loadDraft() {
    const key = getDraftKey();
    if (key === "SMROS_DRAFT_TEMP") return false; // don't autofill when missing assessment_id

    let raw = localStorage.getItem(key);

    // Migrate legacy draft to dynamic key if needed
    if (!raw) {
        const legacy = localStorage.getItem(KPI_DRAFT_KEY);
        if (legacy) {
            localStorage.setItem(key, legacy);
            raw = legacy;
        }
    }

    if (!raw) return false;
    const payload = safeJsonParse(raw);
    if (!payload) return false;
    return applyDraft(payload);
}

/* =========================
   Toast
========================= */
let toastTimer = null;
function showToast(type, title, message, ms = 2600) {
    const toast = $("toast"); if (!toast) return;
    toast.classList.remove("error", "success"); toast.classList.add(type);
    const t = $("toastTitle"), m = $("toastMsg"), i = $("toastIcon");
    if (t) t.textContent = title;
    if (m) m.textContent = message;
    if (i) i.textContent = (type === "success" ? "✓" : "!");
    toast.style.display = "block";
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.style.display = "none"; }, ms);
}

/* =========================
   Helpers: URL
========================= */
function normalizeUrl(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    if (!s) return null;
    try {
        const withScheme = s.startsWith("http://") || s.startsWith("https://") ? s : `https://${s}`;
        return new URL(withScheme);
    } catch (_) { return null; }
}
function getRootDomain(hostname) {
    const parts = hostname.split(".").filter(Boolean);
    if (parts.length <= 2) return hostname;
    return parts.slice(-2).join(".");
}
async function bestEffortReachable(urlObj) {
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        await fetch(urlObj.toString(), { method: "GET", mode: "no-cors", signal: ctrl.signal });
        clearTimeout(timer);
        return true;
    } catch (_) {
        return false;
    }
}

/* =========================
   Image heuristic checks
========================= */
function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = reader.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function analyzeImage(img, targetW = 240) {
    const scale = targetW / img.width;
    const w = Math.max(80, Math.round(img.width * Math.min(1, scale)));
    const h = Math.max(80, Math.round(img.height * Math.min(1, scale)));

    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);

    const { data } = ctx.getImageData(0, 0, w, h);
    const totalPx = w * h;

    let nearWhite = 0;
    let sum = 0, sum2 = 0;

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        sum += y; sum2 += y * y;
        if (r >= 235 && g >= 235 && b >= 235) nearWhite++;
    }

    const whiteRatio = nearWhite / totalPx;
    const mean = sum / totalPx;
    const variance = (sum2 / totalPx) - (mean * mean);

    return { whiteRatio, variance };
}

// tune thresholds if needed
function isWhiteBackground(stats) { return stats.whiteRatio >= 0.70 && stats.variance <= 2200; }
function isLifestyle(stats) { return stats.whiteRatio <= 0.55 && stats.variance >= 2500; }

/* =========================
   Standard scoring RANGE/BINARY
========================= */
function scoreKPI(ruleId, value) {
    const rule = KPI_RULES[ruleId];
    if (!rule) return 0;

    if (rule.method === "BINARY" && rule.direction === "BOOL") {
        return value === true ? 100 : 0;
    }

    const v = Number(value);
    if (Number.isNaN(v)) return 0;

    if (rule.direction === "LE") {
        if (v <= rule.t1) return 100;
        if (v > rule.t1 && v <= rule.t2) return 50;
        return 0;
    }

    if (rule.direction === "GE") {
        if (v >= rule.t1) return 100;
        if (v >= rule.t2 && v < rule.t1) return 50;
        return 0;
    }

    return 0;
}

/* =========================
   Custom scoring (async)
========================= */
async function scoreCustom(ruleId) {
    // BR-01
    if (ruleId === "BR-01") {
        const urlObj = normalizeUrl($("BR-01")?.value);
        if (!urlObj) return { score: 0, meta: { urlOk: false, reachable: false } };

        const root = getRootDomain(urlObj.hostname);
        const reachable = await bestEffortReachable(urlObj);

        const score = reachable ? 100 : 50;
        return { score, meta: { urlOk: true, rootDomain: root, reachable } };
    }

    // BR-02
    if (ruleId === "BR-02") {
        const followersRaw = $("BR-02_followers")?.value;
        const postUrlRaw = $("BR-02_post")?.value;

        const followers = Number(followersRaw);
        const condFollowers = Number.isFinite(followers) && followers >= KPI_RULES["BR-02"].t1;

        const postUrlObj = normalizeUrl(postUrlRaw);
        const condLink = !!postUrlObj;

        const passCount = (condFollowers ? 1 : 0) + (condLink ? 1 : 0);
        const score = passCount === 2 ? 100 : (passCount === 1 ? 50 : 0);

        return { score, meta: { followers, condFollowers, condLink } };
    }

    // BR-03
    if (ruleId === "BR-03") {
        const addr = $("BR-03")?.value ?? "";
        const ok = String(addr).trim().length > 0;
        return { score: ok ? 100 : 0, meta: { hasAddress: ok } };
    }

    // CAT-02 (AUTO + fallback from draft)
    if (ruleId === "CAT-02") {
        const fWhite = $("CAT-02_white")?.files?.[0] || null;
        const fLife = $("CAT-02_life")?.files?.[0] || null;

        // If no files (due to browser restore limitation) but draft has 2 filenames -> treat as completed evidence
        if (!fWhite && !fLife) {
            const { wn, ln, hasBoth } = getDraftCat02Names();
            if (hasBoth) {
                return {
                    score: 100,
                    finalScore: 100,
                    meta: {
                        restored_from_draft: true,
                        draft_white_name: wn,
                        draft_life_name: ln,
                        note: "Browser không phục hồi file input; dùng minh chứng đã lưu từ draft."
                    }
                };
            }
            return { score: 0, finalScore: 0, meta: { restored_from_draft: false, reason: "missing_both" } };
        }

        // AUTO analyze selected files
        let whiteOk = false, lifeOk = false;

        if (fWhite) {
            try {
                const img = await loadImageFromFile(fWhite);
                whiteOk = isWhiteBackground(analyzeImage(img));
            } catch (_) { whiteOk = false; }
        }
        if (fLife) {
            try {
                const img = await loadImageFromFile(fLife);
                lifeOk = isLifestyle(analyzeImage(img));
            } catch (_) { lifeOk = false; }
        }

        const passCount = (whiteOk ? 1 : 0) + (lifeOk ? 1 : 0);
        const autoScore = passCount === 2 ? 100 : (passCount === 1 ? 50 : 0);

        return {
            score: autoScore,
            finalScore: autoScore,
            meta: {
                whiteOk,
                lifeOk,
                auto_score: autoScore,
                final_score: autoScore,
                restored_from_draft: false
            }
        };
    }

    return { score: 0, meta: { reason: "unknown_custom_rule" } };
}

/* =========================
   Checklist / progress
========================= */
function renderChecklist() {
    const root = $("kpiChecklist"); if (!root) return;
    root.innerHTML = KPI_ORDER.map((id) => {
        const name = KPI_RULES[id]?.name || "";
        return `
      <div class="ck-item" id="ck-${id}">
        <div class="ck-dot" id="dot-${id}">○</div>
        <div class="ck-text">
          <div class="id">${id}</div>
          <div class="name">${name}</div>
        </div>
      </div>
    `;
    }).join("");
}

function updateChecklistItem(ruleId) {
    const item = $(`ck-${ruleId}`); if (!item) return;
    const done = isFilledStrict(ruleId);

    item.classList.toggle("done", done);
    const dot = $(`dot-${ruleId}`); if (dot) dot.textContent = done ? "✓" : "○";

    const statusEl = $(`status-${ruleId}`);
    if (!statusEl) return;

    if (ruleId === "CAT-02") {
        const a = $("CAT-02_white")?.files?.length ? 1 : 0;
        const b = $("CAT-02_life")?.files?.length ? 1 : 0;
        const { wn, ln, hasBoth, hasAny } = getDraftCat02Names();

        if (a && b) {
            statusEl.textContent = "Đã nhập (đã chọn đủ 2 ảnh)";
            statusEl.classList.add("ok");
            return;
        }
        if (hasBoth) {
            statusEl.textContent = `Đã lưu minh chứng: ${wn} | ${ln} (không phục hồi file input; hệ thống dùng draft để tính)`;
            statusEl.classList.add("ok");
            return;
        }
        if (hasAny) {
            statusEl.textContent = `Đã lưu 1 phần: ${wn || "—"} | ${ln || "—"} (cần đủ 2 ảnh để hoàn tất)`;
            statusEl.classList.remove("ok");
            return;
        }

        statusEl.textContent = "Chưa nhập dữ liệu";
        statusEl.classList.remove("ok");
        return;
    }

    statusEl.textContent = done ? "Đã nhập" : "Chưa nhập dữ liệu";
    statusEl.classList.toggle("ok", done);
}

function updateProgress() {
    let count = 0;
    KPI_ORDER.forEach((id) => { if (isFilledStrict(id)) count++; });

    const c = $("progressCount");
    const t = $("progressText");
    if (c) c.textContent = String(count);

    if (t) {
        if (count === 19) t.textContent = "Hoàn tất";
        else t.textContent = `Thiếu ${19 - count} KPI`;
    }

    // OPT #2: never disable button
    const btn = $("btnResult");
    if (btn) btn.disabled = false;


    // Review section visible only when 19/19 complete
    const review = document.getElementById("review-section");
    if (review) review.style.display = (count === 19 ? "block" : "none");
}


/* =========================
   Review step (Bước 4)
   - Render summary of entered values into #review-content
========================= */
function escapeHtml(s) {
    return String(s ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function getDisplayValue(ruleId) {
    // BR-02: 2 inputs
    if (ruleId === "BR-02") {
        const f = String($("BR-02_followers")?.value ?? "").trim();
        const u = String($("BR-02_post")?.value ?? "").trim();
        const parts = [];
        parts.push(`Followers: ${f || "Chưa nhập"}`);
        parts.push(`Post link: ${u || "Chưa nhập"}`);
        return parts.join(" | ");
    }

    // CAT-02: 2 files OR draft evidence
    if (ruleId === "CAT-02") {
        const white = $("CAT-02_white")?.files?.[0]?.name ?? "";
        const life = $("CAT-02_life")?.files?.[0]?.name ?? "";
        if (white || life) return `White: ${white || "Chưa chọn"} | Lifestyle: ${life || "Chưa chọn"}`;

        const { wn, ln, hasBoth, hasAny } = getDraftCat02Names();
        if (hasBoth) return `Draft evidence: ${wn} | ${ln}`;
        if (hasAny) return `Draft 1 phần: ${wn || "—"} | ${ln || "—"}`;
        return "Chưa nhập";
    }

    const el = $(ruleId);
    if (!el) return "Chưa nhập";
    const raw = (el.value ?? "");
    const v = String(raw).trim();
    return v ? v : "Chưa nhập";
}
function updateReviewStep() {
    const reviewDiv = $("review-content");
    if (!reviewDiv) return;

    const groups = [
        {
            key: "ops",
            icon: "⚙️",
            title: "Nhóm Vận Hành",
            cardClass: "review-card--blue",
            match: (id) => id.startsWith("OP-") || id.startsWith("CS-") || id.startsWith("PEN-") || id.startsWith("CO-"),
        },
        {
            key: "brand",
            icon: "💎",
            title: "Nhóm Thương Hiệu",
            cardClass: "review-card--purple",
            match: (id) => id.startsWith("BR-"),
        },
        {
            key: "cat",
            icon: "📂",
            title: "Nhóm Danh Mục",
            cardClass: "review-card--emerald",
            match: (id) => id.startsWith("CAT-"),
        },
        {
            key: "scale",
            icon: "📈",
            title: "Nhóm Quy Mô",
            cardClass: "review-card--amber",
            match: (id) => id.startsWith("SC-"),
        },
    ];

    const isMissingValue = (val) => {
        const s = String(val ?? "");
        return s === "Chưa nhập" || s.includes("Chưa nhập") || s.includes("Chưa chọn");
    };

    const groupItems = (g) => KPI_ORDER.filter((id) => g.match(id));

    let html = `<div class="review-grid">`;

    groups.forEach((g) => {
        const items = groupItems(g);

        // count missing within this group (for header badge)
        let missingCount = 0;
        items.forEach((id) => {
            const val = getDisplayValue(id);
            if (isMissingValue(val)) missingCount++;
        });

        html += `
      <div class="review-card ${escapeHtml(g.cardClass)}" data-group="${escapeHtml(g.key)}">
        <div class="review-card-head">
          <div class="review-head-left">
            <div class="review-card-icon">${escapeHtml(g.icon)}</div>
            <div class="review-card-title">${escapeHtml(g.title)}</div>
          </div>
          <div class="review-card-meta">${missingCount > 0 ? `${missingCount} thiếu` : `Đủ`}</div>
        </div>
        <div class="review-rows">
    `;

        items.forEach((id) => {
            const name = KPI_RULES[id]?.name || id;
            const val = getDisplayValue(id);
            const missing = isMissingValue(val);

            html += `
        <div class="review-row ${missing ? "review-row--missing" : ""}">
          <div class="review-label">
            <span class="review-id">${escapeHtml(id)}</span>
            <span class="review-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
            <span class="review-dots" aria-hidden="true"></span>
          </div>
          <div class="review-value ${missing ? "missing" : ""}"><strong>${escapeHtml(val)}</strong></div>
        </div>
      `;
        });

        html += `
        </div>
      </div>
    `;
    });

    html += `</div>`;
    reviewDiv.innerHTML = html;
}


/* =========================
   UI Sync name + requirement text
========================= */
function formatRangeRequirement(ruleId, rule) {
    const el = $(ruleId);
    const suffixEl = el?.closest(".kpi-card")?.querySelector(".suffix");
    const suffix = suffixEl ? suffixEl.textContent.trim() : "";
    const fmt = (x) => `${x}${suffix ? suffix : ""}`;

    if (rule.direction === "LE") {
        return `
      <div class="req-line">Mục tiêu (100đ): <strong>≤ ${fmt(rule.t1)}</strong></div>
      <div class="req-line"><span class="muted">Ngưỡng đạt (50đ): ≤ ${fmt(rule.t2)}</span></div>
    `;
    }
    if (rule.direction === "GE") {
        return `
      <div class="req-line">Mục tiêu (100đ): <strong>≥ ${fmt(rule.t1)}</strong></div>
      <div class="req-line"><span class="muted">Ngưỡng đạt (50đ): ≥ ${fmt(rule.t2)}</span></div>
    `;
    }
    return "";
}

function syncKpiCardsFromRules() {
    const cards = document.querySelectorAll(".kpi-card");
    cards.forEach((card) => {
        const idEl = card.querySelector(".kpi-id");
        if (!idEl) return;
        const ruleId = idEl.textContent.trim();
        const rule = KPI_RULES[ruleId];
        if (!rule) return;

        const nameEl = card.querySelector(".kpi-name");
        if (nameEl) nameEl.textContent = rule.name;

        const reqEl = card.querySelector(".req");
        if (!reqEl) return;

        if (rule.method === "RANGE") {
            reqEl.classList.remove("le", "ge");
            if (rule.direction === "LE") reqEl.classList.add("le");
            if (rule.direction === "GE") reqEl.classList.add("ge");
            reqEl.innerHTML = formatRangeRequirement(ruleId, rule);
        }
    });
}

/* =========================
   Read value (non-CUSTOM)
========================= */
function readValue(ruleId) {
    const rule = KPI_RULES[ruleId];
    if (!rule) return null;
    if (rule.method === "CUSTOM") return null;

    const el = $(ruleId);
    if (!el) return null;

    if (rule.method === "BINARY" && rule.direction === "BOOL") {
        if (el.value === "true") return true;
        if (el.value === "false") return false;
        return null;
    }

    if (el.value === "" || el.value === null || el.value === undefined) return null;

    const n = Number(el.value);
    if (Number.isNaN(n)) return null;
    return n;
}

/* =========================
   Validation (strict submit)
========================= */
function validateAll() {
    const missing = [];

    KPI_ORDER.forEach((id) => {
        // BR-02: strict submit (both required)
        if (id === "BR-02") {
            const f = String($("BR-02_followers")?.value ?? "").trim();
            const u = String($("BR-02_post")?.value ?? "").trim();
            if (!f || !u) missing.push("BR-02");
            return;
        }

        // CAT-02: strict submit (both files OR draft evidence of both)
        if (id === "CAT-02") {
            const a = $("CAT-02_white")?.files?.length ? 1 : 0;
            const b = $("CAT-02_life")?.files?.length ? 1 : 0;
            if (a && b) return;
            if (getDraftCat02Names().hasBoth) return;
            missing.push("CAT-02");
            return;
        }

        const el = $(id);
        if (!el) { missing.push(id); return; }

        if (el.tagName === "SELECT") {
            if (el.value === "") missing.push(id);
            return;
        }

        const raw = el.value;
        if (raw === "" || raw === null || raw === undefined) { missing.push(id); return; }

        if (el.type === "text" || el.type === "url") {
            if (String(raw).trim().length === 0) missing.push(id);
            return;
        }

        const n = Number(raw);
        if (Number.isNaN(n)) missing.push(id);
    });

    return { ok: missing.length === 0, missing };
}

/* =========================
   Tiering + compute
========================= */
function tiering(totalScore) {
    if (totalScore < 50) return { tier: "Not Ready", note: "Cần cải thiện toàn diện." };
    if (totalScore <= 69) return { tier: "Partially Ready", note: "Có tiềm năng nhưng chưa đủ chuẩn." };
    if (totalScore <= 84) return { tier: "Near Mall-Ready", note: "Rất gần với tiêu chuẩn Mall." };
    return { tier: "Mall-Ready", note: "Sẵn sàng đăng ký Mall." };
}
function round2(x) { return Math.round(x * 100) / 100; }

async function computeMRSM() {
    const breakdown = [];
    let total = 0;

    for (const id of KPI_ORDER) {
        const rule = KPI_RULES[id];

        let score = 0;
        let value = null;
        let meta = null;

        if (rule.method === "CUSTOM") {
            const res = await scoreCustom(id);
            score = (typeof res.finalScore === "number") ? res.finalScore : res.score;
            meta = res.meta;

            if (id === "BR-01") value = $("BR-01")?.value ?? "";
            if (id === "BR-02") value = {
                followers: $("BR-02_followers")?.value ?? "",
                postUrl: $("BR-02_post")?.value ?? ""
            };
            if (id === "BR-03") value = $("BR-03")?.value ?? "";
            if (id === "CAT-02") value = {
                whiteFile: $("CAT-02_white")?.files?.[0]?.name ?? "",
                lifeFile: $("CAT-02_life")?.files?.[0]?.name ?? "",
                draft: getDraftCat02Names()
            };
        } else {
            value = readValue(id);
            score = scoreKPI(id, value);
        }

        const weighted = score * rule.weight;
        total += weighted;

        breakdown.push({
            id,
            name: rule.name,
            method: rule.method,
            direction: rule.direction,
            t1: rule.t1,
            t2: rule.t2,
            // For UI/criteria: separate scoring threshold (utility) from gate threshold (constraint)
            score_threshold: (rule.method === "RANGE") ? { direction: rule.direction, t1: rule.t1, t2: rule.t2 } : null,
            weight: rule.weight,
            value,
            score,
            weightedScore: round2(weighted),
            meta,
        });
    }

    const totalRounded = round2(total);
    const { tier, note } = tiering(totalRounded);
    return { totalScore: totalRounded, tier, note, breakdown };
}
function groupOfKpi(id) {
    if (id.startsWith("OP-") || id.startsWith("CS-") || id.startsWith("PEN-") || id.startsWith("CO-")) return "Vận hành";
    if (id.startsWith("BR-")) return "Thương hiệu";
    if (id.startsWith("CAT-")) return "Danh mục";
    if (id.startsWith("SC-")) return "Quy mô";
    return "Vận hành";
}


/* =========================
   Gate guards (Fail-Closed)
   - Hard KO must be validated before Soft KO / KPI scoring
   - Soft KO must be PASS before KPI scoring
========================= */
function safeParseJson(raw) {
    try { return JSON.parse(raw); } catch { return null; }
}
function requireHardGateOrRedirect() {
    const hardRaw = sessionStorage.getItem("validatedHardKO");
    const hard = hardRaw ? safeParseJson(hardRaw) : null;
    if (!hard || typeof hard !== "object") {
        // Fail-closed: chưa qua Hard KO thì không được chấm điểm
        window.location.href = "KO_GATE.html";
        return false;
    }
    return true;
}
function requireSoftGatePassOrRedirect() {
    const softRaw = localStorage.getItem("soft_ko_gate");
    const soft = softRaw ? safeParseJson(softRaw) : null;
    // Fail-closed: chưa có Soft KO state hoặc chưa PASS -> quay lại Soft KO
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

/* =========================
   Storage & Redirect
========================= */
function saveAndRedirect(resultObj) {
    const safeParseJson = (s) => { try { return JSON.parse(s); } catch { return null; } };
    const getQueryParam = (name) => {
        try { return new URL(window.location.href).searchParams.get(name); }
        catch { return null; }
    };

    const softGateRaw = localStorage.getItem("soft_ko_gate");
    const softGate = softGateRaw ? safeParseJson(softGateRaw) : null;

    const payload = {
        ...resultObj,
        computedAt: resultObj?.computedAt || new Date().toISOString(),
        version: resultObj?.version || "MRSM_WSM_v2",

        // ===== attach gate for RESULTS/DASHBOARD =====
        // Fail-closed: luôn đính kèm cả Hard KO evidence + Soft KO status (nếu thiếu -> UNKNOWN)
        gate: (() => {
            const hardRaw = sessionStorage.getItem("validatedHardKO");
            const hard = hardRaw ? safeParseJson(hardRaw) : null;

            const softStatus = softGate?.gate_status ? String(softGate.gate_status).toUpperCase() : "UNKNOWN";

            return {
                status: softStatus,
                hard: {
                    verified_at: hard?.verifiedAt || hard?.verified_at || null,
                    metrics: hard?.metrics || null,
                    files: hard?.files || null,
                    files_meta: hard?.files_meta || null
                },
                soft: softGate ? (softGate.soft || null) : null
            };
        })()
    };

    localStorage.setItem("assessment_result", JSON.stringify(payload));
    // ✅ BUILD record schema for DASHBOARD (mode=local ưu tiên key này)
    const kpisNormalized = (payload.breakdown || []).map((k) => {
        const id = k.id; // KPI id
        return {
            ...k,
            rule_id: id,
            kpiId: id,
            group: k.group || groupOfKpi(id),
            weight_final: (typeof k.weight === "number") ? k.weight : (k.weight_final ?? 0),
            weight: (typeof k.weight === "number") ? k.weight : (k.weight_final ?? 0),
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
        groups: {},            // dashboard.js tự calc nếu thiếu
        kpis: kpisNormalized    // dashboard render trực tiếp từ đây
    };

    // tạm lưu, lát nữa update shop chuẩn
    localStorage.setItem("assessment_record_local", JSON.stringify(assessmentRecordLocal));

    // Resolve shop info best-effort (keep as your existing approach)
    let shop_name = "";
    let shop_id = "";

    shop_name = (getQueryParam("shop_name") || getQueryParam("shopName") || "").trim();
    shop_id = (getQueryParam("shop_id") || getQueryParam("shopId") || "").trim();

    if (!shop_name || !shop_id) {
        const sRaw = localStorage.getItem("shop_info");
        const sObj = sRaw ? safeParseJson(sRaw) : null;
        if (sObj) {
            shop_name = shop_name || String(sObj.shop_name || sObj.shopName || "").trim();
            shop_id = shop_id || String(sObj.shop_id || sObj.shopId || "").trim();
        }
    }

    if (!shop_name || !shop_id) {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key) continue;

            const raw = localStorage.getItem(key);
            if (!raw) continue;
            if (!(raw.startsWith("{") || raw.startsWith("["))) continue;

            const obj = safeParseJson(raw);
            if (!obj || typeof obj !== "object") continue;

            const candName = obj.shop_name || obj.shopName || obj?.shop?.shop_name || obj?.shop?.shopName;
            const candId = obj.shop_id || obj.shopId || obj?.shop?.shop_id || obj?.shop?.shopId;

            if (!shop_name && candName) shop_name = String(candName).trim();
            if (!shop_id && candId) shop_id = String(candId).trim();

            if (shop_name && shop_id) break;
        }
    }

    shop_name = shop_name || "—";
    shop_id = shop_id || "—";
    localStorage.setItem("shop_info", JSON.stringify({ shop_name, shop_id }));
    // ✅ Update shop info inside assessment_record_local
    try {
        const raw = localStorage.getItem("assessment_record_local");
        const rec = raw ? JSON.parse(raw) : null;
        if (rec) {
            rec.shop = { shop_name, shop_id };
            localStorage.setItem("assessment_record_local", JSON.stringify(rec));
        }
    } catch (_) { }

    // ==== redirect to RESULTS with assessment_id ====
    const url = new URL(window.location.href);

    // ưu tiên assessment_id trên URL
    let aid = url.searchParams.get("assessment_id");

    // fallback sessionStorage
    if (!aid) {
        aid = sessionStorage.getItem("current_assessment_id");
    }

    // fallback cuối cùng
    if (!aid) {
        aid = `A_${Date.now()}`;
    }

    // lưu lại cho chắc
    sessionStorage.setItem("current_assessment_id", aid);

    // redirect
    window.location.href = `RESULTS.html?assessment_id=${encodeURIComponent(aid)}`;
}

/* =========================
   Events
========================= */
function bindEvents() {
    KPI_ORDER.forEach((id) => {
        // BR-02 (2 inputs)
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

        // CAT-02 (files)
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

        // Default
        const el = document.getElementById(id);
        if (!el) return;

        const evt = (el.tagName === "SELECT") ? "change" : "input";
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

    // Back
    const btnBack = document.getElementById("btnBack");
    if (btnBack) btnBack.addEventListener("click", () => history.back());

    // Result (validate on click)
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

            // save draft one last time
            saveDraftNow();

            saveAndRedirect({
                ...result,
                computedAt: new Date().toISOString(),
                version: "MRSM_WSM_v2"
            });
        });
    }
    // Reset draft
    const resetBtn = document.getElementById("btnResetDraft");
    if (resetBtn) {
        resetBtn.addEventListener("click", resetDraft);
    }

}

/* =========================
   Init
========================= */
document.addEventListener("DOMContentLoaded", () => {
    if (!requireHardGateOrRedirect()) return;
    if (!requireSoftGatePassOrRedirect()) return;

    // Sync UI text from rules
    syncKpiCardsFromRules();

    // Load draft before checklist/progress
    // loadDraft();



    // Review: render ngay khi load lại draft
    //updateReviewStep();

    // Checklist
    renderChecklist();
    KPI_ORDER.forEach(updateChecklistItem);
    updateProgress();

    // Bind events
    bindEvents();
});
