/******************************************************************************
 * KO GATE VALIDATION SCRIPT – SMROS / MRSM (HARD KO)
 *
 * HARD KO (Page 1):
 *  - KO-01/02/03/04: PDF + filename contains keyword
 *  - KO-05: months validity > 6
 *  - KO-06: no severe violation => must be "Có"
 *  - KO-07: domain format valid + DNS A record via Google DoH
 *
 * TOTAL FIELDS TRACKED:
 *  6 shop fields + 7 KO fields = 13
 ******************************************************************************/

/* =========================================
   1) CONFIG & GLOBAL STATE
   ========================================= */

const SCHEMA_VERSION = 1;
const SCHEMA_ID = "fs_assessment_doc_v1";

const FILE_KEYWORDS = {
  ko01: ["giấy phép kinh doanh", "gpkd"],
  ko02: ["nhãn hiệu", "đăng ký nhãn", "quy tắc sử dụng"],
  ko03: ["ủy quyền", "nguồn gốc", "phân phối"],
  ko04: ["giấy công bố", "hồ sơ công bố", "công bố sản phẩm"]
};

const validationState = {
  // Shop info (6)
  companyName: false,
  businessLicenseNo: false,
  brandName: false,
  shopId: false,
  userId: false,
  username: false,

  // KO (7)
  ko01: false,
  ko02: false,
  ko03: false,
  ko04: false,
  ko05: false, // months validity
  ko06: false, // severe violation (select)
  ko07: false  // domain
};

let redirectTimer = { tick: null, done: null };

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



/* =========================================
   2) HELPERS (UTILITY FUNCTIONS)
   ========================================= */

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

function normText(s) {
  return (s || "").toLowerCase().trim();
}

function normalizeDomain(input) {
  let domain = (input || "").trim().toLowerCase();
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
  } catch (error) {
    console.error("DNS check error:", error);
    return false;
  }
}

function setStatusUI(elementId, isPass, message = "") {
  const el = document.getElementById(elementId);
  if (!el) return;

  el.style.display = "inline-block";

  if (isPass) {
    el.innerHTML = `✅ PASS ${message}`.trim();
    el.className = "status-badge pass";
  } else {
    el.innerHTML = `❌ FAIL ${message}`.trim();
    el.className = "status-badge fail";
  }

  updateProgressChecklist();
  evaluateFinalGate();
}


/* =========================================
   2) UX HELPERS (Highlight missing fields)
   ========================================= */

function setFieldFixState(fieldId, needFix) {
  const el = document.getElementById(fieldId);
  if (!el) return;

  const targets = [el];
  // Try to also mark a container for better visibility
  const container = el.closest(".metric-card, .field, .form-group, .input-group, .upload-field, .upload-box");
  if (container && container !== el) targets.push(container);

  targets.forEach(t => {
    if (!t) return;
    if (needFix) t.classList.add("ko-need-fix");
    else t.classList.remove("ko-need-fix");
  });
}

function highlightInvalidFields() {
  const keys = Object.keys(validationState);
  keys.forEach(k => setFieldFixState(k, false));
  keys.filter(k => validationState[k] !== true).forEach(k => setFieldFixState(k, true));
}

/* =========================================
   3) VALIDATION (CORE RULES)
   ========================================= */

function validateShopInfo(fieldId) {
  const input = document.getElementById(fieldId);
  const isValid = !!input && input.value.trim() !== "";
  validationState[fieldId] = isValid;
  setFieldFixState(fieldId, !isValid);

  updateProgressChecklist();
  evaluateFinalGate();
}

function validateFileField(fileId) {
  const fileInput = document.getElementById(fileId);
  const file = fileInput?.files?.[0];
  const statusId = `status-${fileId}`;
  const fileNameEl = document.getElementById(`${fileId}-name`);
  const keywords = FILE_KEYWORDS[fileId] || [];

  // 1) Required
  if (!file) {
    setStatusUI(statusId, false, "(Chưa chọn file)");
    validationState[fileId] = false;
    setFieldFixState(fileId, true);
    if (fileNameEl) fileNameEl.textContent = "Chưa chọn file";
    return;
  }

  // Show filename
  if (fileNameEl) fileNameEl.textContent = file.name;

  // 2) PDF only
  const lowerName = file.name.toLowerCase();
  const isPdf = file.type === "application/pdf" || lowerName.endsWith(".pdf");
  if (!isPdf) {
    setStatusUI(statusId, false, "(Chỉ chấp nhận file PDF)");
    validationState[fileId] = false;
    setFieldFixState(fileId, true);
    fileInput.value = "";
    if (fileNameEl) fileNameEl.textContent = "Chưa chọn file";
    return;
  }

  // 3) Keyword check
  const fn = normText(file.name);
  const hasKey = keywords.some(k => fn.includes(normText(k)));

  if (!hasKey) {
    setStatusUI(statusId, false, `(Thiếu từ khóa: ${keywords[0] || "keyword"})`);
    validationState[fileId] = false;
    setFieldFixState(fileId, true);
    return;
  }

  // Pass
  validationState[fileId] = true;
  setFieldFixState(fileId, false);
  setStatusUI(statusId, true);
}

function validateKO05() {
  const input = document.getElementById("ko05");
  const raw = input ? input.value : "";
  const months = Number(raw);

  const isValid = raw !== "" && !Number.isNaN(months) && months > 6;
  validationState.ko05 = isValid;
  setFieldFixState("ko05", !isValid);
  setStatusUI("status-ko05", isValid, isValid ? "" : "(Phải > 6 tháng)");
}

function validateKO06() {
  const select = document.getElementById("ko06");
  const isValid = !!select && select.value === "Có";

  validationState.ko06 = isValid;
  setFieldFixState("ko06", !isValid);
  setStatusUI("status-ko06", isValid, isValid ? "" : "(Chỉ 'Có' mới đạt)");
}

async function validateKO07_Composed() {
  const domainEl = document.getElementById("domain");
  const monthsEl = document.getElementById("ko07_months");
  const statusEl = document.getElementById("ko07_status");
  if (!domainEl || !monthsEl || !statusEl) return;

  const rawDomain = (domainEl.value || "").trim();
  const rawMonths = (monthsEl.value || "").trim();
  const months = Number(rawMonths);

  // Missing
  if (!rawDomain || rawMonths === "") {
    statusEl.textContent = "Chưa kiểm tra";
    statusEl.className = "pill";
    // tuỳ code bạn: set validationState.ko07 = false;
    return;
  }

  // months check
  if (Number.isNaN(months) || months <= 6) {
    statusEl.textContent = "❌ FAIL (Hiệu lực website phải > 6 tháng)";
    statusEl.className = "pill fail";
    // validationState.ko07 = false;
    return;
  }

  // domain normalize + format
  const domain = rawDomain
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split("?")[0]
    .split("#")[0];

  const domainRegex = /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/;
  if (!domainRegex.test(domain)) {
    statusEl.textContent = "❌ FAIL (Sai định dạng domain)";
    statusEl.className = "pill fail";
    // validationState.ko07 = false;
    return;
  }

  // DNS A record (Google DoH)
  statusEl.textContent = "⏳ Đang kiểm tra DNS...";
  statusEl.className = "pill";

  let dnsOk = false;
  try {
    const url = `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=A`;
    const res = await fetch(url);
    const data = await res.json();
    dnsOk = data?.Status === 0 && Array.isArray(data?.Answer) && data.Answer.length > 0;
  } catch (_) {
    dnsOk = false;
  }

  if (!dnsOk) {
    statusEl.textContent = "❌ FAIL (Domain không có DNS A record)";
    statusEl.className = "pill fail";
    // validationState.ko07 = false;
    return;
  }

  // PASS
  statusEl.textContent = `✅ PASS (${domain} • ${months} tháng)`;
  statusEl.className = "pill pass";
  // validationState.ko07 = true;
}


/* =========================================
   4) UX: PROGRESS + GATE + RESET + NAV
   ========================================= */

function updateProgressChecklist() {
  const total = Object.keys(validationState).length; // 13
  const completed = Object.values(validationState).filter(v => v === true).length;

  // Total progress
  const progressEl = document.getElementById("progress-text");
  if (progressEl) progressEl.innerText = `Hoàn thành hồ sơ: ${completed}/${total}`;

  // Group 1: Shop info (6 fields)
  const checkShop = document.getElementById("check-shop");
  const shopCompleted = [
    validationState.companyName,
    validationState.businessLicenseNo,
    validationState.brandName,
    validationState.shopId,
    validationState.userId,
    validationState.username
  ].every(v => v === true);

  if (checkShop) {
    if (shopCompleted) {
      checkShop.classList.add("completed");
      checkShop.querySelector(".check-icon").textContent = "✓";
    } else {
      checkShop.classList.remove("completed");
      checkShop.querySelector(".check-icon").textContent = "○";
    }
  }

  // Group 2: Files (4)
  const checkFiles = document.getElementById("check-files");
  const filesCompleted = [validationState.ko01, validationState.ko02, validationState.ko03, validationState.ko04]
    .filter(v => v).length;

  if (checkFiles) {
    const fileText = checkFiles.querySelector("span:last-child");
    if (fileText) fileText.textContent = `Tài liệu KO (${filesCompleted}/4)`;

    if (filesCompleted === 4) {
      checkFiles.classList.add("completed");
      checkFiles.querySelector(".check-icon").textContent = "✓";
    } else {
      checkFiles.classList.remove("completed");
      checkFiles.querySelector(".check-icon").textContent = "○";
    }
  }

  // Group 3: Extra info (3): ko05, ko06, ko07
  const checkMetrics = document.getElementById("check-metrics");
  const metricsCompleted = [validationState.ko05, validationState.ko06, validationState.ko07].filter(v => v).length;

  if (checkMetrics) {
    const metricText = checkMetrics.querySelector("span:last-child");
    if (metricText) metricText.textContent = `Thông tin bổ sung (${metricsCompleted}/3)`;

    if (metricsCompleted === 3) {
      checkMetrics.classList.add("completed");
      checkMetrics.querySelector(".check-icon").textContent = "✓";
    } else {
      checkMetrics.classList.remove("completed");
      checkMetrics.querySelector(".check-icon").textContent = "○";
    }
  }
}

function focusFirstInvalidField() {
  const firstInvalidKey = Object.keys(validationState).find(k => validationState[k] !== true);
  if (!firstInvalidKey) return;

  const el = document.getElementById(firstInvalidKey);
  if (!el) return;

  try {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    if (typeof el.focus === "function") el.focus({ preventScroll: true });
  } catch (_) {
    // no-op
  }

  // nhẹ nhàng nhắc người dùng (không phụ thuộc CSS)
  el.classList.add("ko-need-fix");
  window.setTimeout(() => el.classList.remove("ko-need-fix"), 800);
}

function evaluateFinalGate() {
  const isAllValid = Object.values(validationState).every(v => v === true);
  const nextBtn = document.getElementById("nextBtn");
  const finalMsg = document.getElementById("final-ko-status");
  const finalContainer = document.getElementById("final-status-container");

  if (nextBtn) {
    nextBtn.disabled = !isAllValid;
    isAllValid ? nextBtn.classList.remove("disabled") : nextBtn.classList.add("disabled");
  }

  // Only update final message if container is visible (after click)
  if (finalMsg && finalContainer && finalContainer.style.display !== "none") {
    if (isAllValid) {
      finalMsg.innerHTML = "✅ HỒ SƠ HỢP LỆ - CỔNG ĐÃ MỞ";
      finalMsg.className = "final-msg pass";
    } else {
      finalMsg.innerHTML = "❌ HỒ SƠ CHƯA ĐẠT - VUI LÒNG HOÀN THIỆN CÁC MỤC ĐỎ";
      finalMsg.className = "final-msg fail";
    }
  }
}

function resetForm() {
  // 🧹 DỪNG countdown nếu đang chạy
  clearRedirectTimers();
  // Ẩn popup thành công nếu đang mở
  const modal = document.getElementById("successModal");
  if (modal) modal.style.display = "none";

  // Disable nút Kiểm tra (sẽ được bật lại khi đủ điều kiện)
  const nextBtn = document.getElementById("nextBtn");
  if (nextBtn) nextBtn.disabled = true;

  /* ===== CLEAR INPUTS ===== */

  // Shop + extra fields
  [
    "companyName",
    "businessLicenseNo",
    "brandName",
    "shopId",
    "userId",
    "username",
    "ko05",
    "ko06",
    "ko07"
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  // File inputs
  ["ko01", "ko02", "ko03", "ko04"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  // Reset file name labels
  ["ko01-name", "ko02-name", "ko03-name", "ko04-name"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = "Chưa chọn file";
  });

  /* ===== RESET STATE ===== */

  Object.keys(validationState).forEach(k => {
    validationState[k] = false;
    setFieldFixState(k, false);
  });

  // Reset status badges
  [
    "status-ko01",
    "status-ko02",
    "status-ko03",
    "status-ko04",
    "status-ko05",
    "status-ko06",
    "status-ko07"
  ].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = "none";
    el.textContent = "CHƯA KIỂM TRA";
    el.className = "status-badge";
  });

  // Ẩn box kết quả cuối
  const finalContainer = document.getElementById("final-status-container");
  if (finalContainer) finalContainer.style.display = "none";

  // Cập nhật lại UI
  updateProgressChecklist();
  evaluateFinalGate();
}




/* =========================================
   3.5) HARD KO EVIDENCE CACHE (assessment_id + TTL)
   - Mirror Hard KO evidence từ sessionStorage -> localStorage theo assessment_id
   - Giúp reproducibility/traceability khi mở tab mới hoặc reload
   - TTL để tránh reuse quá lâu (fail-closed nếu hết hạn)
   ========================================= */
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

function handleNavigation() {
  const finalContainer = document.getElementById("final-status-container");
  if (finalContainer) finalContainer.style.display = "block";

  evaluateFinalGate();

  const isAllValid = Object.values(validationState).every(v => v === true);

  // ❌ Chưa đạt → giữ hành vi cũ
  if (!isAllValid) {
    highlightInvalidFields();
    focusFirstInvalidField();
    return;
  }
  if (finalContainer) finalContainer.style.display = "none";

  /* ===== PASS HARD KO ===== */

  // 1. Lưu sessionStorage (giữ nguyên logic)
  const exportData = {
    shopInfo: {
      companyName: document.getElementById("companyName")?.value || "",
      businessLicenseNo: document.getElementById("businessLicenseNo")?.value || "",
      brandName: document.getElementById("brandName")?.value || "",
      shopId: document.getElementById("shopId")?.value || "",
      userId: document.getElementById("userId")?.value || "",
      username: document.getElementById("username")?.value || ""
    },
    metrics: {
      ko05_months: document.getElementById("ko05")?.value || "",
      ko06_noSevereViolation: document.getElementById("ko06")?.value || "",
      ko07_domain: document.getElementById("ko07")?.value || ""
    },
    files: {
      ko01: document.getElementById("ko01")?.files?.[0]?.name || "",
      ko02: document.getElementById("ko02")?.files?.[0]?.name || "",
      ko03: document.getElementById("ko03")?.files?.[0]?.name || "",
      ko04: document.getElementById("ko04")?.files?.[0]?.name || ""
    },
    files_meta: (function () {
      const nowIso = new Date().toISOString();
      const pick = (id) => {
        const f = document.getElementById(id)?.files?.[0];
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
      return { ko01: pick("ko01"), ko02: pick("ko02"), ko03: pick("ko03"), ko04: pick("ko04") };
    })(),
    verifiedAt: new Date().toISOString()
  };

  // ✅ Assessment identity (SSOT)
  const urlNow = new URL(window.location.href);
  const aid =
    urlNow.searchParams.get("assessment_id") ||
    sessionStorage.getItem("current_assessment_id") ||
    `A_${Date.now()}`;
  sessionStorage.setItem("current_assessment_id", aid);

  sessionStorage.setItem("validatedHardKO", JSON.stringify(exportData));
  // Mirror evidence to localStorage (assessment_id + TTL)
  cacheHardEvidenceLocal(aid, exportData);

  // ===== INIT SOFT KO GATE (7-day window) =====
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

  // 2. Hiện popup HỒ SƠ HỢP LỆ
  const modal = document.getElementById("successModal");
  const countdownEl = document.getElementById("redirectCountdown");

  if (modal) modal.style.display = "flex";

  //  KHÓA NÚT, KHÔNG CHO BẤM NHIỀU LẦN
  const nextBtn = document.getElementById("nextBtn");
  if (nextBtn) nextBtn.disabled = true;

  // Nếu có timer cũ thì xóa
  clearRedirectTimers();

  // 3. Đếm ngược 10s → tự chuyển trang
  let seconds = 10;
  if (countdownEl) countdownEl.textContent = seconds;

  const tick = () => {
    seconds -= 1;
    if (countdownEl) countdownEl.textContent = Math.max(seconds, 0);
    if (seconds > 0) {
      redirectTimer.tick = window.setTimeout(tick, 1000);
    }
  };

  // countdown tick (setTimeout chain)
  redirectTimer.tick = window.setTimeout(tick, 1000);

  // redirect (single setTimeout)
  redirectTimer.done = window.setTimeout(() => {
    window.location.href = `SOFT_KO.html?assessment_id=${encodeURIComponent(aid)}`;
  }, 10 * 1000);
}
function restoreHardKOFromSession() {
  const raw = sessionStorage.getItem("validatedHardKO");
  if (!raw) return;

  let data;
  try { data = JSON.parse(raw); } catch { return; }

  const shop = data.shopInfo || {};
  const metrics = data.metrics || {};

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val ?? "";
  };

  // Shop fields
  setVal("companyName", shop.companyName);
  setVal("businessLicenseNo", shop.businessLicenseNo);
  setVal("brandName", shop.brandName);
  setVal("shopId", shop.shopId);
  setVal("userId", shop.userId);
  setVal("username", shop.username);

  // KO extra fields
  setVal("ko05", metrics.ko05_months);
  setVal("ko06", metrics.ko06_noSevereViolation);
  setVal("ko07", metrics.ko07_domain);

  // Re-validate để update UI/State
  ["companyName", "businessLicenseNo", "brandName", "shopId", "userId", "username"].forEach(validateShopInfo);
  validateKO05();
  validateKO06();
  validateKO07(); // async DNS check
}


/* =========================================
   5) INIT EVENT LISTENERS
   ========================================= */

document.addEventListener("DOMContentLoaded", () => {
  // Shop info (6 fields)
  ["companyName", "businessLicenseNo", "brandName", "shopId", "userId", "username"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", () => validateShopInfo(id));
  });

  // File uploads (4 files)
  document.getElementById("ko01")?.addEventListener("change", () => validateFileField("ko01"));
  document.getElementById("ko02")?.addEventListener("change", () => validateFileField("ko02"));
  document.getElementById("ko03")?.addEventListener("change", () => validateFileField("ko03"));
  document.getElementById("ko04")?.addEventListener("change", () => validateFileField("ko04"));

  // KO-05 months (debounce)
  const debouncedKO05 = debounce(validateKO05, 500);
  document.getElementById("ko05")?.addEventListener("input", debouncedKO05);

  // KO-06 select
  document.getElementById("ko06")?.addEventListener("change", validateKO06);

  // KO-07 domain (debounce + async DNS)
  const debouncedKO07 = debounce(() => validateKO07_Composed(), 800);

  document.getElementById("domain")?.addEventListener("input", () => debouncedKO07());
  document.getElementById("ko07_months")?.addEventListener("input", () => validateKO07_Composed());


  // Buttons
  document.getElementById("nextBtn")?.addEventListener("click", handleNavigation);
  document.getElementById("resetBtn")?.addEventListener("click", resetForm);

  // Initial paint
  updateProgressChecklist();
  evaluateFinalGate();
  restoreHardKOFromSession();

});
