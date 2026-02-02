/******************************************************************************
 * script_kogate.js (FULL - SYNC WITH KO_GATE.html NEW DESIGN)
 * ------------------------------------------------------------
 * HARD KO:
 *  - Shop info (6): shop_name, shop_id, store_name, category, brand, domain
 *  - KO-01..KO-04: PDF + filename contains keyword
 *  - KO-05: months validity > 6
 *  - KO-06: must choose "Có"
 *  - KO-07: (1) website link valid + best-effort reachable + DNS A record
 *           (2) website validity months > 6
 *
 * PASS => save sessionStorage.validatedHardKO + init localStorage.soft_ko_gate
 *      => modal countdown then redirect SOFT_KO.html?assessment_id=...
 ******************************************************************************/

(() => {
  "use strict";

  const SCHEMA_VERSION = 1;
  const SCHEMA_ID = "fs_assessment_doc_v1";

  // ====== IDs (must match KO_GATE.html you provided) ======
  const IDS = {
    // shop info
    shop_name: "shop_name",
    shop_id: "shop_id",
    store_name: "store_name",
    category: "category",
    brand: "brand",
    domain: "domain",

    // KO-01..04
    ko01_file: "ko01_file",
    ko02_file: "ko02_file",
    ko03_file: "ko03_file",
    ko04_file: "ko04_file",
    ko01_meta: "ko01_meta",
    ko02_meta: "ko02_meta",
    ko03_meta: "ko03_meta",
    ko04_meta: "ko04_meta",
    ko01_status: "ko01_status",
    ko02_status: "ko02_status",
    ko03_status: "ko03_status",
    ko04_status: "ko04_status",

    // KO-05..07
    ko05_months: "ko05_months",
    ko06_ok: "ko06_ok",
    ko07_link: "ko07_link",       // ✅ NEW: link website input
    ko07_months: "ko07_months",   // ✅ NEW: validity months input
    ko05_status: "ko05_status",
    ko06_status: "ko06_status",
    ko07_status: "ko07_status",

    // badges + checklist
    shopInfoBadge: "shopInfoBadge",
    hardKoBadge: "hardKoBadge",
    progressBadge: "progressBadge",
    progressList: "progressList",
    progressText: "progress-text", // note: your HTML shows class="progress-text" in sidebar items; but we update badge text elsewhere

    // actions
    btnValidate: "btnValidate",
    btnGoSoftKo: "btnGoSoftKo",
    btnReset: "btnReset",
    btnExport: "btnExport",

    // toast
    toast: "toast",
    toastTitle: "toastTitle",
    toastMsg: "toastMsg",
    toastClose: "toastClose",

    // modal
    modalOverlay: "modalOverlay",
    modalTitle: "modalTitle",
    modalBody: "modalBody",
    modalOk: "modalOk",
    modalClose: "modalClose",
  };

  // ===== Keywords required in filename (case-insensitive) =====
  const FILE_KEYWORDS = {
    [IDS.ko01_file]: ["gpkd", "giấy phép", "giay phep", "kinh doanh"],
    [IDS.ko02_file]: ["đknh", "dknh", "nhãn hiệu", "nhan hieu", "đăng ký nhãn", "dang ky nhan"],
    [IDS.ko03_file]: ["uqsp", "ủy quyền", "uy quyen", "phân phối", "phan phoi"],
    [IDS.ko04_file]: ["cbsp", "công bố", "cong bo", "công bố sản phẩm", "cong bo san pham"],
  };

  // ===== Validation state: 13 fields =====
  const validationState = {
    // shop info (6)
    [IDS.shop_name]: false,
    [IDS.shop_id]: false,
    [IDS.store_name]: false,
    [IDS.category]: false,
    [IDS.brand]: false,
    [IDS.domain]: false, // only required non-empty

    // Hard KO (7)
    ko01: false,
    ko02: false,
    ko03: false,
    ko04: false,
    ko05: false,
    ko06: false,
    ko07: false, // composed: link reachable + DNS A + months>6
  };

  let redirectTimer = { tick: null, done: null };

  function $(id) {
    return document.getElementById(id);
  }

  function debounce(func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  }

  function normText(s) {
    return String(s || "").toLowerCase().trim();
  }

  function normalizeDomain(input) {
    let domain = String(input || "").trim().toLowerCase();
    domain = domain.replace(/^https?:\/\//, "");
    domain = domain.replace(/^www\./, "");
    domain = domain.split("/")[0].split("?")[0].split("#")[0];
    return domain;
  }

  function normalizeToUrl(input) {
    const raw = String(input || "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    return `https://${raw}`;
  }

  function isValidDomainFormat(domain) {
    const domainRegex = /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/;
    return domainRegex.test(domain);
  }

  async function checkDomainDNS(domain) {
    try {
      const url = `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=A`;
      const response = await fetch(url);
      const data = await response.json();
      return data?.Status === 0 && Array.isArray(data?.Answer) && data.Answer.length > 0;
    } catch (e) {
      console.warn("[KO-07] DNS check error:", e);
      return false;
    }
  }

  // Best-effort reachability on static hosting (no-cors: resolve if network ok)
  async function checkUrlReachable(url) {
    try {
      await fetch(url, { method: "GET", mode: "no-cors", cache: "no-store" });
      return true;
    } catch (e) {
      return false;
    }
  }

  function clearRedirectTimers() {
    if (redirectTimer?.tick) {
      clearTimeout(redirectTimer.tick);
      redirectTimer.tick = null;
    }
    if (redirectTimer?.done) {
      clearTimeout(redirectTimer.done);
      redirectTimer.done = null;
    }
  }

  // ===== UI helpers =====

  function setStatusBadge(statusId, isPass, message = "") {
    const el = $(statusId);
    if (!el) return;

    const msg = message ? ` ${message}` : "";

    if (isPass === null) {
      el.textContent = "CHƯA KIỂM TRA";
      el.className = "pill";
      return;
    }

    el.textContent = (isPass ? "✅ PASS" : "❌ FAIL") + msg;

    // Your HTML uses class="pill" in KO status. We keep that + add pass/fail.
    el.className = "pill " + (isPass ? "pass" : "fail");
  }

  function setBadge(id, type, text) {
    const el = $(id);
    if (!el) return;
    el.className = `badge ${type}`;
    el.textContent = text;
  }

  function showToast(type, title, message, ms = 2600) {
    const toast = $(IDS.toast);
    if (!toast) return;

    const titleEl = $(IDS.toastTitle);
    const msgEl = $(IDS.toastMsg);

    if (titleEl) titleEl.textContent = title || "Thông báo";
    if (msgEl) msgEl.textContent = message || "";

    toast.classList.add("show");

    window.setTimeout(() => {
      toast.classList.remove("show");
    }, ms);
  }

  function showModal(title, html) {
    const overlay = $(IDS.modalOverlay);
    const titleEl = $(IDS.modalTitle);
    const bodyEl = $(IDS.modalBody);
    if (!overlay || !titleEl || !bodyEl) return;

    titleEl.textContent = title || "Thông báo";
    bodyEl.innerHTML = html || "";
    overlay.classList.add("show");
  }

  function hideModal() {
    const overlay = $(IDS.modalOverlay);
    if (overlay) overlay.classList.remove("show");
  }

  function validateShopField(id) {
    const el = $(id);
    const ok = !!el && String(el.value || "").trim() !== "";
    validationState[id] = ok;
    return ok;
  }

  function validateFile(fileInputId, metaId, statusId, stateKey) {
    const input = $(fileInputId);
    const metaEl = $(metaId);
    const file = input?.files?.[0];

    if (!file) {
      if (metaEl) metaEl.textContent = "Chưa có file";
      setStatusBadge(statusId, false, "(Chưa chọn file)");
      validationState[stateKey] = false;
      return false;
    }

    const lowerName = String(file.name || "").toLowerCase();
    const isPdf = file.type === "application/pdf" || lowerName.endsWith(".pdf");
    if (!isPdf) {
      if (metaEl) metaEl.textContent = "Chưa có file";
      setStatusBadge(statusId, false, "(Chỉ chấp nhận PDF)");
      validationState[stateKey] = false;
      try { input.value = ""; } catch (_) { }
      return false;
    }

    const keys = FILE_KEYWORDS[fileInputId] || [];
    const fn = normText(file.name);
    const hasKey = keys.some(k => fn.includes(normText(k)));

    if (metaEl) metaEl.textContent = file.name;

    if (!hasKey) {
      setStatusBadge(statusId, false, "(Thiếu keyword)");
      validationState[stateKey] = false;
      return false;
    }

    setStatusBadge(statusId, true);
    validationState[stateKey] = true;
    return true;
  }

  function validateKO05() {
    const el = $(IDS.ko05_months);
    const raw = String(el?.value ?? "").trim();
    const months = Number(raw);
    const ok = raw !== "" && !Number.isNaN(months) && months > 6;

    validationState.ko05 = ok;
    setStatusBadge(IDS.ko05_status, ok, ok ? "" : "(Phải > 6 tháng)");
    return ok;
  }

  function validateKO06() {
    const el = $(IDS.ko06_ok);
    const ok = !!el && String(el.value) === "Có";

    validationState.ko06 = ok;
    setStatusBadge(IDS.ko06_status, ok, ok ? "" : "(Chỉ 'Có' mới đạt)");
    return ok;
  }

  // ✅ KO-07 composed (2 inputs)
  async function validateKO07_Composed({ showLoading = false } = {}) {
    const linkEl = $(IDS.ko07_link);
    const monthsEl = $(IDS.ko07_months);

    const rawLink = String(linkEl?.value ?? "").trim();
    const rawMonths = String(monthsEl?.value ?? "").trim();
    const months = Number(rawMonths);

    // Missing inputs
    if (!rawLink || rawMonths === "") {
      validationState.ko07 = false;
      setStatusBadge(IDS.ko07_status, false, "(Thiếu dữ liệu)");
      return false;
    }

    // months check
    if (Number.isNaN(months) || months <= 6) {
      validationState.ko07 = false;
      setStatusBadge(IDS.ko07_status, false, "(Hiệu lực website > 6 tháng)");
      return false;
    }

    // normalize url + domain
    const url = normalizeToUrl(rawLink);
    let domain = "";
    try {
      domain = normalizeDomain(new URL(url).hostname);
    } catch (_) {
      domain = normalizeDomain(rawLink);
    }

    if (!domain || !isValidDomainFormat(domain)) {
      validationState.ko07 = false;
      setStatusBadge(IDS.ko07_status, false, "(Sai định dạng link/domain)");
      return false;
    }

    // show loading
    if (showLoading) {
      const el = $(IDS.ko07_status);
      if (el) {
        el.textContent = "⏳ Đang kiểm tra...";
        el.className = "pill";
      }
    }

    // reachability
    const reachable = await checkUrlReachable(url);
    if (!reachable) {
      validationState.ko07 = false;
      setStatusBadge(IDS.ko07_status, false, "(Website không truy cập được)");
      return false;
    }

    // DNS A
    const dnsOk = await checkDomainDNS(domain);
    if (!dnsOk) {
      validationState.ko07 = false;
      setStatusBadge(IDS.ko07_status, false, "(Không có DNS A record)");
      return false;
    }

    validationState.ko07 = true;
    setStatusBadge(IDS.ko07_status, true, `(${domain} • ${months} tháng)`);
    return true;
  }

  function renderChecklist() {
    const list = $(IDS.progressList);
    if (!list) return;

    const items = [
      { key: IDS.shop_name, label: "Tên Shop" },
      { key: IDS.shop_id, label: "Shop ID" },
      { key: IDS.store_name, label: "Tên DN/Cửa hàng" },
      { key: IDS.category, label: "Ngành hàng" },
      { key: IDS.brand, label: "Thương hiệu" },
      { key: IDS.domain, label: "Website/Domain" },

      { key: "ko01", label: "KO-01: GPKD (PDF + keyword)" },
      { key: "ko02", label: "KO-02: ĐKNH (PDF + keyword)" },
      { key: "ko03", label: "KO-03: UQSP (PDF + keyword)" },
      { key: "ko04", label: "KO-04: CBSP (PDF + keyword)" },
      { key: "ko05", label: "KO-05: Hiệu lực giấy tờ > 6 tháng" },
      { key: "ko06", label: "KO-06: Không vi phạm nghiêm trọng (Có)" },
      { key: "ko07", label: "KO-07: Link hoạt động + DNS A + Website > 6 tháng" },
    ];

    list.innerHTML = items.map(it => {
      const ok = validationState[it.key] === true;
      const cls = ok ? "progress-item pass" : "progress-item fail";
      const sub = ok ? "Đạt" : "Chưa đạt";
      return `
        <li class="${cls}">
          <div class="progress-left">
            <span class="dot"></span>
            <div class="progress-text">
              <strong>${it.label}</strong>
              <span>${sub}</span>
            </div>
          </div>
        </li>
      `;
    }).join("");
  }

  function updateBadges() {
    const total = Object.keys(validationState).length; // 13
    const completed = Object.values(validationState).filter(v => v === true).length;

    // progress badge
    if (completed === total) setBadge(IDS.progressBadge, "success", "Đã đủ dữ liệu");
    else setBadge(IDS.progressBadge, "warning", `Thiếu ${total - completed} mục`);

    // shop badge
    const shopOK = [
      validationState[IDS.shop_name],
      validationState[IDS.shop_id],
      validationState[IDS.store_name],
      validationState[IDS.category],
      validationState[IDS.brand],
      validationState[IDS.domain],
    ].every(Boolean);
    setBadge(IDS.shopInfoBadge, shopOK ? "success" : "warning", shopOK ? "Đã đủ" : "Chưa đủ");

    // hard badge
    const hardOK = [validationState.ko01, validationState.ko02, validationState.ko03, validationState.ko04, validationState.ko05, validationState.ko06, validationState.ko07].every(Boolean);
    setBadge(IDS.hardKoBadge, hardOK ? "success" : "warning", hardOK ? "Đạt" : "Chưa đủ");

    renderChecklist();
  }

  async function validateAll({ showToastOnFail = false } = {}) {
    // shop
    validateShopField(IDS.shop_name);
    validateShopField(IDS.shop_id);
    validateShopField(IDS.store_name);
    validateShopField(IDS.category);
    validateShopField(IDS.brand);
    validateShopField(IDS.domain);

    // files
    validateFile(IDS.ko01_file, IDS.ko01_meta, IDS.ko01_status, "ko01");
    validateFile(IDS.ko02_file, IDS.ko02_meta, IDS.ko02_status, "ko02");
    validateFile(IDS.ko03_file, IDS.ko03_meta, IDS.ko03_status, "ko03");
    validateFile(IDS.ko04_file, IDS.ko04_meta, IDS.ko04_status, "ko04");

    // ko05/06
    validateKO05();
    validateKO06();

    // ko07 async
    await validateKO07_Composed({ showLoading: true });

    updateBadges();

    const allOk = Object.values(validationState).every(v => v === true);

    if (!allOk && showToastOnFail) {
      showToast("error", "Chưa đạt Hard KO", "Vui lòng hoàn thiện các mục đang FAIL trong checklist.");
    }
    return allOk;
  }

  // ===== Persistence / export =====

  function safeParse(raw) {
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  }

  function cacheHardEvidenceLocal(assessmentId, hardObj) {
    try {
      if (!assessmentId || !hardObj) return false;

      const prefix = (window.MRSM_CONFIG && window.MRSM_CONFIG.HARD_GATE_CACHE_PREFIX) || "hard_ko_cache:";
      const ttlHours = Number((window.MRSM_CONFIG && window.MRSM_CONFIG.HARD_GATE_CACHE_TTL_HOURS) || 24) || 24;
      const key = `${prefix}${assessmentId}`;

      const now = Date.now();
      const payload = {
        schema_version: "hard_ko_cache_v1",
        assessment_id: assessmentId,
        hard: hardObj,
        cachedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + ttlHours * 60 * 60 * 1000).toISOString(),
      };

      localStorage.setItem(key, JSON.stringify(payload));
      return true;
    } catch (e) {
      console.warn("[KO_GATE] cacheHardEvidenceLocal failed:", e);
      return false;
    }
  }

  function buildExportData() {
    const nowIso = new Date().toISOString();
    const pickFileMeta = (id) => {
      const f = $(id)?.files?.[0];
      if (!f) return { name: "", type: "", size: null, uploadedAt: null, lastModified: null };
      const lm = typeof f.lastModified === "number" ? f.lastModified : null;
      const uploadedAt = lm ? new Date(lm).toISOString() : nowIso;
      return {
        name: f.name || "",
        type: f.type || "",
        size: typeof f.size === "number" ? f.size : null,
        lastModified: lm,
        uploadedAt,
      };
    };

    return {
      shopInfo: {
        shop_name: $(IDS.shop_name)?.value || "",
        shop_id: $(IDS.shop_id)?.value || "",
        store_name: $(IDS.store_name)?.value || "",
        category: $(IDS.category)?.value || "",
        brand: $(IDS.brand)?.value || "",
        domain: $(IDS.domain)?.value || "",
      },
      metrics: {
        ko05_months: $(IDS.ko05_months)?.value || "",
        ko06_ok: $(IDS.ko06_ok)?.value || "",
        ko07_link: $(IDS.ko07_link)?.value || "",
        ko07_months: $(IDS.ko07_months)?.value || "",
      },
      files: {
        ko01: $(IDS.ko01_file)?.files?.[0]?.name || "",
        ko02: $(IDS.ko02_file)?.files?.[0]?.name || "",
        ko03: $(IDS.ko03_file)?.files?.[0]?.name || "",
        ko04: $(IDS.ko04_file)?.files?.[0]?.name || "",
      },
      files_meta: {
        ko01: pickFileMeta(IDS.ko01_file),
        ko02: pickFileMeta(IDS.ko02_file),
        ko03: pickFileMeta(IDS.ko03_file),
        ko04: pickFileMeta(IDS.ko04_file),
      },
      verifiedAt: new Date().toISOString(),
    };
  }

  async function goNextIfPass() {
    const pass = await validateAll({ showToastOnFail: true });
    if (!pass) {
      showModal("❌ Hard KO chưa đạt", "Vui lòng hoàn thiện các mục đang FAIL trong checklist.");
      return;
    }

    const exportData = buildExportData();

    const urlNow = new URL(window.location.href);
    const aid =
      urlNow.searchParams.get("assessment_id") ||
      sessionStorage.getItem("current_assessment_id") ||
      `A_${Date.now()}`;

    sessionStorage.setItem("current_assessment_id", aid);
    sessionStorage.setItem("validatedHardKO", JSON.stringify(exportData));
    cacheHardEvidenceLocal(aid, exportData);

    // init soft gate 7 days
    const verifiedAt = new Date(exportData.verifiedAt);
    const deadlineAt = new Date(verifiedAt.getTime() + 7 * 24 * 60 * 60 * 1000);

    const softGateInit = {
      schema_version: SCHEMA_VERSION,
      schema_id: SCHEMA_ID,
      verified_at: exportData.verifiedAt,
      gate_status: "G1",
      soft: {
        deadline_at: deadlineAt.toISOString(),
        items: {
          "OP-04": { passed: false, note: "", fixed_at: null },
          "PEN-01": { passed: false, note: "", fixed_at: null },
          "CO-01": { passed: false, note: "", fixed_at: null },
          "SC-02": { passed: false, note: "", fixed_at: null },
        },
      },
    };
    localStorage.setItem("soft_ko_gate", JSON.stringify(softGateInit));

    // modal + countdown 10s
    clearRedirectTimers();
    let seconds = 10;

    showModal(
      "✅ HỒ SƠ HỢP LỆ",
      `Hard KO đã đạt.<br/><br/>Tự chuyển sang Soft KO sau <b><span id="__ko_redirect">${seconds}</span>s</b>...`
    );

    const tick = () => {
      seconds -= 1;
      const el = document.getElementById("__ko_redirect");
      if (el) el.textContent = String(Math.max(seconds, 0));
      if (seconds > 0) redirectTimer.tick = window.setTimeout(tick, 1000);
    };
    redirectTimer.tick = window.setTimeout(tick, 1000);

    redirectTimer.done = window.setTimeout(() => {
      window.location.href = `SOFT_KO.html?assessment_id=${encodeURIComponent(aid)}`;
    }, 10000);
  }

  function resetForm() {
    clearRedirectTimers();
    hideModal();

    // clear shop fields
    [IDS.shop_name, IDS.shop_id, IDS.store_name, IDS.brand, IDS.domain].forEach(id => {
      const el = $(id);
      if (el) el.value = "";
    });
    const cat = $(IDS.category);
    if (cat) cat.value = "";

    // clear files
    [IDS.ko01_file, IDS.ko02_file, IDS.ko03_file, IDS.ko04_file].forEach(id => {
      const el = $(id);
      if (el) el.value = "";
    });

    // clear KO fields
    if ($(IDS.ko05_months)) $(IDS.ko05_months).value = "";
    if ($(IDS.ko06_ok)) $(IDS.ko06_ok).value = "";
    if ($(IDS.ko07_link)) $(IDS.ko07_link).value = "";
    if ($(IDS.ko07_months)) $(IDS.ko07_months).value = "";

    // reset meta
    [IDS.ko01_meta, IDS.ko02_meta, IDS.ko03_meta, IDS.ko04_meta].forEach(id => {
      const el = $(id);
      if (el) el.textContent = "Chưa có file";
    });

    // reset status pills
    setStatusBadge(IDS.ko01_status, null);
    setStatusBadge(IDS.ko02_status, null);
    setStatusBadge(IDS.ko03_status, null);
    setStatusBadge(IDS.ko04_status, null);
    setStatusBadge(IDS.ko05_status, null);
    setStatusBadge(IDS.ko06_status, null);
    setStatusBadge(IDS.ko07_status, null);

    // reset state
    Object.keys(validationState).forEach(k => (validationState[k] = false));
    updateBadges();

    showToast("success", "Đã reset", "Form đã được reset.");
  }

  function restoreFromSession() {
    const raw = sessionStorage.getItem("validatedHardKO");
    if (!raw) return;
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    const shop = data.shopInfo || {};
    const metrics = data.metrics || {};

    if ($(IDS.shop_name)) $(IDS.shop_name).value = shop.shop_name || "";
    if ($(IDS.shop_id)) $(IDS.shop_id).value = shop.shop_id || "";
    if ($(IDS.store_name)) $(IDS.store_name).value = shop.store_name || "";
    if ($(IDS.category)) $(IDS.category).value = shop.category || "";
    if ($(IDS.brand)) $(IDS.brand).value = shop.brand || "";
    if ($(IDS.domain)) $(IDS.domain).value = shop.domain || "";

    if ($(IDS.ko05_months)) $(IDS.ko05_months).value = metrics.ko05_months || "";
    if ($(IDS.ko06_ok)) $(IDS.ko06_ok).value = metrics.ko06_ok || "";
    if ($(IDS.ko07_link)) $(IDS.ko07_link).value = metrics.ko07_link || "";
    if ($(IDS.ko07_months)) $(IDS.ko07_months).value = metrics.ko07_months || "";

    // paint statuses (files can't restore)
    validateShopField(IDS.shop_name);
    validateShopField(IDS.shop_id);
    validateShopField(IDS.store_name);
    validateShopField(IDS.category);
    validateShopField(IDS.brand);
    validateShopField(IDS.domain);

    validateKO05();
    validateKO06();
    validateKO07_Composed({ showLoading: false }).finally(updateBadges);
  }

  // ===== Init listeners =====
  document.addEventListener("DOMContentLoaded", () => {
    // shop fields
    [IDS.shop_name, IDS.shop_id, IDS.store_name, IDS.category, IDS.brand, IDS.domain].forEach(id => {
      $(id)?.addEventListener("input", () => {
        validateShopField(id);
        updateBadges();
      });
      $(id)?.addEventListener("change", () => {
        validateShopField(id);
        updateBadges();
      });
    });

    // file inputs
    $(IDS.ko01_file)?.addEventListener("change", () => { validateFile(IDS.ko01_file, IDS.ko01_meta, IDS.ko01_status, "ko01"); updateBadges(); });
    $(IDS.ko02_file)?.addEventListener("change", () => { validateFile(IDS.ko02_file, IDS.ko02_meta, IDS.ko02_status, "ko02"); updateBadges(); });
    $(IDS.ko03_file)?.addEventListener("change", () => { validateFile(IDS.ko03_file, IDS.ko03_meta, IDS.ko03_status, "ko03"); updateBadges(); });
    $(IDS.ko04_file)?.addEventListener("change", () => { validateFile(IDS.ko04_file, IDS.ko04_meta, IDS.ko04_status, "ko04"); updateBadges(); });

    // KO-05 / KO-06
    $(IDS.ko05_months)?.addEventListener("input", debounce(() => { validateKO05(); updateBadges(); }, 300));
    $(IDS.ko06_ok)?.addEventListener("change", () => { validateKO06(); updateBadges(); });

    // KO-07 (2 inputs) debounce
    const debouncedKO07 = debounce(() => validateKO07_Composed({ showLoading: true }).then(updateBadges), 700);
    $(IDS.ko07_link)?.addEventListener("input", debouncedKO07);
    $(IDS.ko07_months)?.addEventListener("input", debouncedKO07);

    // buttons
    $(IDS.btnValidate)?.addEventListener("click", async () => {
      const pass = await validateAll({ showToastOnFail: true });
      showModal(pass ? "✅ Hard KO đạt" : "❌ Hard KO chưa đạt",
        pass
          ? "Hồ sơ đã đạt Hard KO. Bạn có thể bấm <b>Tiếp tục (Soft KO)</b>."
          : "Vui lòng hoàn thiện các mục đang FAIL trong checklist."
      );
    });

    $(IDS.btnGoSoftKo)?.addEventListener("click", goNextIfPass);
    $(IDS.btnReset)?.addEventListener("click", resetForm);
    $(IDS.btnExport)?.addEventListener("click", exportDebugJSON);

    // modal/toast close
    $(IDS.modalOk)?.addEventListener("click", hideModal);
    $(IDS.modalClose)?.addEventListener("click", hideModal);
    $(IDS.toastClose)?.addEventListener("click", () => $(IDS.toast)?.classList.remove("show"));

    // init paint
    updateBadges();
    restoreFromSession();
  });

})();

