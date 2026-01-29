/**
 * ============================================================
 * SOFT_KO_SCRIPT.JS (UPGRADED MODAL + RECOMMENDATIONS + STAY ON SOFT_KO)
 * ============================================================
 * Changes:
 * 1) Rejection modal redesigned: prominent cards + current value + requirement + status
 * 2) Integrate recommendation.js (window.RECOMMENDATIONS) for actions
 * 3) "Quay lại sửa" stays on SOFT_KO: closes modal + scroll/focus first failed item
 * 4) Keeps lock dynamic fix (no stuck disabled)
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
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getGateStatusEnum() {
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
  return SOFT_KO_DEFAULTS[ruleId] || null;
}

function localKeyToRuleId(localKey) {
  return RULE_MAP[localKey];
}

function getRequirementText(cfg) {
  const sign = cfg.direction === "min" ? "≥" : "≤";
  return `${sign} ${cfg.threshold}${cfg.unit || ""}`;
}

function getInputValue(localKey) {
  const cfg = inputs[localKey];
  if (!cfg) return "";
  const el = document.getElementById(cfg.id);
  return el ? String(el.value ?? "").trim() : "";
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

    const localKey = Object.keys(RULE_MAP).find((k) => RULE_MAP[k] === ruleId);
    if (!localKey) continue;

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
    gate_status: G.SOFT_PENDING,
    soft: {
      deadline_at: deadlineAt.toISOString(),
      items,
    },
  };

  gate.deadline_at = gate.soft.deadline_at;
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

// ===== Lock logic (dynamic) =====
function reconcileLockWithGate() {
  const gate = initSoftGateIfMissing();
  const G = getGateStatusEnum();

  const lockedKey = localStorage.getItem(SOFT_GATE_LOCK_KEY) === "1";
  const gatePass = gate?.gate_status === G.PASS;

  if (lockedKey && !gatePass) {
    localStorage.removeItem(SOFT_GATE_LOCK_KEY);
  }
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

function updateChecklist(localKey, passedOrFilled) {
  const row = document.getElementById(`check-${localKey}`);
  if (!row) return;
  row.classList.toggle("completed", !!passedOrFilled);
  const icon = row.querySelector(".check-icon");
  if (icon) icon.textContent = passedOrFilled ? "✓" : "○";
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

function scrollToAndFocus(localKey) {
  const cfg = inputs[localKey];
  if (!cfg) return;

  const inputEl = document.getElementById(cfg.id);
  if (!inputEl) return;

  // scroll to metric card (input -> metric-card)
  const card = inputEl.closest(".metric-card") || inputEl;
  card.scrollIntoView({ behavior: "smooth", block: "center" });

  // focus after scroll a bit
  setTimeout(() => {
    try { inputEl.focus({ preventScroll: true }); } catch { inputEl.focus(); }
    // quick highlight animation
    card.classList.add("__softko_pulse");
    setTimeout(() => card.classList.remove("__softko_pulse"), 900);
  }, 300);
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

  // sync clamped
  if (String(raw) !== String(sanitized.value)) inputEl.value = String(sanitized.value);

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
  reconcileLockWithGate();
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

  const progressText = document.getElementById("progress-text");
  if (progressText) progressText.textContent = `Đã nhập: ${filledCount}/${keys.length} chỉ số`;

  const nextBtn = document.getElementById("nextBtn");
  if (nextBtn) {
    const allFilled = keys.length > 0 && filledCount === keys.length;
    nextBtn.disabled = !allFilled;
    nextBtn.classList.toggle("disabled", !allFilled);
    ensureNextBtnHasText(nextBtn, "Xem kết quả");
  }

  if (isLockedNow()) disableAllInputs();
  else enableAllInputs();
}

// ===== Recommendation integration (recommendation.js) =====
function getRecommendationActions(ruleId) {
  // Support multiple shapes (fail-safe):
  // - window.RECOMMENDATIONS[ruleId] = { actions: [...] } OR [...]
  // - window.RECOMMENDATIONS is array of { id/kpiId/ruleId, actions }
  // Each action may be string OR { title, desc, steps, links }
  const rec = window.RECOMMENDATIONS;
  if (!rec) return [];

  try {
    // object map
    if (typeof rec === "object" && !Array.isArray(rec)) {
      const x = rec[ruleId];
      if (!x) return [];
      if (Array.isArray(x)) return x;
      if (Array.isArray(x.actions)) return x.actions;
      if (Array.isArray(x.recommendations)) return x.recommendations;
      return [];
    }

    // array
    if (Array.isArray(rec)) {
      const found = rec.find((r) => (r?.kpiId || r?.id || r?.ruleId) === ruleId);
      if (!found) return [];
      if (Array.isArray(found.actions)) return found.actions;
      if (Array.isArray(found.recommendations)) return found.recommendations;
      return [];
    }
  } catch (e) {
    console.warn("[SoftKO] getRecommendationActions error:", e);
  }

  return [];
}

function renderActionsHtml(actions) {
  if (!actions || !actions.length) return "";

  const rows = actions.slice(0, 6).map((a) => {
    if (typeof a === "string") {
      return `<li class="sk-item">${escapeHtml(a)}</li>`;
    }
    const title = escapeHtml(a.title || a.name || "Hành động");
    const desc = escapeHtml(a.desc || a.description || "");
    const steps = Array.isArray(a.steps) ? a.steps.slice(0, 4).map(s => `<li>${escapeHtml(s)}</li>`).join("") : "";
    return `
      <li class="sk-item">
        <div class="sk-act-title">${title}</div>
        ${desc ? `<div class="sk-act-desc">${desc}</div>` : ""}
        ${steps ? `<ul class="sk-steps">${steps}</ul>` : ""}
      </li>
    `;
  }).join("");

  return `<ul class="sk-actions">${rows}</ul>`;
}

// ===== Modals =====
window.__softko_closeModal = function () {
  const modal = document.getElementById("rejectionModal") || document.getElementById("successModal");
  if (modal) modal.remove();
};

window.__softko_backToEdit = function (firstFailKey) {
  window.__softko_closeModal();
  if (firstFailKey) scrollToAndFocus(firstFailKey);
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

  // Decide first fail key to focus
  const firstFailKey = failedDetails?.[0]?.key || null;

  // Build cards
  const cardsHtml = (failedDetails || []).map((x) => {
    const cfg = inputs[x.key];
    const val = getInputValue(x.key);
    const req = cfg ? getRequirementText(cfg) : "";
    const ruleId = cfg?.ruleId || localKeyToRuleId(x.key) || "";
    const actions = getRecommendationActions(ruleId);
    const actionsHtml = renderActionsHtml(actions);

    const hasActions = !!actionsHtml;
    const actionToggleId = `sk_toggle_${x.key}`;
    const actionBoxId = `sk_actions_${x.key}`;

    return `
      <div class="sk-card" data-key="${escapeHtml(x.key)}">
        <div class="sk-card-top">
          <div class="sk-badge">❌ FAIL</div>
          <div class="sk-title">
            <div class="sk-kpi">${escapeHtml(ruleId)}</div>
            <div class="sk-name">${escapeHtml(x.name || "")}</div>
          </div>
        </div>

        <div class="sk-grid">
          <div class="sk-metric">
            <div class="sk-label">Giá trị hiện tại</div>
            <div class="sk-value">${escapeHtml(val || "—")}</div>
          </div>
          <div class="sk-metric">
            <div class="sk-label">Yêu cầu</div>
            <div class="sk-value sk-req">${escapeHtml(req || "—")}</div>
          </div>
          <div class="sk-metric">
            <div class="sk-label">Lý do</div>
            <div class="sk-value sk-reason">${escapeHtml(x.reason || "Chưa đạt")}</div>
          </div>
        </div>

        <div class="sk-cta">
          <button class="sk-btn sk-btn-outline" onclick="window.__softko_backToEdit('${escapeHtml(x.key)}')">
            Sửa tiêu chí này
          </button>

          ${
            hasActions
              ? `<button id="${actionToggleId}" class="sk-btn sk-btn-primary" onclick="(function(){
                    const box=document.getElementById('${actionBoxId}');
                    const btn=document.getElementById('${actionToggleId}');
                    if(!box||!btn) return;
                    const open = box.getAttribute('data-open')==='1';
                    box.setAttribute('data-open', open?'0':'1');
                    box.style.display = open ? 'none' : 'block';
                    btn.textContent = open ? 'Xem gợi ý chi tiết' : 'Ẩn gợi ý';
                  })()">Xem gợi ý chi tiết</button>`
              : `<div class="sk-no-rec">Chưa có gợi ý từ recommendation.js cho ${escapeHtml(ruleId)}.</div>`
          }
        </div>

        ${
          hasActions
            ? `<div id="${actionBoxId}" class="sk-actions-wrap" style="display:none" data-open="0">
                 <div class="sk-actions-head">✅ Gợi ý cải thiện (Recommendation)</div>
                 ${actionsHtml}
               </div>`
            : ""
        }
      </div>
    `;
  }).join("");

  const status = gate?.gate_status || getGateStatusEnum().SOFT_PENDING;

  const modalHTML = `
    <div id="rejectionModal" class="sk-overlay">
      <style>
        .sk-overlay{position:fixed;inset:0;background:rgba(17,24,39,.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;}
        .sk-modal{width:min(880px,100%);background:#fff;border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.35);overflow:hidden;border:1px solid #E5E7EB;}
        .sk-head{padding:18px 22px;background:linear-gradient(135deg,#991B1B,#DC2626);color:#fff;}
        .sk-head-top{display:flex;align-items:center;justify-content:space-between;gap:12px;}
        .sk-h-title{font-size:18px;font-weight:900;letter-spacing:.2px;}
        .sk-pill{background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.25);padding:6px 10px;border-radius:999px;font-weight:800;font-size:12px;}
        .sk-sub{margin-top:6px;color:rgba(255,255,255,.92);font-weight:700;font-size:13px;}
        .sk-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px;}
        .sk-metaBox{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.22);border-radius:12px;padding:10px 12px;}
        .sk-metaBox .t{font-size:11px;font-weight:900;opacity:.9;}
        .sk-metaBox .v{font-size:13px;font-weight:900;margin-top:2px;}
        .sk-body{padding:18px 18px 6px;background:#F9FAFB;}
        .sk-note{background:#FFF7ED;border:1px solid #FED7AA;border-left:5px solid #F59E0B;border-radius:14px;padding:12px 14px;color:#92400E;font-weight:800;margin-bottom:14px;}
        .sk-cards{display:grid;grid-template-columns:1fr;gap:12px;}
        .sk-card{background:#fff;border:1px solid #E5E7EB;border-radius:16px;padding:14px 14px 12px;box-shadow:0 8px 18px rgba(0,0,0,.06);}
        .sk-card-top{display:flex;gap:10px;align-items:flex-start;}
        .sk-badge{background:#FEE2E2;color:#991B1B;border:1px solid #FCA5A5;padding:6px 10px;border-radius:999px;font-weight:900;font-size:12px;white-space:nowrap;}
        .sk-title .sk-kpi{font-weight:900;color:#111827;font-size:12px;opacity:.75;}
        .sk-title .sk-name{font-weight:900;color:#111827;font-size:15px;margin-top:2px;}
        .sk-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:12px;}
        .sk-metric{background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;padding:10px;}
        .sk-label{font-size:11px;font-weight:900;color:#6B7280;}
        .sk-value{margin-top:4px;font-size:14px;font-weight:900;color:#111827;}
        .sk-req{color:#B45309;}
        .sk-reason{color:#991B1B;}
        .sk-cta{display:flex;align-items:center;gap:10px;margin-top:12px;flex-wrap:wrap;}
        .sk-btn{border:none;border-radius:12px;padding:10px 12px;font-weight:900;cursor:pointer;}
        .sk-btn-outline{background:#fff;border:2px solid #EE4D2D;color:#EE4D2D;}
        .sk-btn-outline:hover{filter:brightness(.98);}
        .sk-btn-primary{background:#EE4D2D;color:#fff;}
        .sk-btn-primary:hover{background:#D73211;}
        .sk-no-rec{font-size:12px;color:#6B7280;font-weight:800;}
        .sk-actions-wrap{margin-top:12px;background:#F0FDF4;border:1px solid #BBF7D0;border-left:5px solid #10B981;border-radius:14px;padding:12px;}
        .sk-actions-head{font-size:12px;font-weight:900;color:#065F46;margin-bottom:8px;}
        .sk-actions{margin:0;padding-left:18px;}
        .sk-item{margin:8px 0;color:#065F46;font-weight:800;font-size:13px;}
        .sk-act-title{font-weight:900;color:#064E3B;}
        .sk-act-desc{margin-top:3px;color:#065F46;font-weight:700;font-size:12px;}
        .sk-steps{margin:6px 0 0;padding-left:18px;color:#065F46;font-weight:700;font-size:12px;}
        .sk-foot{display:flex;gap:12px;justify-content:flex-end;align-items:center;padding:14px 18px;background:#fff;border-top:1px solid #E5E7EB;}
        .sk-foot .sk-btn{padding:11px 14px;}
        .sk-btn-gray{background:#6B7280;color:#fff;}
        .sk-btn-gray:hover{background:#4B5563;}
        .sk-btn-orange{background:#EE4D2D;color:#fff;}
        .sk-btn-orange:hover{background:#D73211;}
        @media (max-width: 860px){
          .sk-grid{grid-template-columns:1fr;}
          .sk-meta{grid-template-columns:1fr;}
          .sk-foot{flex-direction:column-reverse;align-items:stretch;}
        }
        /* pulse highlight */
        .__softko_pulse{outline:3px solid rgba(238,77,45,.35); box-shadow:0 0 0 8px rgba(238,77,45,.12); border-color:#EE4D2D !important;}
      </style>

      <div class="sk-modal">
        <div class="sk-head">
          <div class="sk-head-top">
            <div class="sk-h-title">⚠️ Soft KO chưa đạt — cần cải thiện</div>
            <div class="sk-pill">Gate: ${escapeHtml(status)}</div>
          </div>
          <div class="sk-sub">Bạn có thể sửa ngay trên trang này. Hệ thống sẽ gợi ý hành động để đạt chuẩn.</div>

          <div class="sk-meta">
            <div class="sk-metaBox">
              <div class="t">📅 Ngày kiểm tra</div>
              <div class="v">${formatDate(today)}</div>
            </div>
            <div class="sk-metaBox">
              <div class="t">🔄 Ngày xét điểm tiếp theo</div>
              <div class="v">${formatDate(nextDate)}</div>
            </div>
          </div>
        </div>

        <div class="sk-body">
          <div class="sk-note">
            Tip: Nhấn “Sửa tiêu chí này” để tự động cuộn tới ô nhập và focus.
          </div>

          <div class="sk-cards">
            ${cardsHtml || "<div class='sk-card'><b>Không đạt một hoặc nhiều tiêu chí.</b></div>"}
          </div>
        </div>

        <div class="sk-foot">
          <button class="sk-btn sk-btn-gray" onclick="window.__softko_closeModal()">Đóng</button>
          <button class="sk-btn sk-btn-orange" onclick="window.__softko_backToEdit('${escapeHtml(firstFailKey || "")}')">
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
  return `Cần đạt: ${getRequirementText(cfg)}`;
}

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
  localStorage.setItem(SOFT_GATE_LOCK_KEY, "1");
  disableAllInputs();
  updateProgress();

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

// Back button in page header STILL goes to KO_GATE (đúng flow step 1->2)
// Yêu cầu của bạn (2) áp dụng cho nút "Quay lại sửa" trong modal fail => đã sửa.
// Nếu bạn muốn nút back-button ở trang cũng không về KO_GATE, nói mình chỉnh thêm.
function goBack() {
  // (giữ nguyên như flow cũ)
  localStorage.removeItem(SOFT_GATE_LOCK_KEY);
  window.location.href = "KO_GATE.html";
}

// ===== Restore =====
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

  reconcileLockWithGate();
  if (isLockedNow()) disableAllInputs();
  else enableAllInputs();

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

    if (String(el.value || "").trim() !== "") validateInput(k);
    else updateInputUI(k, null, null);
  });

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

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootSoftKO);
} else {
  bootSoftKO();
}

// export thresholds
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
