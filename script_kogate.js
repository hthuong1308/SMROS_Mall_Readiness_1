/******************************************************************************
 * script_kogate.js (SYNCED WITH NEW KO_GATE.html)
 * ------------------------------------------------
 * HARD KO (Page 1):
 *  - KO-01/02/03/04: PDF + filename contains keyword
 *  - KO-05: months validity > 6
 *  - KO-06: no severe violation => must be "Có"
 *  - KO-07: domain format valid + DNS A record + website validity months > 6
 *
 * Tracks:
 *  6 shop fields + 7 KO fields = 13
 ******************************************************************************/

(() => {
  "use strict";

  const SCHEMA_VERSION = 1;
  const SCHEMA_ID = "fs_assessment_doc_v1";

  // ====== HTML ID MAP (must match KO_GATE.html) ======
  const IDS = {
    // shop info
    shop_name: "shop_name",
    shop_id: "shop_id",
    store_name: "store_name",
    category: "category",
    brand: "brand",
    domain: "domain",

    // file inputs + meta + status
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

    // extra KO
    ko05_months: "ko05_months",
    ko06_ok: "ko06_ok",
    ko07_months: "ko07_months",
    ko05_status: "ko05_status",
    ko06_status: "ko06_status",
    ko07_status: "ko07_status",

    // badges + checklist
    shopInfoBadge: "shopInfoBadge",
    hardKoBadge: "hardKoBadge",
    progressBadge: "progressBadge",
    progressList: "progressList",
    progressText: "progress-text",

    // final message
    finalMsg: "finalMsg",

    // buttons
    btnValidate: "btnValidate",
    btnGoSoftKo: "btnGoSoftKo",
    btnReset: "btnReset",
    btnExport: "btnExport",

    // modal + toast (existing in HTML)
    modalOverlay: "modalOverlay",
    modalTitle: "modalTitle",
    modalBody: "modalBody",
    modalOk: "modalOk",
    modalClose: "modalClose",
    toast: "toast",
    toastTitle: "toastTitle",
    toastMsg: "toastMsg",
    toastClose: "toastClose",
  };

  // Keywords required in filename (case-insensitive)
  const FILE_KEYWORDS = {
    [IDS.ko01_file]: ["gpkd", "giấy phép", "giay phep", "kinh doanh"],
    [IDS.ko02_file]: ["đknh", "dknh", "nhãn hiệu", "nhan hieu", "đăng ký nhãn", "dang ky nhan"],
    [IDS.ko03_file]: ["uqsp", "ủy quyền", "uy quyen", "phân phối", "phan phoi"],
    [IDS.ko04_file]: ["cbsp", "công bố", "cong bo", "công bố sản phẩm", "cong bo san pham"],
  };

  // Validation state: 13 fields
  const validationState = {
    // shop info (6)
    [IDS.shop_name]: false,
    [IDS.shop_id]: false,
    [IDS.store_name]: false,
    [IDS.category]: false,
    [IDS.brand]: false,
    [IDS.domain]: false, // only "non-empty" for shop info; KO-07 does deeper check

    // KO (7)
    ko01: false,
    ko02: false,
    ko03: false,
    ko04: false,
    ko05: false,
    ko06: false,
    ko07: false, // composed: domain format + DNS + months > 6
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

  function setFieldFixState(fieldId, needFix) {
    const el = $(fieldId);
    if (!el) return;
    const container = el.closest(".input-group, .upload-row-enhanced, .upload-section, .form-card, .field");
    const target = container || el;
    if (needFix) target.classList.add("ko-need-fix");
    else target.classList.remove("ko-need-fix");
  }

  function setStatusBadge(statusId, isPass, message = "") {
    const el = $(statusId);
    if (!el) return;

    const msg = message ? ` ${message}` : "";
    if (isPass === null) {
      el.textContent = "CHƯA KIỂM TRA";
      el.className = "status-badge";
      return;
    }

    el.textContent = (isPass ? "✅ PASS" : "❌ FAIL") + msg;
    el.className = "status-badge " + (isPass ? "valid" : "invalid");
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
    // type optional, if you want color variants later

    window.setTimeout(() => toast.classList.remove("show"), ms);
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

  function focusFirstInvalid() {
    const first = Object.keys(validationState).find(k => validationState[k] !== true);
    if (!first) return;

    // map state key -> element id
    let targetId = first;
    if (first === "ko01") targetId = IDS.ko01_file;
    if (first === "ko02") targetId = IDS.ko02_file;
    if (first === "ko03") targetId = IDS.ko03_file;
    if (first === "ko04") targetId = IDS.ko04_file;
    if (first === "ko05") targetId = IDS.ko05_months;
    if (first === "ko06") targetId = IDS.ko06_ok;
    if (first === "ko07") targetId = IDS.ko07_months;

    const el = $(targetId);
    if (!el) return;
    try {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      if (typeof el.focus === "function") el.focus({ preventScroll: true });
    } catch (_) { }
    setFieldFixState(targetId, true);
    window.setTimeout(() => setFieldFixState(targetId, false), 900);
  }

  // ===== Validation =====

  function validateShopField(id) {
    const el = $(id);
    const ok = !!el && String(el.value || "").trim() !== "";
    validationState[id] = ok;
    setFieldFixState(id, !ok);
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
      setFieldFixState(fileInputId, true);
      return false;
    }

    const lowerName = String(file.name || "").toLowerCase();
    const isPdf = file.type === "application/pdf" || lowerName.endsWith(".pdf");
    if (!isPdf) {
      if (metaEl) metaEl.textContent = "Chưa có file";
      setStatusBadge(statusId, false, "(Chỉ chấp nhận PDF)");
      validationState[stateKey] = false;
      setFieldFixState(fileInputId, true);
      // reset invalid selection
      try { input.value = ""; } catch (_) { }
      return false;
    }

    const keys = FILE_KEYWORDS[fileInputId] || [];
    const fn = normText(file.name);
    const hasKey = keys.some(k => fn.includes(normText(k)));
    if (!hasKey) {
      if (metaEl) metaEl.textContent = file.name;
      setStatusBadge(statusId, false, `(Thiếu keyword)`);
      validationState[stateKey] = false;
      setFieldFixState(fileInputId, true);
      return false;
    }

    if (metaEl) metaEl.textContent = file.name;
    setStatusBadge(statusId, true);
    validationState[stateKey] = true;
    setFieldFixState(fileInputId, false);
    return true;
  }

  function validateKO05() {
    const el = $(IDS.ko05_months);
    const raw = String(el?.value ?? "").trim();
    const months = Number(raw);
    const ok = raw !== "" && !Number.isNaN(months) && months > 6;

    validationState.ko05 = ok;
    setFieldFixState(IDS.ko05_months, !ok);
    setStatusBadge(IDS.ko05_status, ok, ok ? "" : "(Phải > 6 tháng)");
    return ok;
  }

  function validateKO06() {
    const el = $(IDS.ko06_ok);
    const ok = !!el && String(el.value) === "Có";

    validationState.ko06 = ok;
    setFieldFixState(IDS.ko06_ok, !ok);
    setStatusBadge(IDS.ko06_status, ok, ok ? "" : "(Chỉ 'Có' mới đạt)");
    return ok;
  }

  async function validateKO07_Composed({ showLoading = false } = {}) {
    const domainEl = $(IDS.domain);
    const monthsEl = $(IDS.ko07_months);

    const rawDomain = String(domainEl?.value ?? "").trim();
    const rawMonths = String(monthsEl?.value ?? "").trim();
    const months = Number(rawMonths);

    // Missing
    if (!rawDomain || rawMonths === "") {
      validationState.ko07 = false;
      setFieldFixState(IDS.domain, !rawDomain);
      setFieldFixState(IDS.ko07_months, rawMonths === "");
      setStatusBadge(IDS.ko07_status, false, "(Thiếu dữ liệu)");
      return false;
    }

    // months check
    if (Number.isNaN(months) || months <= 6) {
      validationState.ko07 = false;
      setFieldFixState(IDS.ko07_months, true);
      setStatusBadge(IDS.ko07_status, false, "(Hiệu lực website > 6 tháng)");
      return false;
    } else {
      setFieldFixState(IDS.ko07_months, false);
    }

    // domain normalize + format
    const domain = normalizeDomain(rawDomain);
    if (!isValidDomainFormat(domain)) {
      validationState.ko07 = false;
      setFieldFixState(IDS.domain, true);
      setStatusBadge(IDS.ko07_status, false, "(Sai định dạng domain)");
      return false;
    }
    setFieldFixState(IDS.domain, false);

    // DNS A record
    if (showLoading) setStatusBadge(IDS.ko07_status, null);
    const statusEl = $(IDS.ko07_status);
    if (statusEl) {
      statusEl.textContent = "⏳ Đang kiểm tra DNS...";
      statusEl.className = "status-badge";
    }

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

  function computeBadgesAndChecklist() {
    const total = Object.keys(validationState).length; // 13
    const completed = Object.values(validationState).filter(v => v === true).length;

    // progress text
    const pt = $(IDS.progressText);
    if (pt) pt.textContent = `Hoàn thành hồ sơ: ${completed}/${total}`;

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

    if (shopOK) setBadge(IDS.shopInfoBadge, "success", "Đã đủ");
    else setBadge(IDS.shopInfoBadge, "warning", "Chưa đủ");

    // hard ko badge
    const hardOK = [validationState.ko01, validationState.ko02, validationState.ko03, validationState.ko04, validationState.ko05, validationState.ko06, validationState.ko07].every(Boolean);
    if (hardOK) setBadge(IDS.hardKoBadge, "success", "Đạt");
    else setBadge(IDS.hardKoBadge, "warning", "Chưa đủ");

    // render checklist items (13)
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
      { key: "ko07", label: "KO-07: DNS A record + Website > 6 tháng" },
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

  function setFinalMsg(pass) {
    const el = $(IDS.finalMsg);
    if (!el) return;
    if (pass) {
      el.textContent = "✅ HỒ SƠ HỢP LỆ - CỔNG ĐÃ MỞ";
      el.className = "final-msg pass";
    } else {
      el.textContent = "❌ HỒ SƠ CHƯA ĐẠT - VUI LÒNG HOÀN THIỆN CÁC MỤC THIẾU";
      el.className = "final-msg fail";
    }
  }

  async function validateAll({ showToastOnFail = false } = {}) {
    // shop info
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

    // extra KO
    validateKO05();
    validateKO06();
    await validateKO07_Composed({ showLoading: true });

    computeBadgesAndChecklist();

    const allOk = Object.values(validationState).every(v => v === true);
    setFinalMsg(allOk);

    if (!allOk && showToastOnFail) {
      showToast("error", "Chưa đạt Hard KO", "Vui lòng hoàn thiện các mục đang FAIL trong checklist.");
    }

    return allOk;
  }

  // ===== Persistence / navigation (keep your original gate logic) =====

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
        expiresAt: new Date(now + ttlHours * 60 * 60 * 1000).toISOString()
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
        uploadedAt
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
        ko07_months: $(IDS.ko07_months)?.value || "",
        ko07_domain: $(IDS.domain)?.value || "",
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
      verifiedAt: new Date().toISOString()
    };
  }

  async function goNextIfPass() {
    const pass = await validateAll({ showToastOnFail: true });
    if (!pass) {
      // highlight invalids
      Object.keys(validationState).forEach(k => {
        if (validationState[k] !== true) {
          if (k === "ko01") setFieldFixState(IDS.ko01_file, true);
          else if (k === "ko02") setFieldFixState(IDS.ko02_file, true);
          else if (k === "ko03") setFieldFixState(IDS.ko03_file, true);
          else if (k === "ko04") setFieldFixState(IDS.ko04_file, true);
          else if (k === "ko05") setFieldFixState(IDS.ko05_months, true);
          else if (k === "ko06") setFieldFixState(IDS.ko06_ok, true);
          else if (k === "ko07") setFieldFixState(IDS.ko07_months, true);
          else setFieldFixState(k, true);
        }
      });
      focusFirstInvalid();
      return;
    }

    // PASS HARD KO => Save evidence + init soft gate
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
          "SC-02": { passed: false, note: "", fixed_at: null }
        }
      }
    };
    localStorage.setItem("soft_ko_gate", JSON.stringify(softGateInit));

    // show modal + countdown (fallback if modal missing)
    let seconds = 5;
    const html = `Hồ sơ Hard KO đã đạt.<br/><br/>Tự chuyển sang Soft KO sau <b><span id="__ko_redirect">${seconds}</span>s</b>...`;
    showModal("✅ HỒ SƠ HỢP LỆ", html);

    clearRedirectTimers();

    const tick = () => {
      seconds -= 1;
      const el = document.getElementById("__ko_redirect");
      if (el) el.textContent = String(Math.max(seconds, 0));
      if (seconds > 0) redirectTimer.tick = window.setTimeout(tick, 1000);
    };
    redirectTimer.tick = window.setTimeout(tick, 1000);

    redirectTimer.done = window.setTimeout(() => {
      window.location.href = `SOFT_KO.html?assessment_id=${encodeURIComponent(aid)}`;
    }, 5000);
  }

  function downloadJSON(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportDebugJSON() {
    const data = {
      validatedHardKO: safeParse(sessionStorage.getItem("validatedHardKO")),
      soft_ko_gate: safeParse(localStorage.getItem("soft_ko_gate")),
      current_assessment_id: sessionStorage.getItem("current_assessment_id") || "",
      computedAt: new Date().toISOString()
    };
    downloadJSON("KO_GATE_debug.json", data);
    showToast("success", "Export thành công", "Đã tải KO_GATE_debug.json");
  }

  function safeParse(raw) {
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  }

  function resetForm() {
    clearRedirectTimers();
    hideModal();

    // clear fields
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
    const ko05 = $(IDS.ko05_months);
    if (ko05) ko05.value = "";
    const ko06 = $(IDS.ko06_ok);
    if (ko06) ko06.value = "";
    const ko07m = $(IDS.ko07_months);
    if (ko07m) ko07m.value = "";

    // reset meta
    [IDS.ko01_meta, IDS.ko02_meta, IDS.ko03_meta, IDS.ko04_meta].forEach(id => {
      const el = $(id);
      if (el) el.textContent = "Chưa có file";
    });

    // reset status
    setStatusBadge(IDS.ko01_status, null);
    setStatusBadge(IDS.ko02_status, null);
    setStatusBadge(IDS.ko03_status, null);
    setStatusBadge(IDS.ko04_status, null);
    setStatusBadge(IDS.ko05_status, null);
    setStatusBadge(IDS.ko06_status, null);
    setStatusBadge(IDS.ko07_status, null);

    // reset state
    Object.keys(validationState).forEach(k => (validationState[k] = false));
    computeBadgesAndChecklist();
    setFinalMsg(false);
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
    if ($(IDS.ko07_months)) $(IDS.ko07_months).value = metrics.ko07_months || "";

    // revalidate (files cannot be restored)
    validateShopField(IDS.shop_name);
    validateShopField(IDS.shop_id);
    validateShopField(IDS.store_name);
    validateShopField(IDS.category);
    validateShopField(IDS.brand);
    validateShopField(IDS.domain);

    validateKO05();
    validateKO06();
    // KO-07 async
    validateKO07_Composed({ showLoading: false }).finally(() => computeBadgesAndChecklist());
  }

  // ===== Init listeners =====
  document.addEventListener("DOMContentLoaded", () => {
    // shop fields
    [IDS.shop_name, IDS.shop_id, IDS.store_name, IDS.category, IDS.brand].forEach(id => {
      $(id)?.addEventListener("input", () => {
        validateShopField(id);
        computeBadgesAndChecklist();
      });
      $(id)?.addEventListener("change", () => {
        validateShopField(id);
        computeBadgesAndChecklist();
      });
    });

    // domain: shopInfo non-empty + KO07 composed (debounced DNS)
    const debouncedKO07 = debounce(() => validateKO07_Composed({ showLoading: true }).then(computeBadgesAndChecklist), 800);
    $(IDS.domain)?.addEventListener("input", () => {
      validateShopField(IDS.domain); // shop info "required"
      debouncedKO07();
    });

    // file inputs
    $(IDS.ko01_file)?.addEventListener("change", () => { validateFile(IDS.ko01_file, IDS.ko01_meta, IDS.ko01_status, "ko01"); computeBadgesAndChecklist(); });
    $(IDS.ko02_file)?.addEventListener("change", () => { validateFile(IDS.ko02_file, IDS.ko02_meta, IDS.ko02_status, "ko02"); computeBadgesAndChecklist(); });
    $(IDS.ko03_file)?.addEventListener("change", () => { validateFile(IDS.ko03_file, IDS.ko03_meta, IDS.ko03_status, "ko03"); computeBadgesAndChecklist(); });
    $(IDS.ko04_file)?.addEventListener("change", () => { validateFile(IDS.ko04_file, IDS.ko04_meta, IDS.ko04_status, "ko04"); computeBadgesAndChecklist(); });

    // KO-05
    const debouncedKO05 = debounce(() => { validateKO05(); computeBadgesAndChecklist(); }, 400);
    $(IDS.ko05_months)?.addEventListener("input", debouncedKO05);

    // KO-06
    $(IDS.ko06_ok)?.addEventListener("change", () => { validateKO06(); computeBadgesAndChecklist(); });

    // KO-07 months: validate immediately (no debounce)
    $(IDS.ko07_months)?.addEventListener("input", () => {
      validateKO07_Composed({ showLoading: false }).then(computeBadgesAndChecklist);
    });

    // buttons
    $(IDS.btnValidate)?.addEventListener("click", async () => {
      await validateAll({ showToastOnFail: true });
      // show modal with status
      const pass = Object.values(validationState).every(v => v === true);
      if (pass) showModal("✅ Hard KO đạt", "Hồ sơ đã đạt Hard KO. Bạn có thể bấm <b>Tiếp tục (Soft KO)</b>.");
      else showModal("❌ Hard KO chưa đạt", "Vui lòng hoàn thiện các mục đang FAIL trong checklist.");
    });

    $(IDS.btnGoSoftKo)?.addEventListener("click", () => {
      goNextIfPass();
    });

    $(IDS.btnReset)?.addEventListener("click", resetForm);
    $(IDS.btnExport)?.addEventListener("click", exportDebugJSON);

    // modal/toast close
    $(IDS.modalOk)?.addEventListener("click", hideModal);
    $(IDS.modalClose)?.addEventListener("click", hideModal);
    $(IDS.toastClose)?.addEventListener("click", () => $(IDS.toast)?.classList.remove("show"));

    // initial paint
    computeBadgesAndChecklist();
    setFinalMsg(false);
    restoreFromSession();
  });

})();
