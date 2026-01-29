/**
 * ============================================================
 * SOFT_KO_SCRIPT.JS (HARDENED + MATCH SOFT_KO.html + MRSM_CONFIG)
 * ============================================================
 * - SSOT source: window.MRSM_CONFIG
 *   + SOFT_KO_IDS
 *   + getKpiMeta(id) for labels
 *   + GATE_STATUS enum
 *   + SOFT_GATE_KEY / HARD_GATE_KEY (if needed)
 * - Thresholds/type/direction for Soft KO:
 *   -> thesis defaults (because mrsm_config.js currently has no GateRegistry thresholds)
 *
 * UI contract (SOFT_KO.html):
 *   input ids:   op04, pen01, co01, sc02
 *   badge ids:   badge-op04, badge-pen01, ...
 *   hint ids:    hint-op04, hint-pen01, ...
 *   checklist:   check-op04, check-pen01, ...
 *   progress:    progress-text
 *   next button: nextBtn
 * ============================================================
 */

// ---------- Constants ----------
const LOCK_KEY = "soft_ko_gate_locked";

// Prefer SSOT key from MRSM_CONFIG; fallback to legacy literal.
function softGateKey() {
  return window.MRSM_CONFIG?.SOFT_GATE_KEY || "soft_ko_gate";
}

// ---------- Thesis defaults (because mrsm_config.js has no thresholds SSOT yet) ----------
const SOFT_KO_DEFAULTS = {
  "OP-04": { type: "percentage", direction: "min", threshold: 85, unit: "%", remediation_days: 7 },
  "PEN-01": { type: "number", direction: "max", threshold: 2, unit: " Sao", remediation_days: 7 },
  "CO-01": { type: "percentage", direction: "max", threshold: 10, unit: "%", remediation_days: 7 },
  "SC-02": { type: "number", direction: "min", threshold: 150, unit: " đơn", remediation_days: 7 },
};

// ---------- Helpers ----------
function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function formatDate(date) {
  if (!date) return "—";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return String(date);
  return d.toLocaleDateString("vi-VN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function toLocalKey(ruleId) {
  // OP-04 -> op04 ; PEN-01 -> pen01
  return String(ruleId || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function getGateStatusEnum() {
  return (
    window.MRSM_CONFIG?.GATE_STATUS || {
      PASS: "PASS",
      HARD_FAIL: "G0",
      SOFT_PENDING: "G1",
      SOFT_OVERDUE: "G2",
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
  // if later you add SSOT thresholds somewhere, plug it here
  return SOFT_KO_DEFAULTS[ruleId] || null;
}

// ---------- Guards ----------
function requireHardGateOrRedirect() {
  // Prefer GateGuard if available
  if (window.GateGuard && typeof window.GateGuard.requireHardGateOrRedirect === "function") {
    return window.GateGuard.requireHardGateOrRedirect({ redirectOnMissing: true });
  }

  // Fallback: MRSM_CONFIG legacy helper
  if (window.MRSM_CONFIG?.requireHardGateOrRedirect) {
    return window.MRSM_CONFIG.requireHardGateOrRedirect();
  }

  // Ultimate fallback: sessionStorage evidence
  const hardRaw = sessionStorage.getItem(window.MRSM_CONFIG?.HARD_GATE_KEY || "validatedHardKO");
  if (!hardRaw) {
    window.location.href = "KO_GATE.html";
    return false;
  }
  return true;
}

// ---------- Inputs (built after DOM exists) ----------
let inputs = {};

/**
 * Build inputs from SSOT IDs + thesis defaults, but ONLY if HTML input exists.
 */
function buildInputs() {
  const ids = getSoftKoIds();
  const out = {};

  for (const ruleId of ids) {
    const spec = getRuleSpec(ruleId);
    if (!spec) continue;

    const localKey = toLocalKey(ruleId);
    const inputEl = document.getElementById(localKey);
    if (!inputEl) continue; // fail-safe: do not include non-existing UI controls

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
      remediation_days: spec.remediation_days ?? 7,
      passText: `Đạt chuẩn (${sign} ${spec.threshold}${unit})`,
      failText: `Cần cải thiện (${sign} ${spec.threshold}${unit})`,
    };
  }

  return out;
}

// ---------- Gate init + migration ----------
function migrateSoftGate(gate) {
  try {
    if (!gate || typeof gate !== "object") return gate;

    if (!gate.soft || typeof gate.soft !== "object") gate.soft = {};
    if (!gate.soft.items || typeof gate.soft.items !== "object") gate.soft.items = {};

    // migrate legacy deadline
    if (!gate.soft.deadline_at && gate.deadline_at) gate.soft.deadline_at = gate.deadline_at;

    const allowed = new Set(getSoftKoIds());

    // remove unknown items
    for (const id of Object.keys(gate.soft.items)) {
      if (!allowed.has(id)) delete gate.soft.items[id];
    }

    // ensure all exist
    for (const id of allowed) {
      if (!gate.soft.items[id]) gate.soft.items[id] = { passed: false, note: "", fixed_at: null, regressed_at: null };
      gate.soft.items[id].note ??= "";
      gate.soft.items[id].fixed_at ??= null;
      gate.soft.items[id].regressed_at ??= null;
      gate.soft.items[id].passed = !!gate.soft.items[id].passed;
    }

    // backward compat
    gate.deadline_at = gate.soft.deadline_at;
  } catch (e) {
    console.warn("[SoftKO] migrateSoftGate error:", e);
  }
  return gate;
}

function initSoftGateIfMissing() {
  if (!requireHardGateOrRedirect()) return null;

  const key = softGateKey();
  const raw = localStorage.getItem(key);
  if (raw) {
    const parsed = safeParse(raw);
    if (parsed) {
      const migrated = migrateSoftGate(parsed);
      localStorage.setItem(key, JSON.stringify(migrated));
      return migrated;
    }
  }

  const G = getGateStatusEnum();
  const now = new Date();

  // remediation days: take OP-04 default (or 7)
  const remDays = getRuleSpec("OP-04")?.remediation_days ?? 7;
  const deadline = new Date(now);
  deadline.setDate(now.getDate() + remDays);

  const items = {};
  for (const id of getSoftKoIds()) {
    items[id] = { passed: false, note: "", fixed_at: null, regressed_at: null };
  }

  const gate = {
    verified_at: now.toISOString(),
    gate_status: G.SOFT_PENDING, // "G1"
    soft: {
      deadline_at: deadline.toISOString(),
      items,
    },
  };

  gate.deadline_at = gate.soft.deadline_at; // backward compat

  localStorage.setItem(key, JSON.stringify(gate));
  return gate;
}

function saveGate(gate) {
  localStorage.setItem(softGateKey(), JSON.stringify(gate));
}

// ---------- UI updates (MATCH SOFT_KO.html) ----------
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

function updateChecklist(localKey, filled) {
  const row = document.getElementById(`check-${localKey}`);
  if (!row) return;

  row.classList.toggle("completed", !!filled);
  const icon = row.querySelector(".check-icon");
  if (icon) icon.textContent = filled ? "✓" : "○";
}

function disableAllInputs() {
  Object.keys(inputs).forEach((k) => {
    const el = document.getElementById(inputs[k].id);
    if (el) el.disabled = true;
  });
}

function enableAllInputs() {
  Object.keys(inputs).forEach((k) => {
    const el = document.getElementById(inputs[k].id);
    if (el) el.disabled = false;
  });
}

function updateProgress() {
  const keys = Object.keys(inputs);
  let count = 0;

  keys.forEach((k) => {
    const el = document.getElementById(inputs[k].id);
    const filled = !!el && String(el.value || "").trim() !== "";
    if (filled) count++;
    updateChecklist(k, filled);
  });

  const progressText = document.getElementById("progress-text");
  if (progressText) progressText.textContent = `Đã nhập: ${count}/${keys.length} chỉ số`;

  const nextBtn = document.getElementById("nextBtn");
  if (nextBtn) {
    const ready = keys.length > 0 && count === keys.length;
    nextBtn.disabled = !ready;
    nextBtn.classList.toggle("disabled", !ready);
    nextBtn.textContent = "Xem kết quả";
  }
}

// ---------- Validation + gate update ----------
function computePassed(cfg, value) {
  if (cfg.direction === "min") return value >= cfg.threshold;
  if (cfg.direction === "max") return value <= cfg.threshold;
  return false; // fail-closed
}

function validateInput(localKey) {
  const cfg = inputs[localKey];
  if (!cfg) return false;

  const el = document.getElementById(cfg.id);
  if (!el) return false;

  const raw = String(el.value || "").trim();

  // IMPORTANT: empty -> do NOT update gate (to avoid false overwrite)
  if (raw === "") {
    updateInputUI(localKey, null, null);
    return false;
  }

  let value = Number(raw);
  if (Number.isNaN(value)) {
    updateInputUI(localKey, false, "Giá trị không hợp lệ");
    return false;
  }

  // clamp by type
  if (cfg.type === "percentage") {
    value = clamp(value, 0, 100);
    el.value = String(value);
  } else if (cfg.type === "number") {
    if (value < 0) value = 0;
    el.value = String(value);
  }

  const passed = computePassed(cfg, value);
  updateInputUI(localKey, passed, passed ? cfg.passText : cfg.failText);

  const gate = initSoftGateIfMissing();
  if (!gate) return passed;

  // ensure structure
  gate.soft = gate.soft || { items: {} };
  gate.soft.items = gate.soft.items || {};
  const ruleId = cfg.ruleId;

  if (!gate.soft.items[ruleId]) {
    gate.soft.items[ruleId] = { passed: false, note: "", fixed_at: null, regressed_at: null };
  }

  const item = gate.soft.items[ruleId];

  // pass/regress tracking
  if (passed && !item.passed) {
    item.fixed_at = item.fixed_at || new Date().toISOString();
    item.regressed_at = null;
  } else if (!passed && item.passed) {
    item.regressed_at = new Date().toISOString();
  }

  item.passed = passed;

  // gate_status
  const G = getGateStatusEnum();
  const ids = getSoftKoIds();
  const allPass = ids.every((id) => gate.soft.items[id]?.passed === true);

  if (allPass) {
    gate.gate_status = G.PASS;
  } else {
    const now = new Date();
    const dlStr = gate?.soft?.deadline_at || gate?.deadline_at;
    const dl = dlStr ? new Date(dlStr) : null;

    if (!dl || Number.isNaN(dl.getTime())) gate.gate_status = G.SOFT_OVERDUE; // fail-closed
    else gate.gate_status = now <= dl ? G.SOFT_PENDING : G.SOFT_OVERDUE;
  }

  saveGate(gate);
  return passed;
}

// ---------- Recommendations + Modals ----------
function getSoftRecommendation(localKey) {
  const cfg = inputs[localKey];
  if (!cfg) return "";
  const sign = cfg.direction === "min" ? "≥" : "≤";
  return `Cần đạt: ${sign} ${cfg.threshold}${cfg.unit}`;
}

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
        ${
          x.recommendation
            ? `<div style="color:#374151;margin-top:6px;"><b>Gợi ý:</b><br>${x.recommendation}</div>`
            : ""
        }
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

function showSuccessModalAndRedirect(url, seconds) {
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

  const old = document.getElementById("successModal");
  if (old) old.remove();
  document.body.insertAdjacentHTML("beforeend", modalHTML);

  let t = seconds;
  const timer = setInterval(() => {
    t -= 1;
    const el = document.getElementById("countdown");
    if (el) el.textContent = String(t);
    if (t <= 0) {
      clearInterval(timer);
      window.location.href = url;
    }
  }, 1000);
}

window.__softko_closeModal = function () {
  const modal = document.getElementById("rejectionModal") || document.getElementById("successModal");
  if (modal) modal.remove();
};

// ---------- Main action ----------
function goNext() {
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
  localStorage.setItem(LOCK_KEY, "1");
  disableAllInputs();
  updateProgress();

  // optional snapshot
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

// ---------- Boot (robust) ----------
function bootSoftKO() {
  if (!requireHardGateOrRedirect()) return;

  // Build config after DOM exists
  inputs = buildInputs();

  // Init gate
  initSoftGateIfMissing();

  // Lock behavior
  const locked = localStorage.getItem(LOCK_KEY) === "1";
  if (locked) disableAllInputs();
  else enableAllInputs();

  // Bind inputs
  Object.keys(inputs).forEach((k) => {
    const el = document.getElementById(inputs[k].id);
    if (!el) return;

    const onChange = () => {
      if (locked) return;
      validateInput(k);
      updateProgress();
    };

    el.addEventListener("input", onChange);
    el.addEventListener("blur", onChange);

    // initial sync
    if (String(el.value || "").trim() !== "") validateInput(k);
    else updateInputUI(k, null, null);
  });

  // Bind button
  const nextBtn = document.getElementById("nextBtn");
  if (nextBtn) nextBtn.addEventListener("click", goNext);

  updateProgress();
}

// Run even if DOMContentLoaded already fired
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootSoftKO);
} else {
  bootSoftKO();
}

// ---------- Export thresholds for other pages ----------
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
