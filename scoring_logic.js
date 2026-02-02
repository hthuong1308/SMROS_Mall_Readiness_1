
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
  } catch (_) {}

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
  } catch (_) {}

  const assessmentId = getAssessmentIdFromUrl() || "no_assessment";
  return `${KPI_DRAFT_KEY}__${uid}__${shopId}__${assessmentId}`;
}

function getCompletedKey() {
  const uid = window._auth?.currentUser?.uid || localStorage.getItem("smros_uid") || "anon";

  let shopId = "unknown";
  try {
    const shop = safeParseJson(localStorage.getItem("shop_info") || "{}") || {};
    shopId = shop.shop_id || shop.shopId || shopId;
  } catch (_) {}

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
      } catch (_) {}
      return obj;
    }
  }

  return null;
}

function getDraftCat02Names() {
  const d = getDraft()?.data || {};
  const wn = String(d["CAT-02_white_name"] || "").trim();
  const ln = String(d["CAT-02_life_name"] || "").trim();
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

  // CAT-02: file names only
  data["CAT-02_white_name"] = document.getElementById("CAT-02_white")?.files?.[0]?.name ?? "";
  data["CAT-02_life_name"] = document.getElementById("CAT-02_life")?.files?.[0]?.name ?? "";

  return data;
}

function isFilledStrict(ruleId) {
  if (ruleId === "BR-02") {
    const f = String($("BR-02_followers")?.value ?? "").trim();
    const u = String($("BR-02_post")?.value ?? "").trim();
    return !!f && !!u;
  }

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
  if (raw === "" || raw == null) return false;

  if (el.type === "text" || el.type === "url") return String(raw).trim().length > 0;

  const n = Number(raw);
  return !Number.isNaN(n);
}

function computeCompletionFromDom() {
  let count = 0;
  KPI_ORDER.forEach((id) => {
    if (isFilledStrict(id)) count++;
  });
  return { completed: count === KPI_ORDER.length, count };
}

function saveDraftNow() {
  const key = getDraftKey();
  if (!key) return;

  const payload = { savedAt: new Date().toISOString(), data: collectDraft() };
  localStorage.setItem(key, JSON.stringify(payload));

  const { completed } = computeCompletionFromDom();
  localStorage.setItem(getCompletedKey(), completed ? "1" : "0");

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

  KPI_ORDER.forEach((id) => {
    if (id === "BR-02" || id === "CAT-02") return;
    const el = document.getElementById(id);
    if (!el) return;
    if (d[id] !== undefined && d[id] !== null) el.value = d[id];
  });

  const f = document.getElementById("BR-02_followers");
  const u = document.getElementById("BR-02_post");
  if (f && d["BR-02_followers"] != null) f.value = d["BR-02_followers"];
  if (u && d["BR-02_post"] != null) u.value = d["BR-02_post"];

  return true;
}

function loadDraft() {
  const key = getDraftKey();
  if (!key) return false;

  const raw = localStorage.getItem(key);
  if (!raw) return false;

  const payload = safeParseJson(raw);
  if (!payload) return false;
  return applyDraft(payload);
}

function resetDraft() {
  if (!confirm("Bạn có chắc muốn xóa toàn bộ dữ liệu đã nhập không?")) return;

  try {
    localStorage.removeItem(getDraftKey());
    localStorage.removeItem(getCompletedKey());
    // legacy cleanup
    localStorage.removeItem(KPI_DRAFT_KEY);
    localStorage.removeItem(KPI_COMPLETED_KEY);
  } catch (_) {}

  window.location.reload();
}

// =========================
// Toast
// =========================
let toastTimer = null;
function showToast(type, title, message, ms = 2600) {
  const toast = $("toast");
  if (!toast) return;

  toast.classList.remove("error", "success");
  toast.classList.add(type);

  const t = $("toastTitle"),
    m = $("toastMsg"),
    i = $("toastIcon");

  if (t) t.textContent = title;
  if (m) m.textContent = message;
  if (i) i.textContent = type === "success" ? "✓" : "!";

  toast.style.display = "block";
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.style.display = "none";
  }, ms);
}

// =========================
// URL helpers (BR-01, BR-02 link)
// =========================
function normalizeUrl(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  try {
    const withScheme = s.startsWith("http://") || s.startsWith("https://") ? s : `https://${s}`;
    return new URL(withScheme);
  } catch (_) {
    return null;
  }
}

function getRootDomain(hostname) {
  const parts = String(hostname || "").split(".").filter(Boolean);
  if (parts.length <= 2) return hostname;
  return parts.slice(-2).join(".");
}

async function bestEffortReachable(urlObj) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    // no-cors: best-effort reachability only
    await fetch(urlObj.toString(), { method: "GET", mode: "no-cors", signal: ctrl.signal });
    clearTimeout(timer);
    return true;
  } catch (_) {
    return false;
  }
}

// =========================
// Image heuristic checks (CAT-02)
// =========================
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
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);

  const { data } = ctx.getImageData(0, 0, w, h);
  const totalPx = w * h;

  let nearWhite = 0;
  let sum = 0,
    sum2 = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += y;
    sum2 += y * y;
    if (r >= 235 && g >= 235 && b >= 235) nearWhite++;
  }

  const whiteRatio = nearWhite / totalPx;
  const mean = sum / totalPx;
  const variance = sum2 / totalPx - mean * mean;

  return { whiteRatio, variance };
}

function isWhiteBackground(stats) {
  return stats.whiteRatio >= 0.7 && stats.variance <= 2200;
}

// =========================
// Standard scoring RANGE/BINARY
// =========================
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

// =========================
// Custom scoring (async)
// =========================
async function scoreCustom(ruleId) {
  // BR-01: URL ok -> 50, reachable -> 100
  if (ruleId === "BR-01") {
    const urlObj = normalizeUrl($("BR-01")?.value);
    if (!urlObj) return { score: 0, meta: { urlOk: false, reachable: false } };

    const root = getRootDomain(urlObj.hostname);
    const reachable = await bestEffortReachable(urlObj);

    return { score: reachable ? 100 : 50, meta: { urlOk: true, rootDomain: root, reachable } };
  }

  // BR-02: followers >= t1 (default 5000) AND post link valid
  if (ruleId === "BR-02") {
    const followersRaw = $("BR-02_followers")?.value;
    const postUrlRaw = $("BR-02_post")?.value;

    const followers = Number(followersRaw);
    const threshold = Number(KPI_RULES["BR-02"]?.t1 || 5000);

    const condFollowers = Number.isFinite(followers) && followers >= threshold;
    const postUrlObj = normalizeUrl(postUrlRaw);
    const condLink = !!postUrlObj;

    const passCount = (condFollowers ? 1 : 0) + (condLink ? 1 : 0);
    const score = passCount === 2 ? 100 : passCount === 1 ? 50 : 0;

    return { score, meta: { followers, threshold, condFollowers, condLink } };
  }

  // BR-03: has address => 100 else 0
  if (ruleId === "BR-03") {
    const addr = $("BR-03")?.value ?? "";
    const ok = String(addr).trim().length > 0;
    return { score: ok ? 100 : 0, meta: { hasAddress: ok } };
  }

  // CAT-02: +50 lifestyle uploaded, +50 white-bg passes.
  // Draft fallback: if draft has both filenames -> 100; if any one -> 50.
  if (ruleId === "CAT-02") {
    const fWhite = $("CAT-02_white")?.files?.[0] || null;
    const fLife = $("CAT-02_life")?.files?.[0] || null;

    // no files chosen -> fallback by draft evidence
    if (!fWhite && !fLife) {
      const { wn, ln, hasBoth, hasAny } = getDraftCat02Names();
      if (hasBoth) {
        return {
          score: 100,
          finalScore: 100,
          meta: {
            restored_from_draft: true,
            white_ok: true,
            life_uploaded: true,
            draft_white_name: wn,
            draft_life_name: ln,
            note: "Browser không phục hồi file input; dùng minh chứng đã lưu từ draft.",
          },
        };
      }
      if (hasAny) {
        return {
          score: 50,
          finalScore: 50,
          meta: {
            restored_from_draft: true,
            white_ok: false,
            life_uploaded: !!ln,
            draft_white_name: wn,
            draft_life_name: ln,
            note: "Draft chỉ có 1 minh chứng.",
          },
        };
      }
      return { score: 0, finalScore: 0, meta: { restored_from_draft: false, reason: "missing_both" } };
    }

    let score = 0;

    // Lifestyle: upload is enough (+50)
    const lifeUploaded = !!fLife;
    if (lifeUploaded) score += 50;

    // White image: analyze pixel white ratio (+50 if ok)
    let whiteOk = false;
    let whiteStats = null;
    if (fWhite) {
      try {
        const img = await loadImageFromFile(fWhite);
        whiteStats = analyzeImage(img);
        whiteOk = isWhiteBackground(whiteStats);
      } catch (_) {
        whiteOk = false;
      }
    }
    if (whiteOk) score += 50;

    const finalScore = Math.min(100, score);
    return {
      score: finalScore,
      finalScore,
      meta: {
        restored_from_draft: false,
        life_uploaded: lifeUploaded,
        white_uploaded: !!fWhite,
        white_ok: whiteOk,
        white_stats: whiteStats,
        rule: "life_upload=+50; white_ok=+50",
      },
    };
  }

  return { score: 0, meta: { reason: "unknown_custom_rule" } };
}

// =========================
// Checklist / progress
// =========================
function renderChecklist() {
  const root = $("kpiChecklist");
  if (!root) return;

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
  const item = $(`ck-${ruleId}`);
  if (!item) return;

  const done = isFilledStrict(ruleId);
  item.classList.toggle("done", done);

  const dot = $(`dot-${ruleId}`);
  if (dot) dot.textContent = done ? "✓" : "○";

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
      statusEl.textContent = `Đã lưu minh chứng: ${wn} | ${ln} (dùng draft để xác nhận)`;
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
  KPI_ORDER.forEach((id) => {
    if (isFilledStrict(id)) count++;
  });

  const c = $("progressCount");
  const t = $("progressText");
  if (c) c.textContent = String(count);

  if (t) {
    t.textContent = count === KPI_ORDER.length ? "Hoàn tất" : `Thiếu ${KPI_ORDER.length - count} KPI`;
  }

  const btn = $("btnResult");
  if (btn) btn.disabled = false;

  const reviewSection = $("review-section");
  if (reviewSection) {
    const shouldShow = count === KPI_ORDER.length;
    reviewSection.style.display = shouldShow ? "block" : "none";
    if (shouldShow) updateReviewStep();
    else $("review-content") && ($("review-content").innerHTML = "");
  }
}

// =========================
// Review step (summary)
// =========================
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getDisplayValue(ruleId) {
  if (ruleId === "BR-02") {
    const f = String($("BR-02_followers")?.value ?? "").trim();
    const u = String($("BR-02_post")?.value ?? "").trim();
    return `Followers: ${f || "Chưa nhập"} | Post link: ${u || "Chưa nhập"}`;
  }

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
  const v = String(el.value ?? "").trim();
  return v ? v : "Chưa nhập";
}

function updateReviewStep() {
  const section = $("review-section");
  const content = $("review-content");
  if (!content) return;

  const isVisible = !!section && window.getComputedStyle(section).display !== "none";
  if (!isVisible) {
    content.innerHTML = "";
    return;
  }

  const allDone = KPI_ORDER.every((id) => isFilledStrict(id));
  if (!allDone) {
    content.innerHTML = "";
    return;
  }

  const groups = [
    { key: "Operation", title: "Nhóm Vận hành", cls: "review-card--blue", icon: "⚙️" },
    { key: "Brand", title: "Nhóm Thương hiệu", cls: "review-card--purple", icon: "💎" },
    { key: "Category", title: "Nhóm Danh mục", cls: "review-card--emerald", icon: "🧾" },
    { key: "Scale", title: "Nhóm Quy mô", cls: "review-card--amber", icon: "📈" },
  ];

  const byGroup = {};
  groups.forEach((g) => (byGroup[g.key] = []));

  KPI_ORDER.forEach((ruleId) => {
    const rule = KPI_RULES[ruleId];
    const g = groupOfKpi(ruleId);

    byGroup[g].push({
      ruleId,
      name: rule?.name || ruleId,
      filled: isFilledStrict(ruleId),
      displayValue: getDisplayValue(ruleId),
    });
  });

  const gridHtml = groups
    .map((g) => {
      const items = byGroup[g.key] || [];
      const rows = items
        .map((x) => {
          const missingRowCls = x.filled ? "" : " review-row--missing";
          const valueCls = x.filled ? "" : " missing";
          const valueText = x.filled ? x.displayValue : "—";
          return `
            <div class="review-row${missingRowCls}">
              <div class="review-label">
                <span class="review-id">${escapeHtml(x.ruleId)}</span>
                <span class="review-name" title="${escapeHtml(x.name)}">${escapeHtml(x.name)}</span>
                <div class="review-dots"></div>
              </div>
              <div class="review-value${valueCls}">${escapeHtml(valueText)}</div>
            </div>
          `;
        })
        .join("");

      return `
        <div class="review-card ${g.cls}">
          <div class="review-card-head">
            <div class="review-head-left">
              <div class="review-card-icon">${g.icon}</div>
              <div class="review-card-title">${escapeHtml(g.title)}</div>
            </div>
            <div class="review-card-meta">${items.length} KPI</div>
          </div>
          <div class="review-rows">${rows}</div>
        </div>
      `;
    })
    .join("");

  content.innerHTML = `<div class="review-grid">${gridHtml}</div>`;
}

// =========================
// UI Sync: name/requirement
// =========================
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
      reqEl.innerHTML = formatRangeRequirement(ruleId, rule);
    }
  });
}

// =========================
// Read value (non-CUSTOM)
// =========================
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

  if (el.value === "" || el.value == null) return null;

  const n = Number(el.value);
  if (Number.isNaN(n)) return null;
  return n;
}

// =========================
// Validate on submit
// =========================
function validateAll() {
  const missing = [];

  KPI_ORDER.forEach((id) => {
    if (id === "BR-02") {
      const f = String($("BR-02_followers")?.value ?? "").trim();
      const u = String($("BR-02_post")?.value ?? "").trim();
      if (!f || !u) missing.push("BR-02");
      return;
    }

    if (id === "CAT-02") {
      const a = $("CAT-02_white")?.files?.length ? 1 : 0;
      const b = $("CAT-02_life")?.files?.length ? 1 : 0;
      if (a && b) return;
      if (getDraftCat02Names().hasBoth) return;
      missing.push("CAT-02");
      return;
    }

    const el = $(id);
    if (!el) {
      missing.push(id);
      return;
    }

    if (el.tagName === "SELECT") {
      if (el.value === "") missing.push(id);
      return;
    }

    const raw = el.value;
    if (raw === "" || raw == null) {
      missing.push(id);
      return;
    }

    if (el.type === "text" || el.type === "url") {
      if (String(raw).trim().length === 0) missing.push(id);
      return;
    }

    const n = Number(raw);
    if (Number.isNaN(n)) missing.push(id);
  });

  return { ok: missing.length === 0, missing };
}

// =========================
// Tiering + compute
// =========================
function tiering(totalScore) {
  if (totalScore < 50) return { tier: "Not Ready", note: "Cần cải thiện toàn diện." };
  if (totalScore <= 69) return { tier: "Partially Ready", note: "Có tiềm năng nhưng chưa đủ chuẩn." };
  if (totalScore <= 84) return { tier: "Near Mall-Ready", note: "Rất gần với tiêu chuẩn Mall." };
  return { tier: "Mall-Ready", note: "Sẵn sàng đăng ký Mall." };
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

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
      score = typeof res.finalScore === "number" ? res.finalScore : res.score;
      meta = res.meta;

      if (id === "BR-01") value = $("BR-01")?.value ?? "";
      if (id === "BR-02") value = { followers: $("BR-02_followers")?.value ?? "", postUrl: $("BR-02_post")?.value ?? "" };
      if (id === "BR-03") value = $("BR-03")?.value ?? "";
      if (id === "CAT-02") {
        value = {
          whiteFile: $("CAT-02_white")?.files?.[0]?.name ?? "",
          lifeFile: $("CAT-02_life")?.files?.[0]?.name ?? "",
          draft: getDraftCat02Names(),
        };
      }
    } else {
      value = readValue(id);
      score = scoreKPI(id, value);
    }

    const weighted = score * Number(rule.weight_final || 0);
    total += weighted;

    breakdown.push({
      id,
      rule_id: id,
      kpiId: id,
      group: groupOfKpi(id), // EN for dashboard/result compatibility
      name: rule.name,
      method: rule.method,
      direction: rule.direction,
      t1: rule.t1,
      t2: rule.t2,
      score_threshold: rule.method === "RANGE" ? { direction: rule.direction, t1: rule.t1, t2: rule.t2 } : null,

      // weights
      weight_raw: Number(rule.weight_raw || 0),
      weight_final: Number(rule.weight_final || 0),
      weight: Number(rule.weight_final || 0), // legacy: many renderers read "weight"

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
  const s = String(id || "").toUpperCase();
  if (s.startsWith("OP-") || s.startsWith("CS-") || s.startsWith("PEN-") || s.startsWith("CO-")) return "Operation";
  if (s.startsWith("BR-")) return "Brand";
  if (s.startsWith("CAT-")) return "Category";
  if (s.startsWith("SC-")) return "Scale";
  return "Operation";
}

// =========================
// Gate guards (fail-closed)
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

  const payload = {
    ...resultObj,
    breakdown: Array.isArray(resultObj?.breakdown) ? resultObj.breakdown : [],
    kpis: Array.isArray(resultObj?.breakdown) ? resultObj.breakdown : [],
    computedAt: resultObj?.computedAt || new Date().toISOString(),
    version: resultObj?.version || "MRSM_WSM_v2",

    gate: (() => {
      const hard = safeParseJson(sessionStorage.getItem("validatedHardKO") || "null");
      const softStatus = softGate?.gate_status ? String(softGate.gate_status).toUpperCase() : "UNKNOWN";
      return {
        status: softStatus,
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

  // Normalize for dashboard local adapter
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
