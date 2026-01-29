/**
 * ============================================================
 * SOFT_KO_SCRIPT.JS (FULL FIXED - MATCH SOFT_KO.html)
 * ============================================================
 * Fixes:
 * 1) Lock dynamic + reconcile lock with gate_status (no "stuck disabled")
 * 2) UI selectors match SOFT_KO.html ids: op04/pen01/co01/sc02, badge-*, hint-*, check-*, progress-text, nextBtn
 * 3) Guard Hard KO (fail-closed) + soft gate init/migrate
 * 4) Validate: clamp by type; do NOT write gate when empty
 * 5) Next button enabled when all 4 filled; clicking -> PASS shows success modal + lock + redirect; otherwise rejection modal
 * ============================================================
 */

// ===== Config (thresholds) =====
const SOFT_KO_DEFAULTS = {
  "OP-04": { type: "percentage", direction: "min", threshold: 85, unit: "%" },
  "PEN-01": { type: "number", direction: "max", threshold: 2, unit: " Sao" },
  "CO-01": { type: "percentage", direction: "max", threshold: 10, unit: "%" },
  "SC-02": { type: "number", direction: "min", threshold: 150, unit: " đơn" },
};

// Map localKey -> ruleId
const RULE_MAP = { op04: "OP-04", pen01: "PEN-01", co01: "CO-01", sc02: "SC-02" };

// ===== Storage Keys =====
const SOFT_GATE_KEY = "soft_ko_gate";
const SOFT_GATE_LOCK_KEY = "soft_ko_gate_locked"; // lock only when PASS
const HARD_KO_KEY = "validatedHardKO";

// ===== Helpers =====
function safeParse(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}
function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}
function formatDate(date) {
  if (!date) return "—";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return String(date);
  return d.toLocaleDateString("vi-VN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function getGateStatusEnum() {
  // if MRSM_CONFIG exists, prefer it
  return (
    window.MRSM_CONFIG?.GATE_STATUS || {
      PASS: "PASS",
      SOFT_PENDING: "G1",
      SOFT_OVERDUE: "G2",
      HARD_FAIL: "G0",
      UNKNOWN: "UNKNOWN",
    }
  );
}

function getSoftKoIds() {
  const ids = window.MRSM_CONFIG?.SOFT_KO_IDS;
  if (Array.isArray(ids) && ids.length) return ids.slice();
  return ["OP-04", "PEN-01", "CO-01", "SC-02"];
}

function getLabel(ruleId) {
  const meta = window.MRSM_CONFIG?.getKpiMeta?.(ruleId);
  return meta?.name || ruleId;
}

function getRuleSpec(ruleId) {
  // if later you add SSOT rules in MRSM_CONFIG, plug here
  return SOFT_KO_DEFAULTS[ruleId] || null;
}

// ===== Hard KO guard (fail-closed) =====
function requireHardGateOrRedirect() {
  if (window.GateGuard && typeof window.GateGuard.requireHardGateOrRedirect === "function") {
    return window.GateGuard.requireHardGateOrRedirect({ redirectOnMissing: true });
  }

  const raw = sessionStorage.getItem(HARD_KO_KEY);
  if (!raw) {
    window.location.href = "KO_GATE.html";
    return false;
  }
  return true;
}

// ===== Build inputs config from rules + HTML existing ids =====
let inputs = {};
function buildInputs() {
  const out = {};
  const ids = getSoftKoIds();

  for (const ruleId of ids) {
    const spec = getRuleSpec(ruleId);
    if (!spec) continue;

    // convert ruleId -> localKey using RULE_MAP reverse
    const localKey = Object.keys(RULE_MAP).find((k) => RULE_MAP[k] === ruleId);
    if (!localKey) continue;

    // only include if HTML has input id
    const inputEl = document.getElementById(localKey);
    if (!inputEl) continue;

    const sign = spec.direction === "min" ? "≥" : "≤";
    const unit = spec.unit || "";

    out[localKey] = {
      id: localKey,
      ruleId,
      name: getLabel(ruleId),
      type: spec.type,
      direction: spec.direction,
      threshold: spec.threshold,
      unit,
      passText: `Đạt chuẩn (${sign} ${spec.threshold}${unit})`,
      failText: `Cần cải thiện (${sign} ${spec.threshold}${unit})`,
    };
  }
  return out;
}

// ===== Gate init/migrate =====
function migrateSoftGate(gate) {
  try {
    if (!gate || typeof gate !== "object") return gate;
    if (!gate.soft || typeof gate.soft !== "object") gate.soft = {};
    if (!gate.soft.items || typeof gate.soft.items !== "object") gate.soft.items = {};

    // legacy deadline support
    if (!gate.soft.deadline_at && gate.deadline_at) gate.soft.deadline_at = gate.deadline_at;

    const allowed = new Set(getSoftKoIds());
    for (const id of Object.keys(gate.soft.items)) {
      if (!allowed.has(id)) delete gate.soft.items[id];
    }
    for (const id of allowed) {
      if (!gate.soft.items[id]) gate.soft.items[id] = { passed: false, note: "", fixed_at: null, regressed_at: null };
      gate.soft.items[id].note ??= "";
      gate.soft.items[id].fixed_at ??= null;
      gate.soft.items[id].regressed_at ??= null;
      gate.soft.items[id].passed = !!gate.soft.items[id].passed;
    }

    gate.deadline_at = gate.soft.deadline_at;
  } catch (e) {
    console.warn("[SoftKO] migrateSoftGate error:", e);
  }
  return gate;
}

function initSoftGateIfMissing() {
  if (!requireHardGateOrRedirect()) return null;

  const existing = localStorage.getItem(SOFT_GATE_KEY);
  if (existing) {
    const parsed = safeParse(existing);
    if (parsed) {
      const migrated = migrateSoftGate(parsed);
      localStorage.setItem(SOFT_GATE_KEY, JSON.stringify(migrated));
      return migrated;
    }
  }

  // Use verifiedAt from Hard KO if available
  const hardRaw = sessionStorage.getItem(HARD_KO_KEY);
  const hard = hardRaw ? safeParse(hardRaw) : null;

  const verifiedAtIso = hard?.verifiedAt || new Date().toISOString();
  const verifiedAt = new Date(verifiedAtIso);
  const deadlineAt = new Date(verifiedAt.getTime() + 7 * 24 * 60 * 60 * 1000);

  const items = {};
  for (const ruleId of getSoftKoIds()) {
    items[ruleId] = { passed: false, note: "", fixed_at: null, regressed_at: null };
  }

  const G = getGateStatusEnum();
  const gate = {
    verified_at: verifiedAt.toISOString(),
    gate_status: G.SOFT_PENDING, // G1
    soft: {
      deadline_at: deadlineAt.toISOString(),
      items,
    },
  };

  gate.deadline_at = gate.soft.deadline_at; // legacy compat

  localStorage.setItem(SOFT_GATE_KEY, JSON.stringify(gate));
  return gate;
}

function saveGate(gate) {
  localStorage.setItem(SOFT_GATE_KEY, JSON.stringify(gate));
}

function evaluateSoftGateStatus(gate) {
  const G = getGateStatusEnum();
  const items = gate?.soft?.items || {};
  const allPassed = Object.values(items).every((x) => x?.passed === true);
  if (allPassed) return G.PASS;

  const deadlineIso = gate?.soft?.deadline_at || gate?.deadline_at;
  if (!deadlineIso) return G.SOFT_PENDING;

  const now = new Date();
  const deadline = new Date(deadlineIso);
  if (Number.isNaN(deadline.getTime())) return G.SOFT_PENDING;

  return now <= deadline ? G.SOFT_PENDING : G.SOFT_OVERDUE;
}

// ===== Lock logic (THE FIX) =====
function reconcileLockWithGate() {
  const gate = initSoftGateIfMissing();
  const G = getGateStatusEnum();

  const lockedKey = localStorage.getItem(SOFT_GATE_LOCK_KEY) === "1";
  const gatePass = gate?.gate_status === G.PASS;

  // If lockKey exists but gate NOT PASS -> remove to allow editing
  if (lockedKey && !gatePass) {
    localStorage.removeItem(SOFT_GATE_LOCK_KEY);
  }

  // If PASS -> ensure lock key
  if (gatePass) {
    localStorage.setItem(SOFT_GATE_LOCK_KEY, "1");
  }

  return localStorage.getItem(SOFT_GATE_LOCK_KEY) === "1";
}

function isLockedNow() {
  reconcileLockWithGate();
  return localStorage.getItem(SOFT_GATE_LOCK_KEY) === "1";
}

// ===== UI helpers =====
function disableAllInputs() {
  Object.keys(inputs).forEach((k) => {
    const el = document.getElementById(inputs[k].id);
    if (el) el.disabled = true;
  });
}
function enableAllInputs() {
  if (isLockedNow()) return;
  Object.keys(inputs).forEach((k) => {
    const el = document.getElementById(inputs[k].id);
    if (el) el.disabled = false;
  });
}

function updateInputUI(localKey, passed, message) {
  const cfg = inputs[localKey];
  if (!cfg) return;

  const badgeEl = document.getElementById(`badge-${localKey}`);
  const hintEl = document.getElementById(`hint-${localKey}`);
  if (!badgeEl || !hintEl) return;

  if (passed === null) {
    hintEl.textContent = "Chưa nhập dữ liệu";
    badgeEl.classList.remove("pass", "fail");
    return;
  }

  if (passed) {
    hintEl.textContent = message || cfg.passText;
    badgeEl.classList.remove("fail");
    badgeEl.classList.add("pass");
  } else {
    hintEl.textContent = message || cfg.failText;
    badgeEl.classList.remove("pass");
    badgeEl.classList.add("fail");
  }
}

function updateChecklist(localKey, filledOrPassed) {
  const row = document.getElementById(`check-${localKey}`);
  if (!row) return;
  row.classList.toggle("completed", !!filledOrPassed);
  const icon = row.querySelector(".check-icon");
  if (icon) icon.textContent = filledOrPassed ? "✓" : "○";
}

function ensureNextBtnHasText(btn, text) {
  if (!btn) return;
  let span = btn.querySelector("span");
  if (!span) {
    span = document.createElement("span");
    btn.appendChild(span);
  }
  span.textContent = text;
}

// ===== Validation =====
function sanitizeByType(cfg, rawString) {
  if (rawString === "" || rawString === null || rawString === undefined) {
    return { hasValue: false, value: NaN };
  }
  let v = Number(rawString);
  if (Number.isNaN(v)) return { hasValue: false, value: NaN };

  if (cfg.type === "percentage") v = clamp(v, 0, 100);
  if (cfg.type === "number" && v < 0) v = 0;

  return { hasValue: true, value: v };
}

function computePassed(cfg, value) {
  if (cfg.direction === "min") return value >= cfg.threshold;
  if (cfg.direction === "max") return value <= cfg.threshold;
  return false;
}

function validateInput(localKey) {
  const cfg = inputs[localKey];
  if (!cfg) return false;

  const inputEl = document.getElementById(cfg.id);
  if (!inputEl) return false;

  // If locked, render from gate snapshot
  if (isLockedNow()) {
    inputEl.disabled = true;

    const gate = initSoftGateIfMissing();
    const item = gate?.soft?.items?.[cfg.ruleId];
    const passed = item?.passed === true;

    updateChecklist(localKey, passed);
    updateInputUI(localKey, passed, passed ? cfg.passText : cfg.failText);
    return passed;
  }

  inputEl.disabled = false;

  const raw = String(inputEl.value || "").trim();
  const sanitized = sanitizeByType(cfg, raw);

  // Empty/invalid -> UI only, DO NOT write gate
  if (!sanitized.hasValue) {
    updateChecklist(localKey, false);
    updateInputUI(localKey, null, null);
    return false;
  }

  // sync clamped value back to input
  if (String(raw) !== String(sanitized.value)) {
    inputEl.value = String(sanitized.value);
  }

  const passed = computePassed(cfg, sanitized.value);
  updateChecklist(localKey, passed);
  updateInputUI(localKey, passed, passed ? cfg.passText : cfg.failText);

  // Write gate
  const gate = initSoftGateIfMissing();
  if (!gate) return passed;

  gate.soft = gate.soft || { items: {} };
  gate.soft.items = gate.soft.items || {};

  if (!gate.soft.items[cfg.ruleId]) {
    gate.soft.items[cfg.ruleId] = { passed: false, note: "", fixed_at: null, regressed_at: null };
  }

  const item = gate.soft.items[cfg.ruleId];
  const prevPassed = item.passed === true;

  item.passed = passed;
  item.note = passed ? "" : (cfg.failText || "Chưa đạt");

  if (passed) {
    item.fixed_at = item.fixed_at || new Date().toISOString();
    item.regressed_at = null;
  } else if (prevPassed && item.fixed_at) {
    item.regressed_at = new Date().toISOString();
  }

  gate.soft.items[cfg.ruleId] = item;
  gate.gate_status = evaluateSoftGateStatus(gate);

  saveGate(gate);
  reconcileLockWithGate(); // if becomes PASS, auto lock
  return passed;
}

// ===== Progress + button =====
function updateProgress() {
  const gate = initSoftGateIfMissing();
  if (!gate) return;

  reconcileLockWithGate();

  const keys = Object.keys(inputs);
  let filledCount = 0;

  keys.forEach((k) => {
    const el = document.getElementById(inputs[k].id);
    const filled = !!el && String(el.value || "").trim() !== "";
    if (filled) filledCount += 1;
  });

  // progress text
  const progressText = document.getElementById("progress-text");
  if (progressText) progressText.textContent = `Đã nhập: ${filledCount}/${keys.length} chỉ số`;

  // next button: enable when all 4 filled (then click to evaluate PASS/FAIL)
  const nextBtn = document.getElementById("nextBtn");
  if (nextBtn) {
    const allFilled = keys.length > 0 && filledCount === keys.length;
    nextBtn.disabled = !allFilled;
    nextBtn.classList.toggle("disabled", !allFilled);

    // show text (HTML button currently only has SVG)
    ensureNextBtnHasText(nextBtn, "Xem kết quả");
  }

  // lock/unlock inputs
  if (isLockedNow()) disableAllInputs();
  else enableAllInputs();
}

// ===== Modals =====
window.__softko_closeModal = function () {
  const modal = document.getElementById("rejectionModal") || document.getElementById("successModal");
  if (modal) modal.remove();
};

function showRejectionModalDetailed(failedDetails, gate) {
  const today = new Date();
  let nextDate = new Date(today);

  try {
    const deadline = gate?.soft?.deadline_at || gate?.deadline_at;
    if (deadline) {
      const d = new Date(deadline);
      if (!Number.isNaN(d.getTime())) nextDate = d;
      else nextDate.setDate(today.getDate() + 7);
    } else {
      nextDate.setDate(today.getDate() + 7);
    }
  } catch {
    nextDate.setDate(today.getDate() + 7);
  }

  const listHTML = (failedDetails || [])
    .map(
      (x) => `
      <div style="margin-bottom:10px;">
        <div style="font-weight:800;color:#991B1B;">• ${x.name}</div>
        <div style="color:#7F1D1D;font-weight:600;">Lý do: ${x.reason}</div>
        ${x.recommendation ? `<div style="color:#374151;margin-top:6px;"><b>Gợi ý:</b><br>${x.recommendation}</div>` : ""}
      </div>
    `
    )
    .join("");

  const modalHTML = `
    <div id="rejectionModal" style="
      position: fixed; inset: 0; background: rgba(0,0,0,.6);
      display:flex; align-items:center; justify-content:center; z-index:9999;">
      <div style="background:#fff; border-radius:16px; padding:28px; max-width:560px; width:92%;
        box-shadow:0 20px 60px rgba(0,0,0,.3);">
        <div style="text-align:center; margin-bottom:16px;">
          <div style="font-size:22px; font-weight:900; color:#DC2626; margin-bottom:6px;">Không đạt</div>
          <div style="color:#6B7280; font-weight:700;">Bạn chưa đạt điều kiện Soft KO để qua gate.</div>
        </div>

        <div style="background:#F9FAFB;border-radius:12px;padding:16px;margin-bottom:16px;">
          <div style="display:flex; gap:16px; flex-wrap:wrap; margin-bottom:12px;">
            <div style="flex:1; min-width:200px;">
              <div style="font-size:12px;color:#6B7280;font-weight:800;">📅 Ngày kiểm tra</div>
              <div style="font-size:14px;font-weight:900;">${formatDate(today)}</div>
            </div>
            <div style="flex:1; min-width:200px;">
              <div style="font-size:12px;color:#6B7280;font-weight:800;">🔄 Ngày xét điểm tiếp theo</div>
              <div style="font-size:14px;font-weight:900;color:#EE4D2D;">${formatDate(nextDate)}</div>
            </div>
          </div>

          <div>
            <div style="font-size:12px;color:#6B7280;font-weight:800;margin-bottom:8px;">❌ Không đạt / Lý do</div>
            <div style="background:#FEE2E2;border-left:4px solid #DC2626;padding:12px;border-radius:10px;">
              ${listHTML || "<div style='font-weight:800;color:#991B1B;'>Bạn chưa đạt một hoặc nhiều tiêu chí.</div>"}
            </div>
          </div>
        </div>

        <div style="display:flex; gap:12px;">
          <button onclick="window.__softko_closeModal()" style="
            flex:1; padding:12px 16px; border-radius:10px; border:none;
            background:#6B7280; color:#fff; font-weight:900; cursor:pointer;">
            Đóng
          </button>
          <button onclick="window.__softko_closeModal(); window.history.back();" style="
            flex:1; padding:12px 16px; border-radius:10px; border:none;
            background:#EE4D2D; color:#fff; font-weight:900; cursor:pointer;">
            Quay lại sửa
          </button>
        </div>
      </div>
    </div>
  `;

  const old = document.getElementById("rejectionModal");
  if (old) old.remove();
  document.body.insertAdjacentHTML("beforeend", modalHTML);
}

let __softRedirectTimer = null;
function showSuccessModalAndRedirect(url, seconds) {
  const old = document.getElementById("successModal");
  if (old) old.remove();

  if (__softRedirectTimer) {
    clearInterval(__softRedirectTimer);
    __softRedirectTimer = null;
  }

  const modalHTML = `
    <div id="successModal" style="
      position: fixed; inset: 0; background: rgba(0,0,0,.6);
      display:flex; align-items:center; justify-content:center; z-index:9999;">
      <div style="background:#fff; border-radius:16px; padding:28px; max-width:520px; width:92%;
        box-shadow:0 20px 60px rgba(0,0,0,.3); text-align:center;">
        <div style="font-size:22px; font-weight:900; color:#10B981; margin-bottom:8px;">Hồ sơ hợp lệ</div>
        <div style="color:#6B7280; font-weight:700; margin-bottom:14px;">
          Bạn đã đạt toàn bộ Soft KO. Hệ thống sẽ chuyển sang bước chấm điểm KPI.
        </div>
        <div style="font-weight:900; color:#111827;">
          Chuyển trang sau <span id="countdown">${seconds}</span>s...
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", modalHTML);

  let t = seconds;
  __softRedirectTimer = setInterval(() => {
    t -= 1;
    const el = document.getElementById("countdown");
    if (el) el.textContent = String(Math.max(t, 0));
    if (t <= 0) {
      clearInterval(__softRedirectTimer);
      __softRedirectTimer = null;
      window.location.href = url;
    }
  }, 1000);
}

// ===== Actions =====
function getSoftRecommendation(localKey) {
  const cfg = inputs[localKey];
  if (!cfg) return "";
  const sign = cfg.direction === "min" ? "≥" : "≤";
  return `Cần đạt: ${sign} ${cfg.threshold}${cfg.unit}`;
}

function goNext() {
  // validate all (sync UI + gate)
  Object.keys(inputs).forEach((k) => validateInput(k));
  updateProgress();

  const gate = initSoftGateIfMissing();
  const G = getGateStatusEnum();

  if (!gate || gate.gate_status !== G.PASS) {
    const failedDetails = [];

    Object.keys(inputs).forEach((k) => {
      const cfg = inputs[k];
      const el = document.getElementById(cfg.id);
      const empty = !el || String(el.value || "").trim() === "";

      if (empty) {
        failedDetails.push({
          key: k,
          name: cfg.name,
          reason: "Chưa nhập dữ liệu",
          recommendation: getSoftRecommendation(k),
        });
      } else {
        const item = gate?.soft?.items?.[cfg.ruleId];
        const ok = item?.passed === true;
        if (!ok) {
          failedDetails.push({
            key: k,
            name: cfg.name,
            reason: cfg.failText || "Chưa đạt",
            recommendation: getSoftRecommendation(k),
          });
        }
      }
    });

    showRejectionModalDetailed(failedDetails, gate);
    return;
  }

  // PASS -> lock & redirect
  localStorage.setItem(SOFT_GATE_LOCK_KEY, "1");
  disableAllInputs();
  updateProgress();

  // snapshot
  const data = {};
  Object.keys(inputs).forEach((k) => {
    const el = document.getElementById(inputs[k].id);
    data[k] = el ? el.value : "";
  });
  sessionStorage.setItem("softKoData", JSON.stringify(data));
  window.softKoData = data;

  const nextBtn = document.getElementById("nextBtn");
  if (nextBtn) nextBtn.disabled = true;

  showSuccessModalAndRedirect("./KPI_SCORING.html", 10);
}

// HTML inline onclick uses goBack()
function goBack() {
  // allow re-edit when going back
  localStorage.removeItem(SOFT_GATE_LOCK_KEY);
  window.location.href = "KO_GATE.html";
}

// ===== Restore (optional) =====
function restoreSoftKOFromSession() {
  const raw = sessionStorage.getItem("softKoData");
  const data = raw ? safeParse(raw) : null;
  if (!data) return;

  Object.keys(inputs).forEach((k) => {
    const el = document.getElementById(inputs[k].id);
    if (!el) return;
    if (data[k] !== undefined && data[k] !== null) el.value = String(data[k]);
  });
}

// ===== Boot =====
function bootSoftKO() {
  if (!requireHardGateOrRedirect()) return;

  inputs = buildInputs();
  initSoftGateIfMissing();

  // reconcile lock before enabling/disabling
  reconcileLockWithGate();

  if (isLockedNow()) disableAllInputs();
  else enableAllInputs();

  // bind inputs
  Object.keys(inputs).forEach((k) => {
    const el = document.getElementById(inputs[k].id);
    if (!el) return;

    const handler = () => {
      if (isLockedNow()) return;
      validateInput(k);
      updateProgress();
    };

    el.addEventListener("input", handler);
    el.addEventListener("blur", handler);

    // initial paint
    if (String(el.value || "").trim() !== "") validateInput(k);
    else updateInputUI(k, null, null);
  });

  // bind button
  const nextBtn = document.getElementById("nextBtn");
  if (nextBtn) {
    nextBtn.addEventListener("click", (e) => {
      e.preventDefault();
      goNext();
    });
  }

  restoreSoftKOFromSession();
  updateProgress();
}

// run even if DOMContentLoaded already fired
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootSoftKO);
} else {
  bootSoftKO();
}

// export thresholds (used elsewhere if needed)
window.MRSM_GATE_THRESHOLDS = (function () {
  const out = {};
  for (const ruleId of getSoftKoIds()) {
    const spec = getRuleSpec(ruleId);
    if (!spec) continue;

    out[ruleId] = {
      type: spec.type,
      direction: spec.direction,
      threshold: spec.threshold,
      unit: spec.unit || "",
      label: getLabel(ruleId),
    };
  }
  return out;
})();
