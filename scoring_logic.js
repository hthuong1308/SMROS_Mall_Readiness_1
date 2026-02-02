
(function () {
  // ----------------------------
  // Backup rules (fail-safe)
  // ----------------------------
  const BACKUP_KPI_ORDER = [
    "OP-01", "OP-02", "OP-03", "OP-04",
    "CS-01", "CS-02",
    "PEN-01",
    "CO-01", "CO-02",
    "BR-01", "BR-02", "BR-03",
    "CAT-01", "CAT-02", "CAT-03", "CAT-04",
    "SC-01", "SC-02", "SC-03"
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

    "BR-01": { name: "Website ổn định (domain check)", method: "CUSTOM", direction: "CUSTOM", weight: 0.05 },
    "BR-02": { name: "Hiện diện MXH (followers + post link)", method: "CUSTOM", direction: "CUSTOM", t1: 5000, t2: 0, weight: 0.05 },
    "BR-03": { name: "Độ phủ Offline (địa chỉ cửa hàng)", method: "CUSTOM", direction: "CUSTOM", weight: 0.05 },

    "CAT-01": { name: "Số lượng sản phẩm hoạt động (SKU)", method: "RANGE", direction: "GE", t1: 50, t2: 5, weight: 0.05 },
    "CAT-02": { name: "Ảnh đạt chuẩn (white bg + lifestyle)", method: "CUSTOM", direction: "CUSTOM", weight: 0.05 },
    "CAT-03": { name: "Sản phẩm bị khóa/xóa", method: "BINARY", direction: "BOOL", weight: 0.1 },
    "CAT-04": { name: "Các vi phạm khác", method: "BINARY", direction: "BOOL", weight: 0.05 },

    "SC-01": { name: "Doanh số 4w (Triệu VNĐ)", method: "RANGE", direction: "GE", t1: 50, t2: 30, weight: 0.04 },
    "SC-02": { name: "Số đơn hàng 4w", method: "RANGE", direction: "GE", t1: 250, t2: 150, weight: 0.04 },
    "SC-03": { name: "Tăng trưởng doanh số (%)", method: "RANGE", direction: "GE", t1: 5, t2: 0, weight: 0.02 }
  };

  // ----------------------------
  // DOM helpers
  // ----------------------------
  function $(id) { return document.getElementById(id); }
  function safeJsonParse(s) { try { return JSON.parse(s); } catch { return null; } }

  // ----------------------------
  // KPI registry (SSOT => fallback)
  // ----------------------------
  let KPI_ORDER = [];
  const KPI_RULES = {};
  let KPI_WEIGHT_SUM = 1;

  (function initKpiRegistryFromSSOT() {
    KPI_ORDER.length = 0;
    for (const k of Object.keys(KPI_RULES)) delete KPI_RULES[k];
    KPI_WEIGHT_SUM = 0;

    try {
      const cfg = window.MRSM_CONFIG;
      const list = cfg?.kpis;
      if (!Array.isArray(list) || list.length === 0) throw new Error("MRSM_CONFIG.kpis missing/empty");

      const specialCustomIds = new Set(["BR-01", "BR-02", "BR-03", "CAT-02"]);

      list.forEach((k) => {
        if (!k || !k.id) return;

        let method = String(k.method || "RANGE").toUpperCase();
        if (method === "BOOLEAN") method = "BINARY";
        if (method === "COMPLEX") method = "CUSTOM";
        if (specialCustomIds.has(k.id)) method = "CUSTOM";

        const rule = {
          name: k.name || k.id,
          method,
          direction: "GE",
          t1: 0,
          t2: 0,
          weight: Number(k.weight || 0),
        };

        if (method === "BINARY") {
          rule.direction = "BOOL";
        } else if (method === "CUSTOM") {
          rule.direction = "CUSTOM";
          // ✅ keep thresholds if config provides (BR-02 needs t1=5000)
          if (k.t1 !== undefined) rule.t1 = Number(k.t1);
          if (k.t2 !== undefined) rule.t2 = Number(k.t2);
        } else {
          rule.direction = (k.direction || "GE").toUpperCase();
          rule.t1 = (k.t1 !== undefined) ? Number(k.t1) : 0;
          rule.t2 = (k.t2 !== undefined) ? Number(k.t2) : 0;
        }

        KPI_RULES[k.id] = rule;
        KPI_ORDER.push(k.id);
        KPI_WEIGHT_SUM += Number(rule.weight || 0);
      });

      if (!(KPI_WEIGHT_SUM > 0)) KPI_WEIGHT_SUM = KPI_ORDER.length || 1;
      console.log("[SSOT] KPI registry loaded:", KPI_ORDER.length, "weightSum=", KPI_WEIGHT_SUM);
      return;
    } catch (e) {
      console.warn("[SSOT] initKpiRegistryFromSSOT failed:", e);
    }

    // Fallback
    KPI_ORDER = BACKUP_KPI_ORDER.slice();
    Object.assign(KPI_RULES, BACKUP_KPI_RULES);
    KPI_WEIGHT_SUM = KPI_ORDER.reduce((s, id) => s + Number(KPI_RULES[id]?.weight || 0), 0) || (KPI_ORDER.length || 1);
    console.log("[SSOT] Fallback KPI registry:", KPI_ORDER.length, "weightSum=", KPI_WEIGHT_SUM);
  })();

  // ----------------------------
  // Draft Storage (Autosave + Rehydrate)
  // ----------------------------
  const KPI_DRAFT_KEY = "SMROS_KPI_DRAFT_V1";
  const KPI_COMPLETED_KEY = "SMROS_KPI_COMPLETED_V1";

  function getAssessmentIdFromUrl() {
    try {
      const u = new URL(window.location.href);
      const id = u.searchParams.get("assessment_id");
      if (id) return id;
    } catch (_) { }
    return (
      sessionStorage.getItem("current_assessment_id") ||
      sessionStorage.getItem("assessment_id") ||
      localStorage.getItem("current_assessment_id") ||
      localStorage.getItem("assessment_id") ||
      ""
    );
  }

  function getScopedKey(baseKey) {
    const uid = window._auth?.currentUser?.uid || localStorage.getItem("smros_uid") || "anon";
    let shopId = "unknown";
    try {
      const shop = safeJsonParse(localStorage.getItem("shop_info") || "{}") || {};
      shopId = shop.shop_id || shop.shopId || shopId;
    } catch (_) { }
    const aid = getAssessmentIdFromUrl() || "no_assessment";
    return `${baseKey}__${uid}__${shopId}__${aid}`;
  }

  function getDraftKey() { return getScopedKey(KPI_DRAFT_KEY); }
  function getCompletedKey() { return getScopedKey(KPI_COMPLETED_KEY); }

  function collectDraft() {
    const data = {};

    KPI_ORDER.forEach((id) => {
      if (id === "BR-02" || id === "CAT-02") return;
      const el = $(id);
      if (!el) return;
      data[id] = el.value;
    });

    data["BR-02_followers"] = $("BR-02_followers")?.value ?? "";
    data["BR-02_post"] = $("BR-02_post")?.value ?? "";

    data["CAT-02_white_name"] = $("CAT-02_white")?.files?.[0]?.name ?? "";
    data["CAT-02_life_name"] = $("CAT-02_life")?.files?.[0]?.name ?? "";

    return data;
  }

  function getDraft() {
    const key = getDraftKey();
    const raw = localStorage.getItem(key);
    if (raw) return safeJsonParse(raw);

    // backward compat (global key)
    const legacy = localStorage.getItem(KPI_DRAFT_KEY);
    if (legacy) {
      const obj = safeJsonParse(legacy);
      if (obj && typeof obj === "object") {
        try {
          localStorage.setItem(key, legacy);
          localStorage.removeItem(KPI_DRAFT_KEY);
        } catch (_) { }
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

  function applyDraft(payload) {
    if (!payload?.data) return false;
    const d = payload.data;

    KPI_ORDER.forEach((id) => {
      if (id === "BR-02" || id === "CAT-02") return;
      const el = $(id);
      if (!el) return;
      if (d[id] !== undefined && d[id] !== null) el.value = d[id];
    });

    if ($("BR-02_followers") && d["BR-02_followers"] != null) $("BR-02_followers").value = d["BR-02_followers"];
    if ($("BR-02_post") && d["BR-02_post"] != null) $("BR-02_post").value = d["BR-02_post"];

    // NOTE: file inputs cannot be restored by browser
    return true;
  }

  function loadDraft() {
    const raw = localStorage.getItem(getDraftKey());
    if (!raw) return false;
    const payload = safeJsonParse(raw);
    if (!payload) return false;
    return applyDraft(payload);
  }

  function computeCompletionFromDom() {
    let count = 0;
    KPI_ORDER.forEach((id) => { if (isFilledStrict(id)) count++; });
    return { completed: count === KPI_ORDER.length, count };
  }

  let saveTimer = null;
  function saveDraftNow() {
    const payload = { savedAt: new Date().toISOString(), data: collectDraft() };
    localStorage.setItem(getDraftKey(), JSON.stringify(payload));

    const { completed } = computeCompletionFromDom();
    localStorage.setItem(getCompletedKey(), completed ? "1" : "0");

    updateReviewStep();
  }
  function saveDraftDebounced(delay = 250) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraftNow, delay);
  }

  function resetDraft() {
    if (!confirm("Bạn có chắc muốn xóa toàn bộ dữ liệu đã nhập không?")) return;

    try { localStorage.removeItem(getDraftKey()); } catch (_) { }
    try { localStorage.removeItem(getCompletedKey()); } catch (_) { }
    try { localStorage.removeItem(KPI_DRAFT_KEY); } catch (_) { }
    try { localStorage.removeItem(KPI_COMPLETED_KEY); } catch (_) { }

    window.location.reload();
  }

  // ----------------------------
  // Toast
  // ----------------------------
  let toastTimer = null;
  function showToast(type, title, message, ms = 2600) {
    const toast = $("toast"); if (!toast) return;
    toast.classList.remove("error", "success");
    toast.classList.add(type);

    const t = $("toastTitle"), m = $("toastMsg"), i = $("toastIcon");
    if (t) t.textContent = title;
    if (m) m.textContent = message;
    if (i) i.textContent = (type === "success" ? "✓" : "!");

    toast.style.display = "block";
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.style.display = "none"; }, ms);
  }

  // ----------------------------
  // URL helpers (best-effort)
  // ----------------------------
  function normalizeUrl(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    if (!s) return null;
    try {
      const withScheme = s.startsWith("http://") || s.startsWith("https://") ? s : `https://${s}`;
      return new URL(withScheme);
    } catch (_) { return null; }
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

  // ----------------------------
  // Image heuristic (CAT-02)
  // ----------------------------
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

  function isWhiteBackground(stats) { return stats.whiteRatio >= 0.70 && stats.variance <= 2200; }

  // ----------------------------
  // Group mapping (VN)
  // ----------------------------
  function groupOfKpi(id) {
    if (id.startsWith("OP-") || id.startsWith("CS-") || id.startsWith("PEN-") || id.startsWith("CO-")) return "Vận hành";
    if (id.startsWith("BR-")) return "Thương hiệu";
    if (id.startsWith("CAT-")) return "Danh mục";
    if (id.startsWith("SC-")) return "Quy mô";
    return "Vận hành";
  }

  // ----------------------------
  // Strict filled rules
  // ----------------------------
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
    if (raw === "" || raw === null || raw === undefined) return false;

    if (el.type === "text" || el.type === "url") return String(raw).trim().length > 0;

    const n = Number(raw);
    return !Number.isNaN(n);
  }

  // ----------------------------
  // Checklist rendering
  // ----------------------------
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
        statusEl.textContent = `Đã lưu minh chứng: ${wn} | ${ln} (dùng draft để xác nhận)`;
        statusEl.classList.add("ok");
        return;
      }
      if (hasAny) {
        statusEl.textContent = `Đã lưu 1 phần: ${wn || "—"} | ${ln || "—"} (cần đủ 2 ảnh)`;
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

    if ($("progressCount")) $("progressCount").textContent = String(count);

    if ($("progressText")) {
      $("progressText").textContent = (count === KPI_ORDER.length)
        ? "Hoàn tất"
        : `Thiếu ${KPI_ORDER.length - count} KPI`;
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

  // ----------------------------
  // Review (optional)
  // ----------------------------
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
    if (!isVisible) { content.innerHTML = ""; return; }

    const allDone = KPI_ORDER.every((id) => isFilledStrict(id));
    if (!allDone) { content.innerHTML = ""; return; }

    const groups = [
      { key: "Vận hành", title: "Nhóm Vận hành", cls: "review-card--blue", icon: "⚙️" },
      { key: "Thương hiệu", title: "Nhóm Thương hiệu", cls: "review-card--purple", icon: "💎" },
      { key: "Danh mục", title: "Nhóm Danh mục", cls: "review-card--emerald", icon: "🧾" },
      { key: "Quy mô", title: "Nhóm Quy mô", cls: "review-card--amber", icon: "📈" },
    ];

    const byGroup = {};
    groups.forEach((g) => (byGroup[g.key] = []));

    KPI_ORDER.forEach((ruleId) => {
      const rule = KPI_RULES[ruleId];
      const g = groupOfKpi(ruleId);
      const filled = isFilledStrict(ruleId);
      const displayValue = getDisplayValue(ruleId);

      (byGroup[g] || (byGroup[g] = [])).push({
        ruleId,
        name: rule?.name || ruleId,
        filled,
        displayValue,
      });
    });

    const gridHtml = groups.map((g) => {
      const items = byGroup[g.key] || [];
      const rows = items.map((x) => {
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
      }).join("");

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
    }).join("");

    content.innerHTML = `<div class="review-grid">${gridHtml}</div>`;
  }

  // ----------------------------
  // Read value (non-CUSTOM)
  // ----------------------------
  function readValue(ruleId) {
    const rule = KPI_RULES[ruleId];
    if (!rule || rule.method === "CUSTOM") return null;

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

  // ----------------------------
  // Standard scoring RANGE/BINARY
  // ----------------------------
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

  // ----------------------------
  // Custom scoring (async)
  // ----------------------------
  async function scoreCustom(ruleId) {
    // BR-01
    if (ruleId === "BR-01") {
      const urlObj = normalizeUrl($("BR-01")?.value);
      if (!urlObj) return { score: 0, meta: { urlOk: false, reachable: false } };

      const reachable = await bestEffortReachable(urlObj);
      const score = reachable ? 100 : 50; // best-effort
      return { score, meta: { urlOk: true, reachable } };
    }

    // BR-02
    if (ruleId === "BR-02") {
      const followersRaw = $("BR-02_followers")?.value;
      const postUrlRaw = $("BR-02_post")?.value;

      const followers = Number(followersRaw);
      const thr = Number(KPI_RULES["BR-02"]?.t1 ?? 5000); // ✅ default 5000
      const condFollowers = Number.isFinite(followers) && followers >= thr;

      const postUrlObj = normalizeUrl(postUrlRaw);
      const condLink = !!postUrlObj;

      const passCount = (condFollowers ? 1 : 0) + (condLink ? 1 : 0);
      const score = passCount === 2 ? 100 : (passCount === 1 ? 50 : 0);

      return { score, meta: { followers, threshold: thr, condFollowers, condLink } };
    }

    // BR-03
    if (ruleId === "BR-03") {
      const addr = $("BR-03")?.value ?? "";
      const ok = String(addr).trim().length > 0;
      return { score: ok ? 100 : 0, meta: { hasAddress: ok } };
    }

    // CAT-02 (white bg + lifestyle)
    if (ruleId === "CAT-02") {
      const fWhite = $("CAT-02_white")?.files?.[0] || null;
      const fLife = $("CAT-02_life")?.files?.[0] || null;

      // no files but draft evidence
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
              note: "Browser không phục hồi file input; dùng minh chứng đã lưu từ draft."
            }
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
              note: "Chỉ có 1 minh chứng trong draft."
            }
          };
        }
        return { score: 0, finalScore: 0, meta: { restored_from_draft: false, reason: "missing_both" } };
      }

      let score = 0;

      const lifeUploaded = !!fLife;
      if (lifeUploaded) score += 50;

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
          rule: "life_upload=+50; white_ok=+50"
        }
      };
    }

    return { score: 0, meta: { reason: "unknown_custom_rule" } };
  }

  // ----------------------------
  // Validation (strict submit)
  // ----------------------------
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

  // ----------------------------
  // Tiering + compute (normalized weights)
  // ----------------------------
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

    // ✅ normalize weights => weight_final
    const sumW = KPI_ORDER.reduce((s, id) => s + Number(KPI_RULES[id]?.weight || 0), 0) || 1;

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
        if (id === "BR-02") value = { followers: $("BR-02_followers")?.value ?? "", postUrl: $("BR-02_post")?.value ?? "" };
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

      const weight_raw = Number(rule.weight || 0);
      const weight_final = weight_raw / sumW;

      const weighted = score * weight_final;
      total += weighted;

      breakdown.push({
        id,
        rule_id: id,           // compat
        kpiId: id,             // compat
        group: groupOfKpi(id),
        name: rule.name,
        method: rule.method,
        direction: rule.direction,
        t1: rule.t1,
        t2: rule.t2,
        score_threshold: (rule.method === "RANGE")
          ? { direction: rule.direction, t1: rule.t1, t2: rule.t2 }
          : null,
        weight: weight_raw,
        weight_final,
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

  // ----------------------------
  // Gate guards (prefer GateGuard if present)
  // ----------------------------
  function requireHardGateOrRedirect() {
    if (window.GateGuard?.requireHardGateEvidenceOrRedirectLocal) {
      return window.GateGuard.requireHardGateEvidenceOrRedirectLocal({ redirectOnMissing: true });
    }
    const hardRaw = sessionStorage.getItem("validatedHardKO");
    const hard = hardRaw ? safeJsonParse(hardRaw) : null;
    if (!hard || typeof hard !== "object") {
      window.location.href = "KO_GATE.html";
      return false;
    }
    return true;
  }

  function requireSoftGatePassOrRedirect() {
    if (window.GateGuard?.requireSoftGatePassOrRedirect) {
      // file gate-guard.js của bạn có helper này
      try {
        window.GateGuard.requireSoftGatePassOrRedirect({ redirectOnMissing: true });
        // nếu helper redirect thì page đã điều hướng; ở đây coi như pass
      } catch (_) { }
      // best-effort: still verify local
    }

    const softRaw = localStorage.getItem("soft_ko_gate");
    const soft = softRaw ? safeJsonParse(softRaw) : null;
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

  // ----------------------------
  // Save & redirect (make RESULTS show breakdown)
  // ----------------------------
  function saveAndRedirect(resultObj) {
    const getQueryParam = (name) => {
      try { return new URL(window.location.href).searchParams.get(name); }
      catch { return null; }
    };

    const softGate = safeJsonParse(localStorage.getItem("soft_ko_gate") || "null");

    const payload = {
      ...resultObj,
      breakdown: Array.isArray(resultObj?.breakdown) ? resultObj.breakdown : [],
      // compat
      kpis: Array.isArray(resultObj?.breakdown) ? resultObj.breakdown : [],
      computedAt: resultObj?.computedAt || new Date().toISOString(),
      version: resultObj?.version || "MRSM_WSM_v2",
      gate: (() => {
        const hard = safeJsonParse(sessionStorage.getItem("validatedHardKO") || "null");
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

    // Normalize KPI list for dashboard/result
    const kpisNormalized = (payload.breakdown || []).map((k) => {
      const id = k.id || k.rule_id || k.kpiId;
      const wf = Number(k.weight_final ?? 0);
      return {
        ...k,
        id,
        rule_id: id,
        kpiId: id,
        group: k.group || groupOfKpi(id),
        weight_final: wf,
        weight: Number(k.weight ?? 0),
      };
    });

    const evaluatedAt = payload.computedAt;

    // Resolve shop info best-effort
    let shop_name = String(getQueryParam("shop_name") || getQueryParam("shopName") || "").trim();
    let shop_id = String(getQueryParam("shop_id") || getQueryParam("shopId") || "").trim();

    if (!shop_name || !shop_id) {
      const sObj = safeJsonParse(localStorage.getItem("shop_info") || "null");
      if (sObj) {
        shop_name = shop_name || String(sObj.shop_name || sObj.shopName || "").trim();
        shop_id = shop_id || String(sObj.shop_id || sObj.shopId || "").trim();
      }
    }

    shop_name = shop_name || "—";
    shop_id = shop_id || "—";
    localStorage.setItem("shop_info", JSON.stringify({ shop_name, shop_id }));

    // Determine assessment_id
    const url = new URL(window.location.href);
    let aid = url.searchParams.get("assessment_id") || sessionStorage.getItem("current_assessment_id") || `LOCAL_${Date.now()}`;
    sessionStorage.setItem("current_assessment_id", aid);

    const assessmentRecordLocal = {
      assessment_id: aid,
      evaluated_at: evaluatedAt,
      shop: { shop_name, shop_id },
      gate: payload.gate || { status: "UNKNOWN" },
      mrsm: {
        final_score: Number(payload.totalScore ?? 0),
        tier: payload.tier || "NOT_READY",
      },
      groups: {},            // dashboard.js can calc
      kpis: kpisNormalized
    };

    // ✅ store multiple keys for RESULTS/DASHBOARD compatibility
    localStorage.setItem("assessment_record_local", JSON.stringify(assessmentRecordLocal));
    localStorage.setItem("assessment_record_latest", JSON.stringify(assessmentRecordLocal));
    localStorage.setItem(`assessment_record__${aid}`, JSON.stringify(assessmentRecordLocal));
    localStorage.setItem(`assessment_result__${aid}`, JSON.stringify(payload));

    window.location.href = `RESULTS.html?assessment_id=${encodeURIComponent(aid)}`;
  }

  // ----------------------------
  // UI sync (optional)
  // ----------------------------
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
    });
  }

  // ----------------------------
  // Events
  // ----------------------------
  function bindEvents() {
    KPI_ORDER.forEach((id) => {
      if (id === "BR-02") {
        ["BR-02_followers", "BR-02_post"].forEach((fid) => {
          const el = $(fid);
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

      if (id === "CAT-02") {
        ["CAT-02_white", "CAT-02_life"].forEach((fid) => {
          const el = $(fid);
          if (!el) return;
          el.addEventListener("change", () => {
            updateChecklistItem("CAT-02");
            updateProgress();
            saveDraftDebounced();
          });
        });
        return;
      }

      const el = $(id);
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

    // back
    $("btnBack")?.addEventListener("click", () => history.back());

    // result
    $("btnResult")?.addEventListener("click", async () => {
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
        version: "MRSM_WSM_v2"
      });
    });

    // reset
    $("btnResetDraft")?.addEventListener("click", resetDraft);
  }

  // ----------------------------
  // Init
  // ----------------------------
  document.addEventListener("DOMContentLoaded", () => {
    if (!requireHardGateOrRedirect()) return;
    if (!requireSoftGatePassOrRedirect()) return;

    syncKpiCardsFromRules();

    // restore_draft=1 => load draft
    const params = new URLSearchParams(window.location.search);
    const restoreDraft = params.get("restore_draft") === "1";
    if (restoreDraft) loadDraft();

    renderChecklist();
    KPI_ORDER.forEach(updateChecklistItem);
    updateProgress();
    bindEvents();

    // offer restore button (optional) — keep simple
    const hasDraft = !!localStorage.getItem(getDraftKey());
    if (hasDraft && !restoreDraft && !$("btnRestoreDraft")) {
      const host = document.querySelector(".actions") || document.body;
      const btn = document.createElement("button");
      btn.id = "btnRestoreDraft";
      btn.type = "button";
      btn.className = "btn ghost";
      btn.textContent = "↩️ Khôi phục dữ liệu đã lưu";
      btn.addEventListener("click", () => {
        const u = new URL(window.location.href);
        u.searchParams.set("restore_draft", "1");
        window.location.href = u.toString();
      });
      const btnResult = $("btnResult");
      if (btnResult && btnResult.parentElement) btnResult.parentElement.insertBefore(btn, btnResult);
      else host.appendChild(btn);
    }
  });

})();
