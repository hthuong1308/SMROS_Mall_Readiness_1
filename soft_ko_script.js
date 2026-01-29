/**
 * ============================================================
 * soft_ko_script.js (HARDENED + MATCH recommendation.js schema)
 * ============================================================
 * Fixes:
 * 1) Modal fail đẹp hơn + đọc đúng schema recommendation.js:
 *    - insight
 *    - hanh_dong_uu_tien / hanh_dong_khac_phuc
 * 2) "Quay lại sửa" KHÔNG redirect KO_GATE nữa:
 *    - đóng modal + scroll/focus input cần sửa
 * 3) reconcileLockWithGate(): nếu lỡ lock mà gate chưa PASS => tự unlock
 *
 * Expected HTML IDs (SOFT_KO.html):
 *   inputs: op04, pen01, co01, sc02
 *   badges: badge-op04, badge-pen01, badge-co01, badge-sc02
 *   hints:  hint-op04, hint-pen01, hint-co01, hint-sc02
 *   checklist rows: check-op04, check-pen01, check-co01, check-sc02 (with .check-icon)
 *   progress text: progress-text
 *   next button: nextBtn
 *
 * Dependencies (recommended order):
 *   mrsm_config.js
 *   gate-guard.js (optional)
 *   recommendation.js   <-- IMPORTANT
 *   soft_ko_script.js
 * ============================================================
 */

// ---------- Constants ----------
const LOCK_KEY = "soft_ko_gate_locked";
const LOCAL_SOFT_KEY = () => window.MRSM_CONFIG?.SOFT_GATE_KEY || "soft_ko_gate";
const HARD_EVIDENCE_KEY = () => window.MRSM_CONFIG?.HARD_GATE_KEY || "validatedHardKO";

// Thesis defaults (fallback if registry thresholds not provided)
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
    try { return JSON.parse(raw); } catch { return null; }
}
function formatDate(date) {
    if (!date) return "—";
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return String(date);
    return d.toLocaleDateString("vi-VN", { year: "numeric", month: "2-digit", day: "2-digit" });
}
function toLocalKey(ruleId) {
    return String(ruleId || "").toLowerCase().replace(/[^a-z0-9]/g, ""); // OP-04 -> op04
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

/**
 * Read thresholds from SSOT if you later add it.
 * For now: fallback thesis defaults.
 */
function getRuleSpec(ruleId) {
    // If you later add GateRegistry thresholds: plug here.
    // const r = window.MRSM_CONFIG?.GateRegistry?.getRule?.(ruleId); ...
    return SOFT_KO_DEFAULTS[ruleId] || null;
}

// ---------- Guards ----------
function requireHardGateOrRedirect() {
    if (window.GateGuard && typeof window.GateGuard.requireHardGateOrRedirect === "function") {
        return window.GateGuard.requireHardGateOrRedirect({ redirectOnMissing: true });
    }

    const hardRaw = sessionStorage.getItem(HARD_EVIDENCE_KEY());
    if (!hardRaw) {
        window.location.href = "KO_GATE.html";
        return false;
    }
    return true;
}

// ---------- Inputs (built after DOM exists) ----------
let inputs = {};

/**
 * Build inputs from SSOT IDs + defaults, but ONLY if HTML input exists.
 */
function buildInputs() {
    const ids = getSoftKoIds();
    const out = {};

    for (const ruleId of ids) {
        const spec = getRuleSpec(ruleId);
        if (!spec) continue;

        const localKey = toLocalKey(ruleId);
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

    const key = LOCAL_SOFT_KEY();
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

    // prefer verifiedAt from hard evidence (if exists)
    const hard = safeParse(sessionStorage.getItem(HARD_EVIDENCE_KEY()));
    const verifiedAtIso = hard?.verifiedAt || hard?.verified_at || new Date().toISOString();
    const verifiedAt = new Date(verifiedAtIso);

    const remDays = getRuleSpec("OP-04")?.remediation_days ?? 7;
    const deadline = new Date(verifiedAt);
    deadline.setDate(deadline.getDate() + remDays);

    const items = {};
    for (const id of getSoftKoIds()) {
        items[id] = { passed: false, note: "", fixed_at: null, regressed_at: null };
    }

    const gate = {
        verified_at: verifiedAt.toISOString(),
        gate_status: G.SOFT_PENDING,
        soft: {
            deadline_at: deadline.toISOString(),
            items,
        },
    };

    gate.deadline_at = gate.soft.deadline_at;

    localStorage.setItem(key, JSON.stringify(gate));
    return gate;
}

function saveGate(gate) {
    localStorage.setItem(LOCAL_SOFT_KEY(), JSON.stringify(gate));
}

// ---------- Lock reconciliation (NEW) ----------
/**
 * If lock=1 but gate_status != PASS => unlock (user must be able to edit)
 * If gate_status == PASS => keep lock
 */
function reconcileLockWithGate(gate) {
    const G = getGateStatusEnum();
    const locked = localStorage.getItem(LOCK_KEY) === "1";

    if (!gate) {
        if (locked) localStorage.removeItem(LOCK_KEY);
        return;
    }

    if (locked && gate.gate_status !== G.PASS) {
        localStorage.removeItem(LOCK_KEY);
    }
}

// ---------- UI helpers ----------
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

function focusInput(localKey) {
    const el = document.getElementById(localKey);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => {
        try { el.focus(); } catch { }
    }, 250);
}

function updateProgress() {
    const keys = Object.keys(inputs);
    let filledCount = 0;

    keys.forEach((k) => {
        const el = document.getElementById(inputs[k].id);
        const filled = !!el && String(el.value || "").trim() !== "";
        if (filled) filledCount++;
        updateChecklist(k, filled);
    });

    const progressText = document.getElementById("progress-text");
    if (progressText) progressText.textContent = `Đã nhập: ${filledCount}/${keys.length} chỉ số`;

    const nextBtn = document.getElementById("nextBtn");
    if (nextBtn) {
        // allow "Xem kết quả" only when all inputs filled (UX clean)
        const ready = keys.length > 0 && filledCount === keys.length;
        nextBtn.disabled = !ready;
        nextBtn.classList.toggle("disabled", !ready);
        nextBtn.textContent = "Xem kết quả";
    }
}

// ---------- Validation + gate update ----------
function computePassed(cfg, value) {
    if (cfg.direction === "min") return value >= cfg.threshold;
    if (cfg.direction === "max") return value <= cfg.threshold;
    return false;
}

function validateInput(localKey) {
    const cfg = inputs[localKey];
    if (!cfg) return false;

    const el = document.getElementById(cfg.id);
    if (!el) return false;

    const raw = String(el.value || "").trim();

    // empty -> do NOT write gate
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

    if (passed && !item.passed) {
        item.fixed_at = item.fixed_at || new Date().toISOString();
        item.regressed_at = null;
    } else if (!passed && item.passed) {
        item.regressed_at = new Date().toISOString();
    }

    item.passed = passed;
    item.note = passed ? "" : (cfg.failText || "Chưa đạt");

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

// ---------- Recommendation adapter (MATCH recommendation.js) ----------
function getRec(ruleId) {
    // recommendation.js defines window.RECOMMENDATIONS with keys "OP-04"...
    const rec = window.RECOMMENDATIONS?.[ruleId];
    if (!rec) return null;

    const insight = rec.insight || {};
    const warn = rec.canh_bao || rec.can_bao || {};
    const pri = Array.isArray(rec.hanh_dong_uu_tien) ? rec.hanh_dong_uu_tien : [];
    const fix = Array.isArray(rec.hanh_dong_khac_phuc) ? rec.hanh_dong_khac_phuc : [];

    return {
        nhom: rec.nhom || "",
        gate: rec.gate || "",
        loai: rec.loai || "",
        insight,
        warn,
        pri,
        fix,
    };
}

function renderRecHTML(ruleId) {
    const rec = getRec(ruleId);
    if (!rec) {
        return `<div style="color:#6B7280;font-weight:700;">
      Không tìm thấy gợi ý trong recommendation.js cho <b>${ruleId}</b>.
      <div style="font-weight:600;margin-top:6px;">(Kiểm tra: đã load recommendation.js trước soft_ko_script.js chưa?)</div>
    </div>`;
    }

    const insightHTML = `
    <div style="display:grid; gap:10px; grid-template-columns:1fr; margin-top:10px;">
      <div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:12px;padding:12px;">
        <div style="font-size:12px;font-weight:900;color:#9A3412;margin-bottom:6px;">Insight</div>
        <div style="color:#7C2D12;font-weight:700;">${rec.insight?.danh_gia || rec.insight?.hien_tai || "—"}</div>
        <div style="color:#9A3412;margin-top:6px;">
          <b>Mục tiêu:</b> ${rec.insight?.muc_tieu || "—"}
        </div>
      </div>
    </div>
  `;

    const renderActions = (arr, title, icon) => {
        if (!arr || !arr.length) return "";
        const items = arr
            .slice(0, 4)
            .map((x) => {
                const viec = x?.viec || "";
                const chiTiet = x?.chi_tiet_thuc_te || x?.tac_dong_ky_vong || "";
                return `
          <li style="margin:8px 0;">
            <div style="font-weight:900;color:#111827;">${viec}</div>
            ${chiTiet ? `<div style="color:#4B5563;margin-top:4px;">${chiTiet}</div>` : ""}
          </li>
        `;
            })
            .join("");

        return `
      <div style="margin-top:12px;">
        <div style="font-size:13px;font-weight:900;color:#111827;margin-bottom:6px;">
          ${icon} ${title}
        </div>
        <ol style="margin:0;padding-left:18px;color:#111827;">
          ${items}
        </ol>
      </div>
    `;
    };

    const warnHTML = `
    <div style="margin-top:10px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:12px;padding:12px;">
      <div style="font-size:12px;font-weight:900;color:#1D4ED8;margin-bottom:6px;">Cảnh báo / Deadline</div>
      <div style="color:#1E3A8A;font-weight:700;">${rec.warn?.deadline || "—"}</div>
      ${rec.warn?.neu_khong_dat ? `<div style="color:#1E3A8A;margin-top:6px;"><b>Không đạt:</b> ${rec.warn.neu_khong_dat}</div>` : ""}
    </div>
  `;

    return `
    ${insightHTML}
    ${renderActions(rec.pri, "Hành động ưu tiên", "✅")}
    ${renderActions(rec.fix, "Hành động khắc phục", "🛠️")}
    ${warnHTML}
  `;
}

// ---------- Modal (redesign) ----------
function closeAnyModal() {
    const modal = document.getElementById("rejectionModal") || document.getElementById("successModal");
    if (modal) modal.remove();
}

function showRejectionModalDetailed(failedDetails, gate) {
    const G = getGateStatusEnum();
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

    const gateBadge = gate?.gate_status || G.SOFT_PENDING;

    // cards
    const cardsHTML = (failedDetails || [])
        .map((x, idx) => {
            const cfg = inputs[x.key];
            const inputEl = cfg ? document.getElementById(cfg.id) : null;
            const currentVal = inputEl ? String(inputEl.value || "").trim() : "";
            const spec = cfg ? `${cfg.direction === "min" ? "≥" : "≤"} ${cfg.threshold}${cfg.unit || ""}` : "—";

            return `
        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:16px;padding:16px;margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
            <div>
              <div style="font-weight:900;color:#111827;font-size:14px;">${x.ruleId || ""} — ${x.name}</div>
              <div style="margin-top:4px;">
                <span style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;
                  background:#FEE2E2;color:#991B1B;font-weight:900;font-size:12px;">
                  ✖ FAIL
                </span>
              </div>
            </div>

            <button data-fix-key="${x.key}" style="
              padding:10px 12px;border-radius:12px;border:1px solid #EE4D2D;
              background:#FFF7F5;color:#EE4D2D;font-weight:900;cursor:pointer;">
              Sửa tiêu chí này
            </button>
          </div>

          <div style="display:grid;grid-template-columns:repeat(3, minmax(0,1fr));gap:10px;margin-top:12px;">
            <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;padding:10px;">
              <div style="color:#6B7280;font-weight:800;font-size:12px;">Giá trị hiện tại</div>
              <div style="font-weight:900;font-size:16px;color:#111827;">${currentVal || "—"}</div>
            </div>
            <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;padding:10px;">
              <div style="color:#6B7280;font-weight:800;font-size:12px;">Yêu cầu</div>
              <div style="font-weight:900;font-size:16px;color:#111827;">${spec}</div>
            </div>
            <div style="background:#FFF1F2;border:1px solid #FECDD3;border-radius:12px;padding:10px;">
              <div style="color:#9F1239;font-weight:800;font-size:12px;">Lý do</div>
              <div style="font-weight:900;font-size:14px;color:#9F1239;">${x.reason}</div>
            </div>
          </div>

          <div style="margin-top:12px;">
            ${renderRecHTML(x.ruleId)}
          </div>
        </div>
      `;
        })
        .join("");

    const modalHTML = `
    <div id="rejectionModal" style="
      position:fixed; inset:0; background:rgba(0,0,0,.55);
      display:flex; align-items:center; justify-content:center; z-index:9999; padding:16px;">
      <div style="
        width:min(980px, 100%); max-height:92vh; overflow:auto;
        background:#fff; border-radius:18px; box-shadow:0 24px 70px rgba(0,0,0,.35);
        border:1px solid rgba(255,255,255,.15);">

        <!-- Header -->
        <div style="background:linear-gradient(135deg,#991B1B,#DC2626); padding:18px 18px 14px; color:#fff;">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
            <div>
              <div style="display:flex;align-items:center;gap:10px;">
                <div style="font-size:20px;">⚠️</div>
                <div style="font-weight:1000;font-size:20px;">Soft KO chưa đạt — cần cải thiện</div>
              </div>
              <div style="margin-top:6px;font-weight:700;opacity:.95;">
                Bạn có thể sửa ngay trên trang này. Hệ thống hiển thị gợi ý hành động theo <b>recommendation.js</b>.
              </div>
            </div>

            <div style="display:flex;gap:10px;align-items:center;">
              <div style="padding:8px 12px;border-radius:999px;background:rgba(255,255,255,.18);font-weight:900;">
                Gate: ${gateBadge}
              </div>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px;">
            <div style="background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.18);border-radius:14px;padding:12px;">
              <div style="font-size:12px;font-weight:900;opacity:.95;">📅 Ngày kiểm tra</div>
              <div style="font-size:16px;font-weight:1000;margin-top:2px;">${formatDate(today)}</div>
            </div>
            <div style="background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.18);border-radius:14px;padding:12px;">
              <div style="font-size:12px;font-weight:900;opacity:.95;">🔄 Ngày xét điểm tiếp theo</div>
              <div style="font-size:16px;font-weight:1000;margin-top:2px;">${formatDate(nextDate)}</div>
            </div>
          </div>
        </div>

        <!-- Tip -->
        <div style="padding:14px 18px;">
          <div style="background:#FFF7ED;border:1px solid #FED7AA;border-left:6px solid #F59E0B;border-radius:14px;padding:12px 12px;">
            <div style="font-weight:900;color:#9A3412;">
              Tip: Nhấn <span style="background:#FFF1F2;border:1px solid #FECDD3;padding:2px 8px;border-radius:10px;">“Sửa tiêu chí này”</span> để tự động cuộn tới ô nhập và focus.
            </div>
          </div>
        </div>

        <!-- Body -->
        <div style="padding:0 18px 18px;">
          ${cardsHTML || `<div style="padding:10px 0;color:#6B7280;font-weight:800;">Không có tiêu chí lỗi.</div>`}
        </div>

        <!-- Footer -->
        <div style="position:sticky; bottom:0; background:#fff; border-top:1px solid #E5E7EB; padding:14px 18px; display:flex; justify-content:flex-end; gap:12px;">
          <button id="softkoCloseBtn" style="
            padding:12px 16px;border-radius:12px;border:none;background:#6B7280;color:#fff;font-weight:1000;cursor:pointer;">
            Đóng
          </button>
          <button id="softkoEditBtn" style="
            padding:12px 16px;border-radius:12px;border:none;background:#EE4D2D;color:#fff;font-weight:1000;cursor:pointer;">
            Quay lại sửa
          </button>
        </div>

      </div>
    </div>
  `;

    const old = document.getElementById("rejectionModal");
    if (old) old.remove();
    document.body.insertAdjacentHTML("beforeend", modalHTML);

    // bind buttons
    const closeBtn = document.getElementById("softkoCloseBtn");
    if (closeBtn) closeBtn.addEventListener("click", closeAnyModal);

    const editBtn = document.getElementById("softkoEditBtn");
    if (editBtn) {
        editBtn.addEventListener("click", () => {
            closeAnyModal();
            const first = (failedDetails || [])[0];
            if (first?.key) focusInput(first.key);
        });
    }

    // bind per-card "Sửa tiêu chí này"
    document.querySelectorAll("[data-fix-key]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const key = btn.getAttribute("data-fix-key");
            closeAnyModal();
            if (key) focusInput(key);
        });
    });
}

function showSuccessModalAndRedirect(url, seconds) {
    const modalHTML = `
    <div id="successModal" style="
      position: fixed; inset: 0; background: rgba(0,0,0,.55);
      display:flex; align-items:center; justify-content:center; z-index:9999; padding:16px;">
      <div style="background:#fff; border-radius:18px; padding:26px; max-width:520px; width:100%;
        box-shadow:0 24px 70px rgba(0,0,0,.35); text-align:center;">
        <div style="font-size:42px; margin-bottom:6px;">✅</div>
        <div style="font-size:22px; font-weight:1000; color:#065F46; margin-bottom:8px;">Hồ sơ hợp lệ</div>
        <div style="color:#374151; font-weight:800; margin-bottom:14px;">
          Bạn đã đạt toàn bộ Soft KO. Hệ thống sẽ chuyển sang bước chấm điểm KPI.
        </div>
        <div style="font-weight:1000; color:#111827;">
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

// ---------- Main action ----------
function goNext() {
    // Validate all to sync UI + gate
    Object.keys(inputs).forEach((k) => validateInput(k));
    updateProgress();

    const gate = initSoftGateIfMissing();
    const G = getGateStatusEnum();

    reconcileLockWithGate(gate);

    // If not PASS -> show fail modal (with recs)
    if (!gate || gate.gate_status !== G.PASS) {
        const failedDetails = [];

        Object.keys(inputs).forEach((k) => {
            const cfg = inputs[k];
            const el = document.getElementById(cfg.id);
            const empty = !el || String(el.value || "").trim() === "";

            if (empty) {
                failedDetails.push({
                    key: k,
                    ruleId: cfg.ruleId,
                    name: cfg.name,
                    reason: "Chưa nhập dữ liệu",
                });
            } else {
                const item = gate?.soft?.items?.[cfg.ruleId];
                const ok = item?.passed === true;
                if (!ok) {
                    failedDetails.push({
                        key: k,
                        ruleId: cfg.ruleId,
                        name: cfg.name,
                        reason: cfg.failText || "Chưa đạt",
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

// ---------- Boot ----------
function bootSoftKO() {
    if (!requireHardGateOrRedirect()) return;

    // Build config after DOM exists
    inputs = buildInputs();

    // Init gate
    const gate = initSoftGateIfMissing();

    // reconcile lock with gate (NEW)
    reconcileLockWithGate(gate);

    // Lock behavior
    const locked = localStorage.getItem(LOCK_KEY) === "1";
    if (locked) disableAllInputs();
    else enableAllInputs();

    // Bind inputs
    Object.keys(inputs).forEach((k) => {
        const el = document.getElementById(inputs[k].id);
        if (!el) return;

        const onChange = () => {
            // if locked, do nothing
            const lockedNow = localStorage.getItem(LOCK_KEY) === "1";
            if (lockedNow) return;

            validateInput(k);
            updateProgress();
        };

        el.addEventListener("input", onChange);
        el.addEventListener("blur", onChange);

        // initial sync UI
        if (String(el.value || "").trim() !== "") validateInput(k);
        else updateInputUI(k, null, null);
    });

    // Bind button
    const nextBtn = document.getElementById("nextBtn");
    if (nextBtn) nextBtn.addEventListener("click", (e) => {
        e.preventDefault();
        goNext();
    });

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
