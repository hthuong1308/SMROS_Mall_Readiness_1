const $ = (id) => document.getElementById(id);
// NOTE: Trang RESULTS cho phép hiển thị cả trạng thái Gate Blocked (score=0) để giải thích rõ lý do.
let toastTimer = null;

/* ============================================================
   ✅ Toast helper
   - Hiển thị thông báo nhỏ (export thành công/lỗi...)
============================================================ */
function showToast(type, title, message, ms = 2600) {
  const toast = $("toast");
  if (!toast) return;

  toast.classList.remove("success");
  if (type === "success") toast.classList.add("success");

  const iconEl = $("toastIcon");
  const titleEl = $("toastTitle");
  const msgEl = $("toastMsg");

  if (iconEl) iconEl.textContent = type === "success" ? "✓" : "!";
  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;

  toast.style.display = "block";
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.style.display = "none"), ms);
}

/* ============================================================
   ✅ Query param helper
   - Lấy giá trị query string từ URL hiện tại
============================================================ */
function getQueryParam(name) {
  const u = new URL(window.location.href);
  return u.searchParams.get(name);
}

/* ============================================================
   ✅ Build Dashboard URL (một phiên bản duy nhất)
   - Nếu có assessment_id -> ./DASHBOARD.html?assessment_id=...
   - Nếu không có assessment_id (offline/file://) -> ./DASHBOARD.html?mode=local
============================================================ */

/* ============================================================
   ✅ Gate guard (Fail-Closed) for local mode (no assessment_id)
   - Nếu không có dấu vết Hard KO (sessionStorage.validatedHardKO)
     và local assessment cũng không có hard.verified_at -> redirect KO_GATE
============================================================ */
function _safeParseJsonLite(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}
function requireHardGateEvidenceOrRedirectLocal(localAssessment) {
  const hardRaw = sessionStorage.getItem("validatedHardKO");
  const hard = hardRaw ? _safeParseJsonLite(hardRaw) : null;

  const hasHardInLocal =
    !!(localAssessment?.gate?.hard?.verified_at ||
      localAssessment?.gate?.hard?.verifiedAt ||
      localAssessment?.gate?.hardVerifiedAt ||
      localAssessment?.hard_verified_at);

  if (!hard && !hasHardInLocal) {
    window.location.href = "KO_GATE.html";
    return false;
  }
  return true;
}

function withAssessmentId(path, assessmentId) {
  const base = path.startsWith("./") ? path : "./" + path;
  if (assessmentId) return `${base}?assessment_id=${encodeURIComponent(assessmentId)}`;
  return `${base}?mode=local`;
}

/* ============================================================
   ✅ Sync tất cả link/nút sang Dashboard
   - Đảm bảo click nút/anchor luôn điều hướng đúng
   - Có preventDefault để tránh browser xử lý anchor khác mong muốn
============================================================ */
function syncDashboardLinks(assessmentId) {
  const isLocal = String(assessmentId || "").startsWith("LOCAL_");
  const dashHref = isLocal ? "./DASHBOARD.html?mode=local" : withAssessmentId("./DASHBOARD.html", assessmentId);

  const btnGoDashboard = document.getElementById("btnGoDashboard");
  if (btnGoDashboard) {
    btnGoDashboard.setAttribute("href", dashHref);
    btnGoDashboard.onclick = (e) => {
      e.preventDefault();
      window.location.href = dashHref;
    };
  }

  const footerDash = document.getElementById("footerDashboardLink");
  if (footerDash) {
    footerDash.setAttribute("href", dashHref);
    footerDash.onclick = (e) => {
      e.preventDefault();
      window.location.href = dashHref;
    };
  }

  document
    .querySelectorAll('.footer-actions a[href="./DASHBOARD.html"], .footer-actions a[href="././DASHBOARD.html"]')
    .forEach((a) => a.setAttribute("href", dashHref));
}


/* ============================================================
   ✅ Format helpers
============================================================ */
function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("vi-VN", { hour12: false });
}

function daysCeil(ms) {
  return Math.ceil(ms / 86400000);
}

/* ============================================================
   ✅ KPI Classification badge (UX Compliance vs Improvement)
   - Kiểm tra gateThreshold hoặc MRSM_GATE_THRESHOLDS
   - Nếu có → Mandatory / Gate (red)
   - else → Improvement / KPI scoring (green)
============================================================ */
function kpiClassificationTag(kpi) {
  // Check 1: Có gateThreshold trực tiếp trong object
  const hasDirectGate = kpi.gateThreshold !== undefined && kpi.gateThreshold !== null;
  if (hasDirectGate) {
    return {
      label: "Mandatory • Gate",
      cls: "danger",
      tooltip: "Gate (constraint): không đạt → MRSM_Final = 0 / blocked"
    };
  }

  // Check 2: Có trong MRSM_GATE_THRESHOLDS window object
  const hasGateInWindow = window.MRSM_GATE_THRESHOLDS && window.MRSM_GATE_THRESHOLDS[kpi.rule_id];
  if (hasGateInWindow) {
    return {
      label: "Mandatory • Gate",
      cls: "danger",
      tooltip: "Gate (constraint): không đạt → MRSM_Final = 0 / blocked"
    };
  }

  // Không có gate → Improvement KPI
  return {
    label: "Improvement • KPI",
    cls: "ok",
    tooltip: "Scoring (utility): ảnh hưởng điểm, không chặn gate"
  };
}

// ========== SSOT: Build from GateRegistry (PART B) ==========
window.MRSM_GATE_THRESHOLDS = (function () {
  // If soft_ko_script.js already set it from GateRegistry, use that
  if (window.MRSM_GATE_THRESHOLDS && Object.keys(window.MRSM_GATE_THRESHOLDS).length > 0) {
    return window.MRSM_GATE_THRESHOLDS;
  }

  // Otherwise build from GateRegistry (if loaded)
  const registry = window.MRSM_CONFIG?.GateRegistry;
  if (!registry) {
    // Fallback to hard-coded for backward compat
    return {
      'OP-04': { type: 'percentage', direction: 'min', threshold: 85, unit: '%', label: 'Tỷ lệ giao hàng nhanh (Soft KO)' },
      'PEN-01': { type: 'number', direction: 'max', threshold: 2, unit: ' điểm', label: 'Sao Quả Tạ (Soft KO)' },
      'CO-01': { type: 'percentage', direction: 'max', threshold: 10, unit: '%', label: 'Pre-order Rate (Soft KO)' },
      'SC-02': { type: 'number', direction: 'min', threshold: 150, unit: ' đơn', label: 'Số đơn 4 tuần (Soft KO)' },
    };
  }

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

/* ============================================================
   ✅ Tier logic (theo thesis)
============================================================ */
function tierFromScore(score) {
  if (score < 50) return "NOT_READY";
  if (score <= 69) return "PARTIALLY_READY";
  if (score <= 84) return "NEAR_MALL_READY";
  return "MALL_READY";
}

function tierMeta(tier) {
  switch (tier) {
    case "MALL_READY":
      return {
        label: "Mall-Ready",
        cls: "ok",
        icon: "✅",
        desc: "Đủ điều kiện (Eligible/Maintain) nếu không vi phạm gate.",
      };
    case "NEAR_MALL_READY":
      return {
        label: "Near Mall-Ready",
        cls: "ok",
        icon: "🟢",
        desc: "Gần đủ điều kiện (Near Eligible); cần cải thiện thêm một chút để đạt Mall-Ready.",
      };
    case "PARTIALLY_READY":
      return {
        label: "Partially Ready",
        cls: "warn",
        icon: "🟡",
        desc: "Phần nào sẵn sàng; cần cải thiện nhiều hơn để đạt quy chuẩn mall.",
      };
    case "NOT_READY":
      return {
        label: "Not Ready",
        cls: "danger",
        icon: "🔴",
        desc: "Chưa sẵn sàng; cần thực hiện nhiều cải tiến để đạt quy chuẩn assessment.",
      };
    case "GATE_BLOCKED":
      return {
        label: "Gate Blocked",
        cls: "danger",
        icon: "🚫",
        desc: "Bị chặn bởi hard/soft gate; cần xử lý các gate fail trước.",
      };
    default:
      return {
        label: tier || "Unknown",
        cls: "info",
        icon: "❓",
        desc: "Trạng thái không xác định",
      };
  }
}

function scoreTone(score) {
  if (score >= 85) return { cls: "ok", tone: "xanh" };
  if (score >= 70) return { cls: "warn", tone: "vàng" };
  return { cls: "danger", tone: "đỏ" };
}

function gateBadge(status) {
  switch (String(status || "").toUpperCase()) {
    case "PASS":
      return { icon: "✅", text: "PASS", cls: "ok" };
    case "G0":
    case "HARD_FAIL":
    case "HARD_FAILED":
      return { icon: "🚫", text: "Hard KO", cls: "danger" };
    case "G1":
    case "PENDING":
      return { icon: "⏳", text: "Pending (G1)", cls: "warn" };
    case "G2":
    case "OVERDUE":
      return { icon: "⛔", text: "Overdue (G2)", cls: "danger" };
    default:
      return { icon: "❓", text: status || "UNKNOWN", cls: "info" };
  }
}

function safeText(raw) {
  return String(raw || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderEmpty(msg) {
  const main = $("mainContent") || document.body;
  main.innerHTML = `
    <section class="section">
      <div class="section-head">
        <div class="left">⚠️ No data</div>
      </div>
      <div class="section-body">
        <p class="muted" style="white-space:pre-wrap">${safeText(msg)}</p>
      </div>
    </section>
  `;
  $("loadingSection")?.remove();
}

function kpiScoreTag(score) {
  if (score === 100) return `<span class="tag ok small">100</span>`;
  if (score === 50) return `<span class="tag warn small">50</span>`;
  return `<span class="tag danger small">0</span>`;
}

/* ============================================================
   ✅ LOCAL-FIRST ADAPTER (ENHANCED)
   - Use AnalysisEngine.normalizeGroupName for consistent group naming
   - Prioritize breakdown over kpis (scoring_logic saves both)
   - Ensure weight_final is always populated, never 0 for valid KPIs
============================================================ */

function safeParseJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/* ============================================================
   ✅ SSOT helpers (MRSM_CONFIG)
   - weight trong MRSM_CONFIG có thể là RAW (chưa chắc sum=1)
   - Results dùng weight_effective = weight_raw / sum(weight_raw)
============================================================ */
let __CFG_WEIGHT_SUM = null;

function getCfgWeightSum() {
  if (__CFG_WEIGHT_SUM !== null) return __CFG_WEIGHT_SUM;
  const list = window.MRSM_CONFIG?.kpis;
  if (!Array.isArray(list) || list.length === 0) {
    __CFG_WEIGHT_SUM = 1;
    return __CFG_WEIGHT_SUM;
  }
  __CFG_WEIGHT_SUM = list.reduce((s, k) => s + Number(k?.weight || 0), 0) || 1;
  return __CFG_WEIGHT_SUM;
}

function getKpiMetaSSOT(ruleId) {
  if (!window.MRSM_CONFIG) return null;
  if (typeof window.MRSM_CONFIG.getKpiMeta === "function") {
    try { return window.MRSM_CONFIG.getKpiMeta(ruleId); } catch { /* ignore */ }
  }
  const list = window.MRSM_CONFIG?.kpis;
  if (Array.isArray(list)) {
    return list.find((x) => x && (x.id === ruleId)) || null;
  }
  return null;
}

function getWeightEffectiveFromConfig(ruleId) {
  const meta = getKpiMetaSSOT(ruleId);
  const wRaw = Number(meta?.weight || 0);
  return wRaw / getCfgWeightSum();
}

function getWeightEffectiveFromBackup(ruleId, fallbackLen) {
  // Backup weights (same set as scoring_logic fallback) — used when MRSM_CONFIG isn't ready
  const W = {
    "OP-01": 0.08, "OP-02": 0.08, "OP-03": 0.05, "OP-04": 0.05,
    "CS-01": 0.08, "CS-02": 0.04,
    "PEN-01": 0.08,
    "CO-01": 0.04, "CO-02": 0.05,
    "BR-01": 0.05, "BR-02": 0.05, "BR-03": 0.05,
    "CAT-01": 0.05, "CAT-02": 0.05, "CAT-03": 0.10, "CAT-04": 0.05,
    "SC-01": 0.04, "SC-02": 0.04, "SC-03": 0.02,
  };
  const sum = Object.values(W).reduce((s, v) => s + Number(v || 0), 0) || 1;
  const w = Number(W[String(ruleId || "").toUpperCase()] || 0);
  if (w > 0) return w / sum;
  const n = Number(fallbackLen || 19) || 19;
  return 1 / n;
}


function normalizeTier(rawTier, score) {
  // scoring_logic.js produces human labels; RESULT UI expects enums
  const t = String(rawTier || "").trim().toLowerCase();
  if (!t) return tierFromScore(Number(score || 0));

  if (t === "not ready" || t === "not_ready") return "NOT_READY";
  if (t === "partially ready" || t === "partially_ready") return "PARTIALLY_READY";
  if (t === "near mall-ready" || t === "near mall ready" || t === "near_mall_ready") return "NEAR_MALL_READY";
  if (t === "mall-ready" || t === "mall ready" || t === "mall_ready") return "MALL_READY";
  // already enum?
  if (["NOT_READY", "PARTIALLY_READY", "NEAR_MALL_READY", "MALL_READY"].includes(String(rawTier)))
    return String(rawTier);

  return tierFromScore(Number(score || 0));
}

function bestEffortShopInfo(local) {
  const shopRaw = localStorage.getItem("shop_info");
  const shopInfo = shopRaw ? safeParseJson(shopRaw) : null;

  let shopName =
    shopInfo?.shop_name ||
    shopInfo?.shopName ||
    local?.shop_name ||
    local?.shopName ||
    local?.shop?.shop_name ||
    local?.shop?.shopName;

  let shopId =
    shopInfo?.shop_id ||
    shopInfo?.shopId ||
    local?.shop_id ||
    local?.shopId ||
    local?.shop?.shop_id ||
    local?.shop?.shopId;

  // fallback scan: đôi khi shop info nằm trong key khác
  if (!shopName || !shopId) {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const raw = localStorage.getItem(key);
      if (!raw || !(raw.startsWith("{") || raw.startsWith("["))) continue;
      const obj = safeParseJson(raw);
      if (!obj || typeof obj !== "object") continue;

      const candName = obj.shop_name || obj.shopName || obj?.shop?.shop_name || obj?.shop?.shopName;
      const candId = obj.shop_id || obj.shopId || obj?.shop?.shop_id || obj?.shop?.shopId;

      if (!shopName && candName) shopName = String(candName).trim();
      if (!shopId && candId) shopId = String(candId).trim();
      if (shopName && shopId) break;
    }
  }

  return {
    shop_name: (shopName && String(shopName).trim()) || "—",
    shop_id: (shopId && String(shopId).trim()) || "—",
  };
}

/**
 * ✅ FIX: Use AnalysisEngine for consistent normalization
 * - Priority: breakdown > kpis (scoring_logic saves breakdown first)
 * - Ensure group names are normalized to EN (Operation/Brand/Category/Scale)
 * - Normalize weight_final to sum=1 to avoid 0 contribution
 */
function calcGroupsAndKpisFromLocal(local) {
  // ✅ FIX #1: Prioritize breakdown (from scoring_logic) over kpis
  const sourceKpis = Array.isArray(local?.breakdown)
    ? local.breakdown
    : (Array.isArray(local?.kpis) ? local.kpis : []);

  if (!Array.isArray(sourceKpis) || sourceKpis.length === 0) {
    return { kpis: [], groups: {} };
  }

  const len = sourceKpis.length || 19;

  let kpis = sourceKpis
    .map((k) => {
      const ruleId = k.id || k.rule_id || k.kpiId;
      if (!ruleId) return null;

      const metaSSOT =
        window.MRSM_CONFIG && typeof window.MRSM_CONFIG.getKpiMeta === "function"
          ? window.MRSM_CONFIG.getKpiMeta(ruleId)
          : null;

      const fallbackName = metaSSOT?.name || ruleId;

      // ✅ FIX #2: weight priority - ensure never 0 for valid KPI
      // 1) record weight_final / weight
      // 2) MRSM_CONFIG effective weight
      // 3) Backup effective weight
      // 4) Even split
      const wfRecord = Number(k.weight_final ?? k.weight ?? 0);
      const wfSSOT = getWeightEffectiveFromConfig(ruleId);
      const wfBackup = getWeightEffectiveFromBackup(ruleId, len);
      const wf = wfRecord > 0 ? wfRecord : (wfSSOT > 0 ? wfSSOT : (wfBackup > 0 ? wfBackup : (1 / len)));

      // ✅ FIX #3: Use AnalysisEngine.normalizeGroupName if available, else fallback
      let group = k.group || "";
      if (window.AnalysisEngine && typeof window.AnalysisEngine.normalizeGroupName === "function") {
        group = window.AnalysisEngine.normalizeGroupName(group) || window.AnalysisEngine.defaultGroupOf(ruleId);
      } else {
        // Manual fallback group assignment
        group = group || (
          ruleId.startsWith("OP-") || ruleId.startsWith("CS-") || ruleId.startsWith("PEN-") || ruleId.startsWith("CO-")
            ? "Operation"
            : (ruleId.startsWith("BR-") ? "Brand" :
              (ruleId.startsWith("CAT-") ? "Category" :
                (ruleId.startsWith("SC-") ? "Scale" : "Operation")))
        );
      }

      return {
        rule_id: ruleId,
        name: k.name ?? fallbackName,
        group,
        domain: group, // domain = group for compatibility
        score: Number(k.score ?? 0),
        weight_final: wf,
        value: k.value ?? null,
        meta: k.meta ?? metaSSOT ?? null,
        is_gate: Boolean(k.is_gate ?? false),
      };
    })
    .filter(Boolean);

  // ✅ FIX #4: Normalize weights so sum=1 (stable ImpactGap)
  const sumW = kpis.reduce((s, it) => s + (it.weight_final || 0), 0);
  if (sumW > 0) {
    kpis.forEach((it) => (it.weight_final = (it.weight_final || 0) / sumW));
  }

  // ✅ FIX #5: Calculate group breakdown with normalized weights
  const groups = {};
  ["Operation", "Brand", "Category", "Scale"].forEach((g) => {
    const items = kpis.filter((x) => x.group === g);
    const wsum = items.reduce((s, it) => s + (it.weight_final || 0), 0);
    const contrib = items.reduce((s, it) => s + it.score * (it.weight_final || 0), 0);
    groups[g] = { 
      score: wsum > 0 ? contrib / wsum : 0, 
      contribution: contrib 
    };
  });

  return { kpis, groups };
}

function adaptLocalAssessment(local, forcedAssessmentId) {
  const computedAt = local.computedAt || new Date().toISOString();
  const { kpis, groups } = calcGroupsAndKpisFromLocal(local);
  const shop = bestEffortShopInfo(local);

  // Gate status có thể được tạo bởi KO pages; nếu thiếu thì default UNKNOWN (not PASS)
  const localGateStatus = local?.gate?.status || local?.gateStatus || local?.gate_status || local?.gate_state || "UNKNOWN";

  const localHardFailed = local?.gate?.hard?.failed_rules || local?.hard_failed_rules || local?.hardFailedRules || [];

  const localSoftItems = local?.gate?.soft?.items || local?.soft_items || local?.softItems || {};

  const localSoftDeadline =
    local?.gate?.soft?.deadline_at || local?.soft_deadline_at || local?.softDeadlineAt || null;

  const totalScore = Number(local.totalScore ?? 0);

  return {
    assessment_id: forcedAssessmentId || ("LOCAL_" + computedAt.replace(/[:.]/g, "")),
    evaluated_at: computedAt,
    shop,

    gate: {
      status: localGateStatus,
      hard: { failed_rules: Array.isArray(localHardFailed) ? localHardFailed : [] },
      soft: {
        items: localSoftItems && typeof localSoftItems === "object" ? localSoftItems : {},
        deadline_at: localSoftDeadline,
      },
    },

    mrsm: {
      final_score: totalScore,
      tier: normalizeTier(local.tier, totalScore),
    },

    groups,
    kpis,
  };
}

/* ============================================================
   ✅ RENDER (RESULTS)
============================================================ */
function render(assess) {
  $("loadingSection")?.remove();

  const assessmentId = assess.assessment_id || "—";
  const shopName = assess.shop?.shop_name || "—";
  const shopId = assess.shop?.shop_id || "—";
  const evaluatedAt = assess.evaluated_at ? fmtDateTime(assess.evaluated_at) : "—";

  if (assess.assessment_id) syncDashboardLinks(assess.assessment_id);

  if ($("sideAssessment")) $("sideAssessment").textContent = assessmentId;
  if ($("sideShop")) $("sideShop").textContent = `${shopName} (${shopId})`;

  const gateStatus = assess.gate?.status || "—";
  const gateB = gateBadge(gateStatus);

  const now = new Date();
  const hardFailed = Array.isArray(assess.gate?.hard?.failed_rules) ? assess.gate.hard.failed_rules : [];
  const softItems = assess.gate?.soft?.items || {};
  const softFailedIds = Object.keys(softItems).filter((id) => softItems?.[id] && softItems[id].passed === false);

  const isPass = gateStatus === "PASS";

  const finalScore = isPass ? Number(assess.mrsm?.final_score ?? 0) : 0;
  const computedTier = isPass ? tierFromScore(finalScore) : "GATE_BLOCKED";
  const tier = isPass ? assess.mrsm?.tier || computedTier : "GATE_BLOCKED";
  const tierM = tierMeta(tier);

  const tone = scoreTone(finalScore);

  let calloutCls = "info";
  let calloutTitle = `${gateB.icon} Gate status: ${gateB.text}`;
  let calloutDesc = "";
  let calloutListHtml = "";

  if (gateStatus === "G0") {
    calloutCls = "danger";
    calloutDesc = "Hard KO bị fail. MRSM_Final sẽ bị đặt về 0 cho đến khi pass tất cả Hard KO.";
    calloutListHtml = `
      <div class="list">
        ${(hardFailed.length ? hardFailed : ["(Không có dữ liệu failed_rules)"])
        .map(
          (r) => `
          <div class="li">
            <div class="left">
              <div class="title mono">${safeText(r)}</div>
              <div class="desc">Hard KO failed</div>
            </div>
            <div class="prio">P0</div>
          </div>
        `
        )
        .join("")}
      </div>
    `;
  }

  if (gateStatus === "G1" || gateStatus === "G2") {
    const deadlineIso = assess.gate?.soft?.deadline_at;
    const deadline = deadlineIso ? new Date(deadlineIso) : null;

    if (gateStatus === "G1") {
      calloutCls = "warn";
      calloutDesc =
        "Soft KO đang trong remediation window 7 ngày. Chỉ khi pass hết soft KO mới tính MRSM theo weighted sum.";
    } else {
      calloutCls = "danger";
      calloutDesc = "Soft KO đã quá hạn remediation window. Cần xử lý ngay các Soft KO fail để mở gate.";
    }

    let timeLine = "";
    if (deadline && !Number.isNaN(deadline.getTime())) {
      const diff = deadline.getTime() - now.getTime();
      if (diff >= 0) {
        const left = daysCeil(diff);
        timeLine = `Deadline: <span class="mono">${fmtDateTime(deadlineIso)}</span> • Còn <b>${left}</b> ngày`;
      } else {
        const overdue = daysCeil(-diff);
        timeLine = `Deadline: <span class="mono">${fmtDateTime(deadlineIso)}</span> • Quá hạn <b>${overdue}</b> ngày`;
      }
    } else {
      timeLine = `Deadline: <span class="mono">—</span>`;
    }

    calloutListHtml = `
      <div style="margin-top:10px" class="muted">${timeLine}</div>
      <div class="list">
        ${(softFailedIds.length ? softFailedIds : ["(Không có Soft KO fail)"])
        .map((id) => {
          const note = softItems?.[id]?.note ? ` • Note: ${safeText(softItems[id].note)}` : "";
          return `
            <div class="li">
              <div class="left">
                <div class="title mono">${safeText(id)}</div>
                <div class="desc">Soft KO failed${note}</div>
              </div>
              <div class="prio">P0</div>
            </div>
          `;
        })
        .join("")}
      </div>
    `;
  }

  const calloutHtml = `
    <div class="callout ${calloutCls}">
      <div class="callout-head">${calloutTitle}</div>
      <div class="callout-body">
        ${calloutDesc ? `<p>${calloutDesc}</p>` : ""}
        ${calloutListHtml}
      </div>
    </div>
  `;

  const tierM_cls = tierM.cls || "info";
  const scoreHtml = isPass
    ? `<div class="big ${tone.cls}">${Math.round(finalScore)}</div>`
    : `<div class="big danger">—</div>`;

  const cardHead = `
    <div class="card-head">
      <div class="left">
        <div class="tiny" style="color:#999">MRSM final score</div>
        <div>${scoreHtml}</div>
      </div>
      <div class="right" style="display:flex;flex-direction:column;gap:8px">
        <div class="tier-badge ${tierM_cls}">
          <div class="icon">${tierM.icon}</div>
          <div class="text">${tierM.label}</div>
        </div>
        <div class="tiny" style="color:#999;text-align:right">${tierM.desc}</div>
      </div>
    </div>
  `;

  const groupCards = ["Operation", "Brand", "Category", "Scale"]
    .map((g) => {
      const data = assess.groups?.[g] || { score: 0, contribution: 0 };
      const blocked = !isPass ? " blocked" : "";
      const scoreVal = isPass ? Math.round(data.score) : 0;
      return `
        <div class="group-card${blocked}">
          <div class="label">${g}</div>
          <div class="score">${scoreVal}</div>
          <div class="tiny" style="color:#999">weight: ${(data.contribution || 0).toFixed(2)}</div>
        </div>
      `;
    })
    .join("");

  const allKpis = assess.kpis || [];

  const fixlist = isPass
    ? (() => {
      // ✅ Compute ImpactGap = (100 - score) × weight_final
      const gap = allKpis
        .map((k) => ({
          rule_id: k.rule_id,
          group: k.group,
          name: k.name,
          score: k.score,
          weight: k.weight_final,
          impact: (100 - k.score) * k.weight_final,
        }))
        .filter((x) => x.impact > 0)
        .sort((a, b) => {
          // Tie-break: Operation > Brand > Category > Scale
          const groupOrder = { "Operation": 0, "Brand": 1, "Category": 2, "Scale": 3 };
          const orderDiff = groupOrder[a.group] - groupOrder[b.group];
          if (orderDiff !== 0) return orderDiff;
          return b.impact - a.impact;
        })
        .slice(0, 5);

      return gap;
    })()
    : (() => {
      // ✅ When gate != PASS: show hard KO fail + soft KO fail
      const hardIds = hardFailed || [];
      const softIds = softFailedIds || [];
      const allFailedIds = [...new Set([...hardIds, ...softIds])];

      return allFailedIds
        .map((id) => {
          const kpiObj = allKpis.find((k) => k.rule_id === id);
          if (!kpiObj) return null;

          const isHardFail = hardIds.includes(id);
          const isSoftFail = softIds.includes(id);

          return {
            rule_id: id,
            group: kpiObj.group,
            name: kpiObj.name,
            score: kpiObj.score,
            weight: kpiObj.weight_final,
            impact: 0,
            gateType: isHardFail ? "Hard KO" : (isSoftFail ? "Soft KO" : "Gate"),
          };
        })
        .filter(Boolean)
        .slice(0, 5);
    })();

  const fixlistHtml = fixlist
    .map(
      (item) => `
        <div class="li">
          <div class="left">
            <div class="title mono">${safeText(item.rule_id)}</div>
            <div class="desc">${safeText(item.name)}</div>
          </div>
          <div class="mid">
            <div class="tiny" style="color:#999">${item.group}</div>
            ${isPass
        ? `<div class="tiny">ImpactGap: <b>${item.impact.toFixed(2)}</b></div>`
        : `<div class="tiny">${item.gateType || "Gate"}</div>`
      }
          </div>
          <div class="right">
            ${isPass ? `<span class="tag danger">${item.score}</span>` : `<span class="tag danger">Gate</span>`}
          </div>
        </div>
      `
    )
    .join("");

  const rows = allKpis
    .map((k) => {
      const impactGapVal = isPass ? ((100 - k.score) * k.weight_final).toFixed(2) : "Blocked";
      const impactGapHtml = isPass
        ? `<td>${impactGapVal}</td>`
        : `<td><span class="tag danger">Blocked</span></td>`;

      const tagClass = kpiClassificationTag(k);
      const isHardFail = hardFailed.includes(k.rule_id);
      const isSoftFail = softFailedIds.includes(k.rule_id);
      const extraTags = isHardFail
        ? `<span class="tag danger">Hard KO</span>`
        : (isSoftFail ? `<span class="tag warn">Soft KO</span>` : "");

      const q = `${k.rule_id} ${k.name} ${k.group}`.toLowerCase();

      return `
        <tr data-q="${q}">
          <td><span class="mono">${safeText(k.rule_id)}</span></td>
          <td>${safeText(k.name)}</td>
          <td>
            ${k.gateThreshold !== undefined ? `<span class="tag danger">${safeText(k.gateThreshold)}</span>` : "-"}
          </td>
          <td>t1=${Number(k.meta?.t1 ?? k.t1 ?? "-")}, t2=${Number(k.meta?.t2 ?? k.t2 ?? "-")}</td>
          <td>${kpiScoreTag(k.score)}</td>
          ${impactGapHtml}
          <td>
            <span class="tag ${tagClass.cls}" title="${tagClass.tooltip}">${tagClass.label}</span>
            ${extraTags}
          </td>
        </tr>
      `;
    })
    .join("");

  const dashHref = syncDashboardLinks(assessmentId) || `./DASHBOARD.html?mode=local`;
  const kpiHref = `./KPI_SCORING.html?assessment_id=${encodeURIComponent(assessmentId || "")}`;

  $("mainContent").innerHTML = `
    <section class="section">
      <div class="section-head">
        <div class="left">📊 Assessment Result</div>
        <div class="right">
          <span class="pill">${evaluatedAt}</span>
        </div>
      </div>
      <div class="section-body">
        <div class="card">${cardHead}</div>
        ${calloutHtml}
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <div class="left">🧩 Group breakdown</div>
        <div class="right">
          <span class="pill">Operation • Brand • Category • Scale</span>
          ${isPass ? `<span class="badge ok">✅ Pass gate</span>` : `<span class="badge danger">⛔ Blocked</span>`}
        </div>
      </div>
      <div class="section-body">
        <div class="group-grid">${groupCards}</div>
        ${isPass ? "" : `<div style="margin-top:10px" class="muted">* Gate chưa PASS: group score chỉ để tham khảo (không được xem là kết quả cuối).</div>`}
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <div class="left">🛠️ Fixlist ưu tiên</div>
        <div class="right">
          <span class="pill">${isPass ? "Top 5 ImpactGap" : "P0 Gate fixes only"}</span>
        </div>
      </div>
      <div class="section-body">
        <div class="list">${fixlistHtml}</div>
        <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">
          ${isPass
      ? `<span class="tag info">ImpactGap = (100 - score) × weight_final</span>
                 <span class="tag">Tie-break: Operation &gt; Brand &gt; Category &gt; Scale</span>`
      : `<span class="tag danger">Gate != PASS → Fixlist chỉ gồm hard/soft gate fail</span>
                 <span class="tag">Priority = P0</span>`
    }
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <div class="left">📊 KPI details</div>
        <div class="right">
          <span class="pill">${allKpis.length} KPIs</span>
          ${isPass ? `<span class="badge ok">✅ Score valid</span>` : `<span class="badge danger">⛔ Blocked by gate</span>`}
        </div>
      </div>
      <div class="section-body">
        <div class="toolbar">
          <div class="search">
            <div class="ico">🔎</div>
            <input id="searchInput" placeholder="Tìm KPI theo Rule ID / tên / group..." />
          </div>
          <button class="btn light" id="btnExport" type="button">⬇️ Export JSON</button>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Rule</th>
                <th>KPI</th>
                <th>Gate threshold</th>
                <th>Scoring threshold</th>
                <th>Score</th>
                <th>${isPass ? "ImpactGap" : "Status"}</th>
                <th>Tags</th>
              </tr>
            </thead>
            <tbody id="kpiTbody">
              ${rows || `<tr><td colspan="7" class="muted">Không có KPI.</td></tr>`}
            </tbody>
          </table>
        </div>

        ${!isPass ? `<div style="margin-top:10px" class="muted">* Gate chưa PASS: cột ImpactGap hiển thị Blocked.</div>` : ""}
      </div>
    </section>

    <div class="footer-actions">
      <div class="footer-right" style="margin-left:auto; display:flex; gap:10px; flex-wrap:wrap;">
        <a class="btn light" href="${kpiHref}">🧮 Xem trang KPI</a>
        <a class="btn primary" id="footerDashboardLink" href="${dashHref}">📈 Xem Dashboard (mô tả dữ liệu)</a>
      </div>
    </div>
  `;

  // ✅ Search KPI tại bảng
  const input = $("searchInput");
  const tbody = $("kpiTbody");
  if (input && tbody) {
    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      tbody.querySelectorAll("tr").forEach((tr) => {
        const hay = tr.getAttribute("data-q") || "";
        tr.style.display = !q || hay.includes(q) ? "" : "none";
      });
    });
  }

  // ✅ Export JSON (tải file assessment_*.json)
  $("btnExport")?.addEventListener("click", () => {
    try {
      const blob = new Blob([JSON.stringify(assess, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `assessment_${assessmentId}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast("success", "Export thành công", `Đã tải assessment_${assessmentId}.json`);
    } catch (e) {
      showToast("error", "Export lỗi", e?.message || "Không thể export JSON.");
    }
  });

  // ✅ Sau khi render xong, sync lại link Dashboard để click luôn hoạt động
  if (assess.assessment_id) syncDashboardLinks(assess.assessment_id);
}
/* ============================================================
   ✅ LOAD DATA
   - Nếu có assessment_id -> gọi API
   - Nếu không có assessment_id -> đọc localStorage (assessment_result)
   - Đồng thời lưu assessment_record_local để DASHBOARD đọc được khi mode=local
============================================================ */
async function load() {
  const assessmentId = getQueryParam("assessment_id");

  // ✅ Offline/local mode: không có assessment_id
  if (!assessmentId) {
    const raw = localStorage.getItem("assessment_result");
    const local = raw ? safeParseJson(raw) : null;

    if (local && !requireHardGateEvidenceOrRedirectLocal(local)) return;

    if (!local) {
      renderEmpty("Thiếu assessment_id và không có assessment_result trong localStorage.");
      return;
    }

    const assess = adaptLocalAssessment(local);

    // ✅ LƯU record để DASHBOARD đọc được khi offline/file://
    localStorage.setItem("assessment_record_local", JSON.stringify(assess));
    try { localStorage.setItem(`assessment_record__${assess.assessment_id}`, JSON.stringify(assess)); } catch (_) { }

    render(assess);
    return;
  }

  // ✅ Online-like mode (static hosting / GitHub Pages):
  // Không có backend /api => KHÔNG fetch /api/assessments nữa.
  // Thay vào đó: ưu tiên dữ liệu cache/localStorage.
  try {
    // 1) Ưu tiên record đã cache (dashboard/results flow)
    const cachedRaw = localStorage.getItem("assessment_record_local");
    const cached = cachedRaw ? safeParseJson(cachedRaw) : null;
    if (cached && (cached.assessment_id === assessmentId || cached.assessmentId === assessmentId)) {
      render(cached);
      return;
    }

    // 2) Heuristic scan: tìm trong localStorage object nào có assessment_id khớp
    let found = null;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.includes(assessmentId)) {
        const raw = localStorage.getItem(key);
        const obj = raw ? safeParseJson(raw) : null;
        if (obj && (obj.assessment_id === assessmentId || obj.assessmentId === assessmentId)) {
          found = obj;
          break;
        }
      }
    }
    if (found) {
      localStorage.setItem("assessment_record_local", JSON.stringify(found));
      render(found);
      return;
    }

    // 3) Fallback: nếu có assessment_result (từ scoring_logic) thì adapt để render,
    // và dùng assessment_id trên URL để đồng bộ link/navigation.
    const raw = localStorage.getItem("assessment_result");
    const local = raw ? safeParseJson(raw) : null;
    if (local) {
      if (!requireHardGateEvidenceOrRedirectLocal(local)) return;
      const assess = adaptLocalAssessment(local, assessmentId);
      localStorage.setItem("assessment_record_local", JSON.stringify(assess));
      try { localStorage.setItem(`assessment_record__${assess.assessment_id}`, JSON.stringify(assess)); } catch (_) { }
      render(assess);
      return;
    }

    // 4) Không có dữ liệu local => Empty
    renderEmpty(
      `Không tìm thấy dữ liệu cho assessment_id=${assessmentId}.\n` +
      `Lưu ý: GitHub Pages là static hosting nên KHÔNG có endpoint /api/assessments.\n` +
      `Hãy đảm bảo bạn đi theo flow: KO_GATE → SOFT_KO → KPI_SCORING → RESULTS (dữ liệu sẽ nằm trong localStorage).`
    );
  } catch (err) {
    console.error(err);
    renderEmpty(err?.message || "Không thể tải dữ liệu assessment (local-only mode).");
  }
}


/* ============================================================
   ✅ INIT (chỉ 1 lần)
============================================================ */
document.addEventListener("DOMContentLoaded", load);
