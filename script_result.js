/**
 * ============================================================
 * script_result.js - RESULT PAGE (FINAL FIX)
 * ============================================================
 * ✅ FIX #1: ID container = "#mainRoot" (không phải #mainContent)
 * ✅ FIX #2: Class group card = ".gcard" (không phải .group-card)
 * ✅ FIX #3: Prioritize breakdown over kpis (data source priority)
 * ✅ FIX #4: Ensure weight_final never = 0 (fallback chain)
 * ✅ FIX #5: Normalize group names (VN/EN)
 */

const $ = (id) => document.getElementById(id);

let toastTimer = null;

/* ============================================================
   ✅ Toast helper
============================================================ */
function showToast(type, title, message, ms = 2600) {
  const toast = $("toast");
  if (!toast) return;

  toast.classList.remove("success");
  if (type === "success") toast.classList.add("success");

  const content = toast.querySelector(".content");
  if (!content) return;

  const icon = content.querySelector(".icon");
  const text = content.querySelector(".text");

  if (icon) icon.textContent = type === "success" ? "✓" : "!";
  if (text) {
    const h4 = text.querySelector("h4");
    const p = text.querySelector("p");
    if (h4) h4.textContent = title;
    if (p) p.textContent = message;
  }

  toast.style.display = "block";
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.style.display = "none"), ms);
}

function getQueryParam(name) {
  try {
    return new URL(window.location.href).searchParams.get(name);
  } catch {
    return null;
  }
}

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

function syncDashboardLinks(assessmentId) {
  const isLocal = String(assessmentId || "").startsWith("LOCAL_");
  const dashHref = isLocal
    ? "./DASHBOARD.html?mode=local"
    : `./DASHBOARD.html?assessment_id=${encodeURIComponent(assessmentId)}`;

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
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("vi-VN", { hour12: false });
}

function daysCeil(ms) {
  return Math.ceil(ms / 86400000);
}

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
        desc: "Gần đủ điều kiện (Near Eligible); cần cải thiện thêm một chút.",
      };
    case "PARTIALLY_READY":
      return {
        label: "Partially Ready",
        cls: "warn",
        icon: "🟡",
        desc: "Phần nào sẵn sàng; cần cải thiện nhiều hơn.",
      };
    case "NOT_READY":
      return {
        label: "Not Ready",
        cls: "danger",
        icon: "🔴",
        desc: "Chưa sẵn sàng; cần thực hiện nhiều cải tiến.",
      };
    case "GATE_BLOCKED":
      return {
        label: "Gate Blocked",
        cls: "danger",
        icon: "🚫",
        desc: "Bị chặn bởi gate; cần xử lý các gate fail trước.",
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

function safeParseJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function renderEmpty(msg) {
  const main = $("mainRoot") || document.body;
  main.innerHTML = `
    <section class="section">
      <div class="section-head">
        <div class="left">⚠️ No data</div>
      </div>
      <div class="section-body">
        <p style="white-space:pre-wrap; color:#6B7280">${safeText(msg)}</p>
      </div>
    </section>
  `;
  $("loadingSection")?.remove();
}

/* ============================================================
   ✅ Weight & Config helpers
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
    try { return window.MRSM_CONFIG.getKpiMeta(ruleId); } catch { }
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
  const t = String(rawTier || "").trim().toLowerCase();
  if (!t) return tierFromScore(Number(score || 0));

  if (t === "not ready" || t === "not_ready") return "NOT_READY";
  if (t === "partially ready" || t === "partially_ready") return "PARTIALLY_READY";
  if (t === "near mall-ready" || t === "near mall ready" || t === "near_mall_ready") return "NEAR_MALL_READY";
  if (t === "mall-ready" || t === "mall ready" || t === "mall_ready") return "MALL_READY";
  if (["NOT_READY", "PARTIALLY_READY", "NEAR_MALL_READY", "MALL_READY"].includes(String(rawTier)))
    return String(rawTier);

  return tierFromScore(Number(score || 0));
}

function bestEffortShopInfo(local) {
  const shopRaw = localStorage.getItem("shop_info");
  const shopInfo = shopRaw ? safeParseJson(shopRaw) : null;

  let shopName = shopInfo?.shop_name || shopInfo?.shopName || local?.shop_name || local?.shopName || local?.shop?.shop_name || local?.shop?.shopName;
  let shopId = shopInfo?.shop_id || shopInfo?.shopId || local?.shop_id || local?.shopId || local?.shop?.shop_id || local?.shop?.shopId;

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

/* ============================================================
   ✅ FIX #3-5: calcGroupsAndKpisFromLocal with all fixes
============================================================ */
function calcGroupsAndKpisFromLocal(local) {
  // ✅ FIX #3: Prioritize breakdown over kpis
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

      const metaSSOT = window.MRSM_CONFIG && typeof window.MRSM_CONFIG.getKpiMeta === "function"
        ? window.MRSM_CONFIG.getKpiMeta(ruleId) : null;

      const fallbackName = metaSSOT?.name || ruleId;

      // ✅ FIX #4: Weight fallback chain - ensure never 0
      const wfRecord = Number(k.weight_final ?? k.weight ?? 0);
      const wfSSOT = getWeightEffectiveFromConfig(ruleId);
      const wfBackup = getWeightEffectiveFromBackup(ruleId, len);
      const wf = wfRecord > 0 ? wfRecord : (wfSSOT > 0 ? wfSSOT : (wfBackup > 0 ? wfBackup : (1 / len)));

      // ✅ FIX #5: Normalize group name (VN/EN)
      let group = k.group || "";
      if (window.AnalysisEngine && typeof window.AnalysisEngine.normalizeGroupName === "function") {
        group = window.AnalysisEngine.normalizeGroupName(group) || window.AnalysisEngine.defaultGroupOf(ruleId);
      } else {
        // Manual fallback
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
        domain: group,
        score: Number(k.score ?? 0),
        weight_final: wf,
        value: k.value ?? null,
        meta: k.meta ?? metaSSOT ?? null,
        is_gate: Boolean(k.is_gate ?? false),
      };
    })
    .filter(Boolean);

  // ✅ Normalize weights to sum=1
  const sumW = kpis.reduce((s, it) => s + (it.weight_final || 0), 0);
  if (sumW > 0) {
    kpis.forEach((it) => (it.weight_final = (it.weight_final || 0) / sumW));
  }

  // ✅ Calculate group breakdown
  const groups = {};
  ["Operation", "Brand", "Category", "Scale"].forEach((g) => {
    const items = kpis.filter((x) => x.group === g);
    const wsum = items.reduce((s, it) => s + (it.weight_final || 0), 0);
    const contrib = items.reduce((s, it) => s + it.score * (it.weight_final || 0), 0);
    groups[g] = {
      score: wsum > 0 ? contrib / wsum : 0,
      contribution: contrib,
    };
  });

  return { kpis, groups };
}

function adaptLocalAssessment(local, forcedAssessmentId) {
  const computedAt = local.computedAt || new Date().toISOString();
  const { kpis, groups } = calcGroupsAndKpisFromLocal(local);
  const shop = bestEffortShopInfo(local);

  const localGateStatus = local?.gate?.status || local?.gateStatus || local?.gate_status || "UNKNOWN";
  const localHardFailed = local?.gate?.hard?.failed_rules || local?.hard_failed_rules || [];
  const localSoftItems = local?.gate?.soft?.items || local?.soft_items || {};
  const localSoftDeadline = local?.gate?.soft?.deadline_at || local?.soft_deadline_at || null;
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
   ✅ RENDER (RESULTS) - WITH FIX #1 & FIX #2
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
        .map((r) => `
          <div class="li">
            <div class="left">
              <div class="title mono">${safeText(r)}</div>
              <div class="desc">Hard KO failed</div>
            </div>
            <div class="prio">P0</div>
          </div>
        `).join("")}
      </div>
    `;
  }

  if (gateStatus === "G1" || gateStatus === "G2") {
    const deadlineIso = assess.gate?.soft?.deadline_at;
    const deadline = deadlineIso ? new Date(deadlineIso) : null;

    if (gateStatus === "G1") {
      calloutCls = "warn";
      calloutDesc = "Soft KO đang trong remediation window 7 ngày. Chỉ khi pass hết soft KO mới tính MRSM.";
    } else {
      calloutCls = "danger";
      calloutDesc = "Soft KO đã quá hạn remediation window. Cần xử lý ngay.";
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
        }).join("")}
      </div>
    `;
  }

  // ✅ FIX #1 & #2: Use correct target "#mainRoot" and class ".gcard"
  const mainRoot = $("mainRoot");
  if (!mainRoot) {
    renderEmpty("Cannot find #mainRoot container. Check RESULTS.html.");
    return;
  }

  const allKpis = assess.kpis || [];

  const groupCards = ["Operation", "Brand", "Category", "Scale"]
    .map((g) => {
      const data = assess.groups?.[g] || { score: 0, contribution: 0 };
      const blocked = !isPass ? " blocked" : "";
      const scoreVal = isPass ? Math.round(data.score) : 0;
      // ✅ FIX #2: Use class="gcard" (not .group-card)
      return `
        <div class="gcard${blocked}">
          <div class="t">
            <span class="chip"></span>
            ${g}
          </div>
          <div class="s">
            <div class="val">${scoreVal}</div>
            <div class="contrib">${(data.contribution || 0).toFixed(2)}</div>
          </div>
        </div>
      `;
    })
    .join("");

  const fixlist = isPass
    ? (() => {
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
          const groupOrder = { "Operation": 0, "Brand": 1, "Category": 2, "Scale": 3 };
          const orderDiff = groupOrder[a.group] - groupOrder[b.group];
          if (orderDiff !== 0) return orderDiff;
          return b.impact - a.impact;
        })
        .slice(0, 5);

      return gap;
    })()
    : (() => {
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
          <div style="display:flex;gap:6px;align-items:center">
            <span class="muted" style="font-size:11px">${item.group}</span>
            ${isPass
          ? `<span style="font-size:12px;color:#6B7280;font-weight:700">ImpactGap: ${item.impact.toFixed(2)}</span>`
          : `<span style="font-size:12px;color:#6B7280;font-weight:700">${item.gateType}</span>`
        }
          </div>
          <div class="prio">${isPass ? item.score : "Gate"}</div>
        </div>
      `
    )
    .join("");

  const rows = allKpis
    .map((k) => {
      const impactGapVal = isPass ? ((100 - k.score) * k.weight_final).toFixed(2) : "Blocked";
      const q = `${k.rule_id} ${k.name} ${k.group}`.toLowerCase();

      return `
        <tr data-q="${q}">
          <td><span class="mono">${safeText(k.rule_id)}</span></td>
          <td><span class="kpi-name">${safeText(k.name)}</span></td>
          <td>-</td>
          <td>-</td>
          <td><span class="tag ${k.score === 100 ? 'ok' : k.score === 50 ? 'warn' : 'danger'} small">${k.score}</span></td>
          <td>${impactGapVal}</td>
          <td><span class="tag ok small">KPI</span></td>
        </tr>
      `;
    })
    .join("");

  const kpiHref = `./KPI_SCORING.html?assessment_id=${encodeURIComponent(assessmentId || "")}`;

  mainRoot.innerHTML = `
    <section class="section">
      <div class="section-head">
        <div class="left">📊 Assessment Result</div>
        <div class="right">
          <span class="pill">${evaluatedAt}</span>
        </div>
      </div>
      <div class="section-body">
        <div class="hero">
          <div class="hero-card">
            <div class="hero-top">
              <div class="hero-title">
                <div class="h">🎯 MRSM Final Score</div>
                <div class="sub">
                  <div>${isPass ? 'Gate: PASS ✅' : 'Gate: BLOCKED ⛔'}</div>
                  <div>${tierM.label}</div>
                </div>
              </div>
              <div style="font-size:48px;font-weight:1000;color:${tone.cls === 'ok' ? '#059669' : tone.cls === 'warn' ? '#92400E' : '#DC2626'}">${Math.round(finalScore)}</div>
            </div>
            <div class="kv">
              <div class="item">
                <div class="k">Status</div>
                <div class="v">${tierM.label}</div>
              </div>
              <div class="item">
                <div class="k">Gate</div>
                <div class="v">${gateB.text}</div>
              </div>
            </div>
          </div>
          <div class="hero-card">
            <div class="kv">
              <div class="item">
                <div class="k">Assessment ID</div>
                <div class="v mono">${safeText(assessmentId)}</div>
              </div>
              <div class="item">
                <div class="k">Shop</div>
                <div class="v">${safeText(shopName)}</div>
              </div>
              <div class="item">
                <div class="k">Shop ID</div>
                <div class="v mono">${safeText(shopId)}</div>
              </div>
              <div class="item">
                <div class="k">Evaluated At</div>
                <div class="v mono">${safeText(evaluatedAt)}</div>
              </div>
            </div>
          </div>
        </div>
        <div class="callout ${gateStatus === 'PASS' ? 'ok' : 'danger'}" style="margin-top:18px">
          <h4>${gateB.icon} ${calloutTitle}</h4>
          ${calloutDesc ? `<p>${calloutDesc}</p>` : ""}
          ${calloutListHtml}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <div class="left">🧩 Group breakdown</div>
        <div class="right">
          <span class="pill">Operation • Brand • Category • Scale</span>
          ${isPass ? `<span class="badge ok">✅ Pass</span>` : `<span class="badge danger">⛔ Blocked</span>`}
        </div>
      </div>
      <div class="section-body">
        <div class="group-grid">${groupCards}</div>
        ${!isPass ? `<p style="margin-top:12px;font-size:13px;color:#6B7280">* Gate chưa PASS: group score chỉ tham khảo.</p>` : ""}
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <div class="left">🛠️ Fixlist ưu tiên</div>
        <div class="right">
          <span class="pill">${isPass ? "Top 5 ImpactGap" : "Gate fails"}</span>
        </div>
      </div>
      <div class="section-body">
        <div class="list">${fixlistHtml}</div>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <div class="left">📊 KPI details</div>
        <div class="right">
          <span class="pill">${allKpis.length} KPIs</span>
        </div>
      </div>
      <div class="section-body">
        <div class="toolbar">
          <div class="search">
            <div class="ico">🔎</div>
            <input id="searchInput" placeholder="Tìm KPI..." />
          </div>
          <button class="btn light" id="btnExport" type="button">⬇️ Export JSON</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Rule</th>
                <th>Name</th>
                <th>Gate</th>
                <th>Scoring</th>
                <th>Score</th>
                <th>ImpactGap</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody id="kpiTbody">
              ${rows || `<tr><td colspan="7">Không có KPI</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <div class="footer-actions">
      <a class="btn light" href="${kpiHref}">🧮 Xem KPI</a>
      <a class="btn primary" id="footerDashboardLink" href="./DASHBOARD.html">📈 Dashboard</a>
    </div>
  `;

  // Search
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

  // Export
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
      showToast("success", "Export thành công", `assessment_${assessmentId}.json`);
    } catch (e) {
      showToast("error", "Export lỗi", e?.message || "Không thể export");
    }
  });

  if (assess.assessment_id) syncDashboardLinks(assess.assessment_id);
}

/* ============================================================
   ✅ LOAD DATA
============================================================ */
async function load() {
  const assessmentId = getQueryParam("assessment_id");

  if (!assessmentId) {
    const raw = localStorage.getItem("assessment_result");
    const local = raw ? safeParseJson(raw) : null;

    if (local && !requireHardGateEvidenceOrRedirectLocal(local)) return;

    if (!local) {
      renderEmpty("Thiếu dữ liệu. Hãy chắc bạn đã hoàn thành KPI_SCORING.");
      return;
    }

    const assess = adaptLocalAssessment(local);
    localStorage.setItem("assessment_record_local", JSON.stringify(assess));
    try { localStorage.setItem(`assessment_record__${assess.assessment_id}`, JSON.stringify(assess)); } catch (_) { }

    render(assess);
    return;
  }

  try {
    const cachedRaw = localStorage.getItem("assessment_record_local");
    const cached = cachedRaw ? safeParseJson(cachedRaw) : null;
    if (cached && (cached.assessment_id === assessmentId || cached.assessmentId === assessmentId)) {
      render(cached);
      return;
    }

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

    renderEmpty(`Không tìm dữ liệu cho: ${assessmentId}`);
  } catch (err) {
    console.error(err);
    renderEmpty(err?.message || "Lỗi tải dữ liệu");
  }
}

document.addEventListener("DOMContentLoaded", load);
