/**
 * ============================================================
 * SOFT_KO_SCRIPT.JS (REFACTORED - Part B)
 * ============================================================
 * Refactored to use SSOT from window.MRSM_CONFIG.GateRegistry
 * - No hard-coded soft KO IDs (OP-04, PEN-01, CO-01, SC-02)
 * - All thresholds/labels/units come from GateRegistry
 * - Fail-closed guard (requireHardGateOrRedirect)
 *
 * Prerequisites:
 * - window.MRSM_CONFIG must be loaded (from mrsm_config.js)
 * - window.GateGuard should be loaded (from gate-guard.js)
 *
 * Usage in HTML:
 * <script src="./mrsm_config.js"></script>
 * <script src="./gate-guard.js"></script>
 * <script src="./soft_ko_script.js"></script>
 * ============================================================
 */

// Constants
const SOFT_GATE_KEY = 'soft_ko_gate';
const SOFT_GATE_LOCK_KEY = 'soft_ko_gate_locked';

/**
 * Build inputs configuration from MRSM_CONFIG.GateRegistry (SSOT)
 * Maps localKey (op04, pen01, co01, sc02) -> rule metadata
 */
function buildInputsFromRegistry() {
    const registry = window.MRSM_CONFIG?.GateRegistry;
    if (!registry) {
        console.error('[SoftKO] GateRegistry not found. Ensure mrsm_config.js is loaded.');
        return {};
    }

    const inputs = {};
    const keyMap = {
        'OP-04': 'op04',
        'PEN-01': 'pen01',
        'CO-01': 'co01',
        'SC-02': 'sc02',
    };

    for (const [ruleId, localKey] of Object.entries(keyMap)) {
        const rule = registry.getRule(ruleId);
        if (!rule) continue;

        inputs[localKey] = {
            id: localKey,
            ruleId,
            threshold: rule.threshold,
            type: rule.type,
            direction: rule.direction,
            name: rule.label,
            unit: rule.unit,
            passText: `Đạt chuẩn (${rule.direction === 'min' ? '≥' : '≤'} ${rule.threshold}${rule.unit})`,
            failText: `Cần cải thiện (${rule.direction === 'min' ? '≥' : '≤'} ${rule.threshold}${rule.unit})`,
        };
    }

    return inputs;
}

// Build inputs from SSOT
const inputs = buildInputsFromRegistry();

/**
 * [Fail-Closed] Soft KO chỉ được truy cập sau khi Hard KO đã validate
 * Use GateGuard if available, else fallback to sessionStorage check
 */
function requireHardGateOrRedirect() {
    if (window.GateGuard) {
        return window.GateGuard.requireHardGateOrRedirect({
            redirectOnMissing: true,
        });
    }

    // Fallback: direct check
    const hardRaw = sessionStorage.getItem('validatedHardKO');
    if (!hardRaw) {
        window.location.href = 'KO_GATE.html';
        return false;
    }
    return true;
}

/**
 * Migration: chuẩn hoá Soft KO IDs theo registry
 */
function migrateSoftGateKeys(gate) {
    try {
        if (!gate || typeof gate !== "object") return gate;

        // Ensure soft exists
        if (!gate.soft || typeof gate.soft !== "object") gate.soft = {};
        if (!gate.soft.items || typeof gate.soft.items !== "object") gate.soft.items = {};

        // --- MIGRATE DEADLINE: top-level deadline_at -> soft.deadline_at ---
        if (!gate.soft.deadline_at && gate.deadline_at) {
            gate.soft.deadline_at = gate.deadline_at;
        }

        // Remove legacy keys not in registry
        const allowedIds = new Set(
            window.MRSM_CONFIG?.GateRegistry?.softKoIds || ["OP-04", "PEN-01", "CO-01", "SC-02"]
        );

        for (const key of Object.keys(gate.soft.items)) {
            if (!allowedIds.has(key)) delete gate.soft.items[key];
        }

        // Ensure all registered soft KOs exist
        for (const ruleId of allowedIds) {
            if (!gate.soft.items[ruleId]) {
                gate.soft.items[ruleId] = { passed: false, note: "", fixed_at: null, regressed_at: null };
            } else {
                // normalize fields
                gate.soft.items[ruleId].note ??= "";
                gate.soft.items[ruleId].fixed_at ??= null;
                gate.soft.items[ruleId].regressed_at ??= null;
            }
        }
    } catch (e) {
        console.warn("[SoftKO] Migration error:", e);
    }
    return gate;
}

/**
 * Initialize gate if missing (fail-closed)
 */
function initSoftGateIfMissing() {
    if (!requireHardGateOrRedirect()) return null;

    const raw = localStorage.getItem(SOFT_GATE_KEY);
    if (raw) {
        try {
            return migrateSoftGateKeys(JSON.parse(raw));
        } catch {
            // parse error → fail-closed, re-init
        }
    }

    // Fallback init
    const now = new Date();
    const deadline = new Date(now);
    deadline.setDate(
        now.getDate() +
        (window.MRSM_CONFIG?.GateRegistry?.softKoRules?.['OP-04']?.remediation_days || 7)
    );

    const softKoIds =
        window.MRSM_CONFIG?.GateRegistry?.softKoIds ||
        ['OP-04', 'PEN-01', 'CO-01', 'SC-02'];

    const items = {};
    for (const ruleId of softKoIds) {
        items[ruleId] = {
            passed: false,
            note: '',
            fixed_at: null,
            regressed_at: null
        };
    }

    const gate = {
        verified_at: now.toISOString(),
        gate_status: "G1", // Soft-KO active
        soft: {
            deadline_at: deadline.toISOString(),
            items
        }
    };

    // backward compatible nếu code cũ còn đọc gate.deadline_at
    gate.deadline_at = gate.soft.deadline_at;

    localStorage.setItem(SOFT_GATE_KEY, JSON.stringify(gate));
    return gate;
}


/**
 * Save gate back to localStorage
 */
function saveGate(gate) {
    localStorage.setItem(SOFT_GATE_KEY, JSON.stringify(gate));
}

/**
 * Clamp helper
 */
function clamp(v, min, max) {
    return Math.min(Math.max(v, min), max);
}

/**
 * Validate + update gate item
 * Uses GateRegistry for threshold comparison
 */
function validateInput(key) {
    const cfg = inputs[key];
    if (!cfg) return false;

    const inputEl = document.getElementById(cfg.id);
    if (!inputEl) return false;

    const raw = String(inputEl.value || '').trim();
    if (raw === '') {
        updateInputUI(key, null, null);
        return false;
    }

    let value = Number(raw);
    if (Number.isNaN(value)) {
        updateInputUI(key, false, 'Giá trị không hợp lệ');
        return false;
    }

    // type-based clamp
    if (cfg.type === 'percentage') {
        value = clamp(value, 0, 100);
        inputEl.value = String(value);
    } else if (cfg.type === 'number') {
        if (value < 0) value = 0;
        inputEl.value = String(value);
    }

    // Compare with threshold using direction from registry
    let passed = false;
    if (cfg.direction === 'min') {
        passed = value >= cfg.threshold;
    } else if (cfg.direction === 'max') {
        passed = value <= cfg.threshold;
    }

    updateInputUI(key, passed, passed ? cfg.passText : cfg.failText);

    // Update gate item
    const gate = initSoftGateIfMissing();
    const ruleId = cfg.ruleId;

    if (!gate.soft) gate.soft = { items: {} };
    if (!gate.soft.items) gate.soft.items = {};
    if (!gate.soft.items[ruleId]) {
        gate.soft.items[ruleId] = { passed: false, note: '', fixed_at: null, regressed_at: null };
    }

    const item = gate.soft.items[ruleId];

    // track first time pass
    if (passed && !item.passed) {
        item.fixed_at = item.fixed_at || new Date().toISOString();
        item.regressed_at = null;
    }

    // track regress after pass
    if (!passed && item.passed) {
        item.regressed_at = new Date().toISOString();
    }

    item.passed = passed;

    // update status based on all pass + deadline
    const softKoIds = window.MRSM_CONFIG?.GateRegistry?.softKoIds || ['OP-04', 'PEN-01', 'CO-01', 'SC-02'];
    const allPass = softKoIds.every((id) => gate.soft.items[id]?.passed);

    if (allPass) {
        gate.gate_status = 'PASS';
    } else {
        // within or overdue
        const now = new Date();
        const dlStr = gate?.soft?.deadline_at || gate?.deadline_at; // fallback legacy
        const dl = dlStr ? new Date(dlStr) : null;

        if (!dl || isNaN(dl.getTime())) {
            // fail-closed: thiếu deadline hợp lệ thì coi như quá hạn
            gate.gate_status = "G2";
        } else {
            gate.gate_status = now <= dl ? "G1" : "G2";
        }
        gate.gate_status = now <= dl ? 'G1' : 'G2';
    }

    saveGate(gate);
    return passed;
}

/**
 * Update UI for each metric
 */
function updateInputUI(key, passed, message) {
  const cfg = inputs[key];
  if (!cfg) return;

  // map localKey -> đúng ID bạn đang dùng trong HTML
  const map = {
    op04: { badge: 'badge-op04', hint: 'hint-op04' },
    pen01:{ badge: 'badge-pen01', hint: 'hint-pen01' },
    co01: { badge: 'badge-co01', hint: 'hint-co01' },
    sc02: { badge: 'badge-sc02', hint: 'hint-sc02' },
  };

  const ids = map[key];
  if (!ids) return;

  const badgeEl = document.getElementById(ids.badge);
  const hintEl  = document.getElementById(ids.hint);
  if (!badgeEl || !hintEl) return;

  if (passed === null) {
    // trở về trạng thái mặc định
    hintEl.textContent = 'Chưa nhập dữ liệu';
    return;
  }

  if (passed) {
    hintEl.textContent = message || cfg.passText;
    // optional: đổi màu badge khi đạt
    badgeEl.classList.remove('warning', 'info');
    badgeEl.classList.add('pass');
  } else {
    hintEl.textContent = message || cfg.failText;
    badgeEl.classList.remove('pass');
    badgeEl.classList.add('fail');
  }
}

/**
 * Disable/enable inputs
 */
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

/**
 * Update progress bar
 */
function updateProgress() {
  let count = 0;

  // map localKey -> checklist id trong HTML
  const ck = {
    op04: 'check-op04',
    pen01: 'check-pen01',
    co01: 'check-co01',
    sc02: 'check-sc02',
  };

  Object.keys(inputs).forEach((k) => {
    const cfg = inputs[k];
    const el = document.getElementById(cfg.id);
    const filled = el && String(el.value).trim() !== '';
    if (filled) count++;

    // update checklist UI
    const row = document.getElementById(ck[k]);
    if (row) {
      row.classList.toggle('completed', filled);
      const icon = row.querySelector('.check-icon');
      if (icon) icon.textContent = filled ? '✓' : '○';
    }
  });

  // update text "Đã nhập: x/4 chỉ số"
  const total = Object.keys(inputs).length;
  const progressText = document.getElementById('progress-text');
  if (progressText) progressText.textContent = `Đã nhập: ${count}/${total} chỉ số`;

  // enable/disable nút Xem kết quả
  const nextBtn = document.getElementById('nextBtn');
  if (nextBtn) {
    const ready = count === total;
    nextBtn.disabled = !ready;
    nextBtn.classList.toggle('disabled', !ready);
    nextBtn.textContent = 'Xem kết quả';
  }
}

/**
 * Format date helper
 */
function formatDate(date) {
    if (!date) return '—';
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return String(date);
    return d.toLocaleDateString('vi-VN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/**
 * Get soft KO recommendation (placeholder)
 */
function getSoftRecommendation(key) {
    const cfg = inputs[key];
    if (!cfg) return '';
    return `Cần đạt: ${cfg.direction === 'min' ? '≥' : '≤'} ${cfg.threshold}${cfg.unit}`;
}

/**
 * Show rejection modal with detailed reasons
 */
function showRejectionModalDetailed(failedDetails, gate) {
    const today = new Date();

    let nextDate = new Date(today);
    try {
        const deadline = gate?.deadline_at || gate?.soft?.deadline_at;
        if (deadline) {
            const d = new Date(deadline);
            if (!isNaN(d.getTime())) nextDate = d;
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
        ${x.recommendation ? `<div style="color:#374151;margin-top:6px;"><b>Gợi ý:</b><br>${x.recommendation}</div>` : ''}
    </div>
  `
        )
        .join('');

    const modalHTML = `
    <div id="rejectionModal" style="
        position: fixed; inset: 0;
        background: rgba(0,0,0,.6);
        display:flex; align-items:center; justify-content:center;
        z-index:9999; animation: fadeIn 0.3s ease;">
        <div style="
            background:#fff; border-radius:16px;
            padding:28px; max-width:560px; width:92%;
            box-shadow:0 20px 60px rgba(0,0,0,.3);
            animation: slideUp 0.3s ease;">
            <div style="text-align:center; margin-bottom:16px;">
                <div style="font-size:22px; font-weight:900; color:#DC2626; margin-bottom:6px;">Không đạt</div>
                <div style="color:#6B7280; font-weight:700;">
                    Bạn chưa đạt điều kiện Soft KO để qua gate.
                </div>
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
                <button onclick="closeModal()" style="
                    flex:1; padding:12px 16px; border-radius:10px;
                    border:none; background:#6B7280; color:#fff; font-weight:900; cursor:pointer;">
                    Đóng
                </button>
                <button onclick="closeModal(); goBack();" style="
                    flex:1; padding:12px 16px; border-radius:10px;
                    border:none; background:#EE4D2D; color:#fff; font-weight:900; cursor:pointer;">
                    Quay lại sửa
                </button>
            </div>
        </div>
    </div>
  `;

    const old = document.getElementById('rejectionModal');
    if (old) old.remove();
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

/**
 * Success modal then redirect
 */
function showSuccessModalAndRedirect(url, seconds) {
    const modalHTML = `
    <div id="successModal" style="
        position: fixed; inset: 0;
        background: rgba(0,0,0,.6);
        display:flex; align-items:center; justify-content:center;
        z-index:9999; animation: fadeIn 0.3s ease;">
        <div style="
            background:#fff; border-radius:16px;
            padding:28px; max-width:520px; width:92%;
            box-shadow:0 20px 60px rgba(0,0,0,.3);
            animation: slideUp 0.3s ease; text-align:center;">
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

    const old = document.getElementById('successModal');
    if (old) old.remove();
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    let t = seconds;
    const timer = setInterval(() => {
        t -= 1;
        const el = document.getElementById('countdown');
        if (el) el.textContent = String(t);
        if (t <= 0) {
            clearInterval(timer);
            window.location.href = url;
        }
    }, 1000);
}

/**
 * Close modal helper
 */
function closeModal() {
    const modal = document.getElementById('rejectionModal') || document.getElementById('successModal');
    if (modal) modal.remove();
}

/**
 * Go back helper
 */
function goBack() {
    window.history.back();
}

/**
 * Main action: validate all, then decide pass/fail
 */
function goNext() {
    // Validate all to sync UI + gate
    Object.keys(inputs).forEach((k) => validateInput(k));
    updateProgress();

    const gate = initSoftGateIfMissing();

    // If not PASS -> show rejection
    if (!gate || gate.gate_status !== 'PASS') {
        const failedDetails = [];

        Object.keys(inputs).forEach((k) => {
            const cfg = inputs[k];
            const el = document.getElementById(cfg.id);
            const empty = !el || String(el.value).trim() === '';
            const ok = validateInput(k);

            if (empty) {
                failedDetails.push({
                    key: k,
                    name: cfg.name,
                    reason: 'Chưa nhập dữ liệu',
                    recommendation: getSoftRecommendation(k),
                });
            } else if (!ok) {
                failedDetails.push({
                    key: k,
                    name: cfg.name,
                    reason: cfg.failText || 'Chưa đạt',
                    recommendation: getSoftRecommendation(k),
                });
            }
        });

        showRejectionModalDetailed(failedDetails, gate);
        return;
    }

    // PASS -> lock inputs and redirect
    localStorage.setItem(SOFT_GATE_LOCK_KEY, '1');
    disableAllInputs();
    updateProgress();

    // Save snapshot
    const data = {};
    Object.keys(inputs).forEach((key) => {
        const input = document.getElementById(inputs[key].id);
        data[key] = input ? input.value : '';
    });
    sessionStorage.setItem('softKoData', JSON.stringify(data));
    window.softKoData = data;

    const nextBtn = document.getElementById('nextBtn');
    if (nextBtn) nextBtn.disabled = true;

    showSuccessModalAndRedirect('./KPI_SCORING.html', 10);
}

/**
 * Init: bind event listeners and render
 */
document.addEventListener('DOMContentLoaded', () => {
    if (!requireHardGateOrRedirect()) return;

    // Init gate
    initSoftGateIfMissing();

    // Bind inputs
    Object.keys(inputs).forEach((k) => {
        const el = document.getElementById(inputs[k].id);
        if (!el) return;
        el.addEventListener('input', () => {
            validateInput(k);
            updateProgress();
        });
        el.addEventListener('blur', () => {
            validateInput(k);
            updateProgress();
        });
    });

    // Bind button
    const nextBtn = document.getElementById('nextBtn');
    if (nextBtn) nextBtn.addEventListener('click', goNext);

    // Initial render
    updateProgress();
});

/**
 * ✅ SSOT: Export soft KO thresholds to other pages (from GateRegistry)
 * This is now built from MRSM_CONFIG.GateRegistry, not hard-coded
 */
window.MRSM_GATE_THRESHOLDS = (function () {
    const registry = window.MRSM_CONFIG?.GateRegistry;
    if (!registry) return {};

    const result = {};
    for (const ruleId of registry.softKoIds) {
        const rule = registry.getRule(ruleId);
        if (rule) {
            result[ruleId] = {
                type: rule.type,
                direction: rule.direction,
                threshold: rule.threshold,
                unit: rule.unit,
                label: rule.label,
            };
        }
    }
    return result;

})();
