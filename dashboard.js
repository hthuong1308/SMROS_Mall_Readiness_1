// ============================================================
// DASHBOARD.JS (Fail-closed + Local-first view)
// - Require: mrsm_config.js, gate-guard.js, recommendation.js loaded BEFORE this file
// - Workflow:
//   + Must have assessment_id context
//   + Must have Hard gate evidence (validatedHardKO) (fail-closed)
//   + Soft gate is allowed NOT PASS (Dashboard shows G0/G1/G2/PASS)
//   + assessment_result is OPTIONAL: if missing -> show empty state (go KPI_SCORING)
// ============================================================

/* global MRSM_CONFIG, GateGuard, RECOMMENDATIONS */

(() => {
    "use strict";

    // ========================
    // DOM helpers / State
    // ========================
    const $ = (id) => document.getElementById(id);

    let assessmentData = null;
    let allKpis = [];
    let sortDirection = "desc";

    document.addEventListener("DOMContentLoaded", () => {
        setLoading(true);

        // Fail-closed dependencies
        if (!window.GateGuard || !window.MRSM_CONFIG) {
            window.location.href = "KO_GATE.html?reason=schema_mismatch";
            return;
        }

        // =========================================
        // Assessment context (GitHub Pages friendly)
        // - Từ RESULTS, link có thể là:
        //   + ?assessment_id=LOCAL_...
        //   + ?mode=local (không kèm assessment_id)
        // Dashboard cần tự "bắt" aid từ query OR current_assessment_id.
        // =========================================
        const qs = new URL(window.location.href).searchParams;
        const isLocalMode = qs.get("mode") === "local" || !qs.get("assessment_id");

        const aidFromQuery = qs.get("assessment_id") || "";
        const aidFromSticky =
            sessionStorage.getItem("current_assessment_id") ||
            localStorage.getItem("current_assessment_id") ||
            "";

        // GateGuard có thể tự suy ra aid (nếu implement có fallback)
        const aidFromGuard =
            (window.GateGuard && typeof window.GateGuard.getAssessmentContext === "function")
                ? (window.GateGuard.getAssessmentContext({ redirectOnMissing: false }) || "")
                : "";

        const aid = aidFromQuery || aidFromSticky || aidFromGuard;

        // Require Hard evidence (fail-closed)
        if (!window.GateGuard.requireHardGateOrRedirect({ redirectOnMissing: true })) return;

        // Soft gate should exist to show G1/G2/PASS properly.
        // If missing -> redirect to SOFT_KO (fail-closed)
        if (!window.GateGuard.requireSoftGateOrRedirect({ redirectOnMissing: true })) return;

        // Nếu không có aid và cũng không có assessment_result/record => show empty (không redirect vòng lặp)
        loadData({ preferredAssessmentId: aid, isLocalMode });
    });

    // ========================
    // SSOT: Soft KO IDs
    // ========================
    const SOFT_KO_IDS = (() => {
        const registry = window.MRSM_CONFIG?.GateRegistry;
        if (registry && Array.isArray(registry.softKoIds) && registry.softKoIds.length) {
            return new Set(registry.softKoIds.map((x) => normalizeKpiId(x)));
        }

        // Fail-closed if missing MRSM_CONFIG GateRegistry
        if (window.GateGuard?.attachReasonAndRedirect) {
            window.GateGuard.attachReasonAndRedirect(
                "./KO_GATE.html",
                window.GateGuard.REASON_CODES.SCHEMA_MISMATCH,
                { cause: "missing_mrsm_config_softko" }
            );
        } else {
            window.location.href = "KO_GATE.html?reason=schema_mismatch";
        }
        return new Set();
    })();

    // ========================
    // Normalizers
    // ========================
    function normalizeKpiId(item) {
        const normalize = (v) =>
            String(v ?? "")
                .trim()
                .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
                .replace(/\s+/g, "")
                .toUpperCase();

        const looksLikeKpi = (s) => /^([A-Z]{2,4}|CAT|PEN|KO)-[A-Z0-9]{2,}$/i.test(s);

        const candidates = [
            item?.kpiId,
            item?.kpi_id,
            item?.KPI_ID,
            item?.rule_id,
            item?.ruleId,
            item?.Rule_ID,
            item?.RuleID,
            item?.kpi_code,
            item?.kpiCode,
            item?.ma_kpi,
            item?.maKpi,
            item?.code,
            item?.metric_id,
            item?.kpi,
            item?.id,
        ];

        for (const c of candidates) {
            const s = normalize(c);
            if (s && looksLikeKpi(s)) return s;
        }

        if (item && typeof item === "object") {
            for (const v of Object.values(item)) {
                const s = normalize(v);
                if (s && looksLikeKpi(s)) return s;
            }
        }

        return normalize(item ?? "");
    }

    function normalizeGroupName(group) {
        const g = String(group || "").trim().toLowerCase();
        if (!g) return "";
        if (g === "operation" || g.includes("ops") || g.includes("vận hành") || g.includes("van hanh")) return "Vận hành";
        if (g === "brand" || g.includes("thương hiệu") || g.includes("thuong hieu")) return "Thương hiệu";
        if (g === "category" || g.includes("danh mục") || g.includes("danh muc")) return "Danh mục";
        if (g === "scale" || g.includes("quy mô") || g.includes("quy mo")) return "Quy mô";
        if (g === "service" || g.includes("dịch vụ") || g.includes("dich vu")) return "Dịch vụ";
        return group;
    }

    function groupOf(kpiId) {
        const id = (kpiId || "").toUpperCase();
        if (id.startsWith("OP-") || id.startsWith("PEN-") || id.startsWith("CO-")) return "Vận hành";
        if (id.startsWith("BR-")) return "Thương hiệu";
        if (id.startsWith("CAT-")) return "Danh mục";
        if (id.startsWith("CS-")) return "Dịch vụ";
        if (id.startsWith("SC-")) return "Quy mô";
        return "Khác";
    }

    // ========================
    // Recommendation accessors
    // ========================
    function getRecommendation(kpiId) {
        try {
            const id = normalizeKpiId(kpiId);
            return window.RECOMMENDATIONS && window.RECOMMENDATIONS[id] ? window.RECOMMENDATIONS[id] : null;
        } catch (_) {
            return null;
        }
    }

    function getRecMeta(kpiId) {
        try {
            const rec = getRecommendation(kpiId);
            if (!rec) return null;
            return rec.meta || rec.rule || rec.threshold || rec.thresholds || rec.scoring || null;
        } catch (_) {
            return null;
        }
    }

    function enrichKpisWithRecMeta(kpis) {
        if (!Array.isArray(kpis)) return kpis;

        return kpis.map((k) => {
            const id = normalizeKpiId(k);
            const meta = getRecMeta(id);
            if (!meta) return k;

            const next = { ...k };

            if (!next.method && meta.method) next.method = String(meta.method).toUpperCase();
            if (!next.direction && meta.direction) next.direction = String(meta.direction).toUpperCase();

            if (next.t1 === undefined || next.t1 === null) {
                if (meta.t1 !== undefined) next.t1 = meta.t1;
                else if (meta.target !== undefined) next.t1 = meta.target;
            }
            if (next.t2 === undefined || next.t2 === null) {
                if (meta.t2 !== undefined) next.t2 = meta.t2;
                else if (meta.min !== undefined) next.t2 = meta.min;
            }

            return next;
        });
    }

    // ========================
    // Gate / Fixlist logic
    // ========================
    function calcImpactGap(item) {
        const score = Number(item?.score ?? 0);
        const w = Number(item?.weight_final ?? item?.weight ?? 0);
        return (100 - score) * (isFinite(w) ? w : 0);
    }

    function estimateEffort(kpiId, group, gateType) {
        if (gateType && gateType !== "NONE") return 2;
        const id = (kpiId || "").toUpperCase();
        const g = (group || "").toLowerCase();

        if (id.startsWith("OP-") || id.startsWith("CS-") || id.startsWith("PEN-") || id.startsWith("CO-")) return 2;
        if (id.startsWith("BR-") || id.startsWith("CAT-")) return 3;
        if (id.startsWith("SC-") || g.includes("quy mô")) return 3;
        return 3;
    }

    function detectGateType(kpiId, kpiItem) {
        const id = normalizeKpiId(kpiId);
        const rec = getRecommendation(id);
        const recGate = String(rec?.gate || "").toUpperCase();

        if (recGate === "HARD_KO") return "HARD_KO";
        if (recGate === "SOFT_KO") return "SOFT_KO";
        if (id.startsWith("KO-")) return "HARD_KO";
        if (SOFT_KO_IDS.has(id)) return "SOFT_KO";

        const g = String(kpiItem?.gate || kpiItem?.gateType || "").toUpperCase();
        if (g === "HARD_KO") return "HARD_KO";
        if (g === "SOFT_KO") return "SOFT_KO";
        return "NONE";
    }

    function priorityOf(kpiId, kpiItem, topImpactThreshold) {
        const gateType = detectGateType(kpiId, kpiItem);
        if (gateType !== "NONE") return "P0";

        const impactGap = calcImpactGap(kpiItem);
        if (!(impactGap > 0)) return "P3";
        if (impactGap >= topImpactThreshold) return "P1";
        return "P2";
    }

    function parseDeadlineFromRecOrItem(kpiId, item) {
        const rec = getRecommendation(kpiId);
        const d = rec?.canh_bao?.deadline || item?.deadline || item?.meta?.deadline;
        if (!d) return null;

        const s = String(d).trim();
        const iso = Date.parse(s);
        if (!Number.isNaN(iso)) return new Date(iso);

        const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        return null;
    }

    function domainRank(kpiId, item) {
        const id = normalizeKpiId(kpiId);
        const gateType = detectGateType(id, item);

        if (gateType === "HARD_KO" || id.startsWith("KO-")) return 0;
        if (id.startsWith("OP-") || id.startsWith("PEN-") || id.startsWith("CO-")) return 1;
        if (id.startsWith("CS-")) return 2;
        return 3;
    }

    function buildFixlist(breakdownItems) {
        const items = (breakdownItems || []).map((k) => {
            const kpiId = normalizeKpiId(k);
            const group = normalizeGroupName(k.group) || groupOf(kpiId);
            const gateType = detectGateType(kpiId, k);
            const impactGap = calcImpactGap(k);
            const effort = Number(k.effort ?? k.meta?.effort ?? estimateEffort(kpiId, group, gateType));

            return {
                ...k,
                kpiId,
                group,
                gateType,
                impactGap,
                effort,
            };
        });

        const nonP0 = items.filter((it) => it.gateType === "NONE" && it.impactGap > 0);
        const impacts = nonP0.map((it) => it.impactGap).sort((a, b) => b - a);
        const idx = Math.max(0, Math.floor(impacts.length * 0.2) - 1);
        const top20 = impacts.length ? impacts[idx] : Infinity;

        for (const it of items) {
            it.priority = priorityOf(it.kpiId, it, top20);
            it.deadline = parseDeadlineFromRecOrItem(it.kpiId, it);
        }

        items.sort((a, b) => {
            const aRank = domainRank(a.kpiId, a);
            const bRank = domainRank(b.kpiId, b);
            if (aRank !== bRank) return aRank - bRank;

            const aP = { P0: 0, P1: 1, P2: 2, P3: 3 }[a.priority] ?? 3;
            const bP = { P0: 0, P1: 1, P2: 2, P3: 3 }[b.priority] ?? 3;
            if (aP !== bP) return aP - bP;

            if (Math.abs(b.impactGap - a.impactGap) > 0.01) return b.impactGap - a.impactGap;
            if (a.effort !== b.effort) return a.effort - b.effort;

            if (a.deadline && b.deadline) return a.deadline - b.deadline;
            if (a.deadline) return -1;
            if (b.deadline) return 1;
            return 0;
        });

        return { items, top20Threshold: top20 };
    }

    // ========================
    // Load + Adapt
    // ========================
    function loadData(opts = {}) {
        const resultKey = window.MRSM_CONFIG?.ASSESSMENT_RESULT_KEY || "assessment_result";
        const preferredAssessmentId = String(opts.preferredAssessmentId || "").trim();
        const isLocalMode = !!opts.isLocalMode;

        // ================================
        // GitHub Pages local-first hydrate
        // Priority:
        // 1) assessment_record__{aid}
        // 2) assessment_record_local (nếu match aid hoặc local mode)
        // 3) scan localStorage: assessment_record__* (latest)
        // 4) assessment_result (latest facts)
        // 5) legacy assessmentData
        // ================================
        const candidates = [];
        if (preferredAssessmentId) {
            // record schema (preferred)
            candidates.push(`assessment_record__${preferredAssessmentId}`);
            // raw result facts schema (optional)
            candidates.push(`assessment_result__${preferredAssessmentId}`);
        }
        // latest caches
        candidates.push("assessment_record_local");
        candidates.push("assessment_record_latest");
        // legacy/global keys
        candidates.push(resultKey);
        candidates.push("assessmentData");

        const tryParse = (raw) => {
            try {
                return raw ? JSON.parse(raw) : null;
            } catch {
                return null;
            }
        };

        // 1/2/4/5 direct candidates
        let parsed = null;
        for (const key of candidates) {
            const raw = localStorage.getItem(key);
            const obj = tryParse(raw);
            if (!obj) continue;

            // If we have a preferred aid, ensure match when possible
            const objAid = String(obj.assessment_id || obj.assessmentId || obj.id || "");
            if (preferredAssessmentId) {
                if (key === "assessment_record_local") {
                    // local mode may not store exact id on older builds, allow
                    if (isLocalMode || objAid === preferredAssessmentId) {
                        parsed = obj;
                        break;
                    }
                } else if (objAid === preferredAssessmentId || key === resultKey || String(key).startsWith("assessment_result__")) {
                    // assessment_result is global (latest) so accept as fallback
                    // assessment_result__{aid} may not embed assessment_id, still accept
                    parsed = obj;
                    break;
                }
            } else {
                // no preferred id => accept first valid
                parsed = obj;
                break;
            }
        }

        // 3) scan latest assessment_record__*
        if (!parsed) {
            let best = null;
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k || !k.startsWith("assessment_record__")) continue;
                const obj = tryParse(localStorage.getItem(k));
                if (!obj) continue;

                const ts = obj.assessed_at || obj.timestamp || obj.computedAt || obj.evaluated_at || obj.evaluatedAt;
                const t = ts ? new Date(ts).getTime() : 0;
                const bestT = best?.__t || 0;
                if (!best || t > bestT) best = { __t: t, obj };
            }
            if (best && best.obj) parsed = best.obj;
        }

        // No result yet => show empty dashboard state (but still keep gate context)
        if (!parsed) {
            showEmptyState();
            return;
        }

        // Fail-closed: if in local mode without hard evidence anywhere => KO_GATE
        if (isLocalMode) {
            const hardRaw = sessionStorage.getItem(window.MRSM_CONFIG?.HARD_GATE_KEY || "validatedHardKO");
            const hasHard = !!hardRaw;

            const maybeGate = parsed?.gate || parsed?.Gate || parsed?.soft_ko_gate || {};
            const hasHardInPayload = !!(maybeGate?.hard?.verified_at || maybeGate?.hard?.verifiedAt || parsed?.hard_verified_at);

            if (!hasHard && !hasHardInPayload) {
                window.location.href = "./KO_GATE.html";
                return;
            }
        }

        // Sticky aid for cross-page navigation
        try {
            const aid = String(parsed.assessment_id || parsed.assessmentId || preferredAssessmentId || "");
            if (aid) {
                sessionStorage.setItem("current_assessment_id", aid);
                localStorage.setItem("current_assessment_id", aid);
            }
        } catch (_) { /* ignore */ }

        try {
            assessmentData = adaptLocalData(parsed);
            renderDashboard();
        } catch (err) {
            console.error("[Dashboard] Failed to render:", err);
            try { setLoading(false); } catch (_) { }

            // Show a minimal error message instead of freezing the overlay
            const overlay = document.getElementById("loadingOverlay");
            if (overlay) {
                overlay.style.display = "block";
                overlay.innerHTML = `
                  <div style="padding:18px;max-width:720px">
                    <div style="font-weight:800;font-size:16px;margin-bottom:6px">Không thể render Dashboard</div>
                    <div style="opacity:.85;line-height:1.5">
                      Mở DevTools (F12) &gt; Console để xem lỗi chi tiết.<br/>
                      Gợi ý: kiểm tra schema <code>assessment_result</code> / <code>assessment_record_local</code> và fixlist/breakdown có phải mảng hay không.
                    </div>
                  </div>
                `;
            }
        }
    }

    function normalizeGateFromSnapshot(local) {
        // Prefer snapshot inside result payload; fallback to current GateGuard storages
        const snap = local?.gate || local?.Gate || local?.soft_ko_gate || {};

        // If payload doesn't include gate info, build from live storages (best-effort)
        const soft = window.MRSM_CONFIG?.getSoftGate?.() || window.GateGuard?.getSoftGate?.() || null;
        const hard = window.MRSM_CONFIG?.getHardGate?.() || window.GateGuard?.getHardGate?.() || null;

        const gate = (snap && typeof snap === "object") ? { ...snap } : {};

        // Normalize gate.status
        let gateStatus = gate.status || gate.gate_status || gate.Gate_Status || "";

        // If snapshot lacks status, infer from soft gate status
        if (!gateStatus && soft?.gate_status) gateStatus = soft.gate_status;

        if (gateStatus) {
            const st = String(gateStatus).toUpperCase();
            if (st === "HARD_FAIL" || st === "HARD_KO" || st === "FAIL") gate.status = "G0";
            else if (st === "SOFT_PENDING" || st === "SOFT_KO" || st === "PENDING" || st === "G1") gate.status = "G1";
            else if (st === "SOFT_OVERDUE" || st === "OVERDUE" || st === "G2") gate.status = "G2";
            else if (st === "PASS") gate.status = "PASS";
            else if (st === "G0" || st === "G1" || st === "G2") gate.status = st;
            else gate.status = "UNKNOWN";
        } else {
            gate.status = "UNKNOWN";
        }

        // Attach hard/soft snapshots for detail rendering if missing
        if (!gate.hard && hard) gate.hard = hard;
        if (!gate.soft && soft) gate.soft = soft;

        // Attach pending/failed list best-effort (optional)
        // If your gate schema already has failed_kpis/pending_kpis, keep it.
        if (gate.status === "G1" || gate.status === "G2") {
            if (!gate.soft) gate.soft = soft || gate.soft || {};
            if (gate.soft && !Array.isArray(gate.soft.pending_kpis) && gate.soft.items && typeof gate.soft.items === "object") {
                const pending = Object.entries(gate.soft.items)
                    .filter(([, v]) => v && v.passed === false)
                    .map(([k]) => normalizeKpiId(k));
                gate.soft.pending_kpis = pending;
            }
            if (gate.soft && !gate.soft.deadline_at && gate.soft.deadline_at !== 0) {
                if (gate.soft.deadline_at === undefined && soft?.soft?.deadline_at) gate.soft.deadline_at = soft.soft.deadline_at;
                if (gate.soft.deadline_at === undefined && soft?.deadline_at) gate.soft.deadline_at = soft.deadline_at;
            }
        }

        return gate;
    }

    function adaptLocalData(local) {
        const asmID = local.assessment_id || local.assessmentId || local.id || ("ASM-" + Date.now());
        const category = local.category || local.loai || "Không rõ";
        const assessedAt = local.assessed_at || local.timestamp || local.computedAt || new Date().toISOString();

        const gateInfo = normalizeGateFromSnapshot(local);

        // KPI items
        let kpis = [];
        const bdRaw = local.breakdown || local.kpis || local.results || local.mrsm?.breakdown || [];

        const bd = Array.isArray(bdRaw)
            ? bdRaw
            : (bdRaw && typeof bdRaw === "object")
                ? Object.values(bdRaw)
                : [];

        for (const k of bd) {
            const value =
                (k.value !== undefined && k.value !== null) ? k.value
                    : (k.raw_value !== undefined && k.raw_value !== null) ? k.raw_value
                        : (k.actual !== undefined && k.actual !== null) ? k.actual
                            : (k.val !== undefined && k.val !== null) ? k.val
                                : null;

            const pid = normalizeKpiId(k);
            const g = normalizeGroupName(k.group) || groupOf(pid);

            kpis.push({
                rule_id: pid,
                kpiId: pid,
                group: g,
                title: k.title || k.name || k.ten_kpi || k.kpi_name || pid,
                score: Number(k.score ?? 0),
                weight: Number(k.weight ?? 0),
                weight_final: Number(k.weight_final ?? k.weightFinal ?? k.weight ?? 0),
                method: k.method || k.phuong_phap || null,
                direction: k.direction || k.huong || null,
                t1: (k.t1 ?? k.target ?? null),
                t2: (k.t2 ?? k.min ?? null),
                value,
                raw_value: value,
                gate: k.gate || k.gateType || null,
                meta: k.meta || {},
            });
        }

        kpis = enrichKpisWithRecMeta(kpis);

        const totalWeight = kpis.reduce((sum, k) => sum + (k.weight_final || 0), 0);
        const weightedSum = kpis.reduce((sum, k) => sum + (k.score || 0) * (k.weight_final || 0), 0);
        const overallScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;

        return {
            assessment_id: asmID,
            category,
            assessed_at: assessedAt,
            overallScore,
            gate: gateInfo,
            kpis,
            groups: calcGroups(kpis),
        };
    }

    function calcGroups(kpis) {
        const map = {};
        for (const k of (kpis || [])) {
            const g = normalizeGroupName(k.group) || "Khác";
            if (!map[g]) map[g] = { name: g, totalWeight: 0, weightedSum: 0, count: 0 };
            map[g].totalWeight += (k.weight_final || 0);
            map[g].weightedSum += (Number(k.score || 0) * (k.weight_final || 0));
            map[g].count += 1;
        }

        const groups = Object.keys(map).map((key) => {
            const info = map[key];
            const avgScore = info.totalWeight > 0 ? Math.round(info.weightedSum / info.totalWeight) : 0;
            return { name: info.name, avgScore, count: info.count };
        });

        groups.sort((a, b) => b.avgScore - a.avgScore);
        return groups;
    }

    // ========================
    // Render
    // ========================
    function renderDashboard() {
        if (!assessmentData) {
            showEmptyState();
            return;
        }

        // Build KPI list normalized
        allKpis = (assessmentData.kpis || []).map((k) => {
            const pid = normalizeKpiId(k);
            const g = normalizeGroupName(k.group) || groupOf(pid);
            return {
                ...k,
                rule_id: pid,
                kpiId: pid,
                group: g,
                score: Number(k.score ?? 0),
                weight_final: Number(k.weight_final ?? k.weight ?? 0),
            };
        });

        allKpis = enrichKpisWithRecMeta(allKpis);
        assessmentData.groups = calcGroups(allKpis);

        // Storytelling: 3-second comprehension
        renderGateStatus();
        renderOverallScore();
        renderInsights();
        renderGroupChart();
        renderParetoChart();
        renderDistChart();
        renderPriorityMap();
        renderTrend();

        // Action: fixlist + table
        renderFixlist();
        renderKpiTable();

        // Bind controls once
        bindDashboardControls();

        // Done loading
        setLoading(false);
    }

    function renderGateStatus() {
        const container = $("gateStatus");
        if (!container) return;

        const badge = container.querySelector(".gate-badge");
        const desc = container.querySelector(".gate-description");

        const st = (assessmentData?.gate?.status || "UNKNOWN").toUpperCase();
        let cls = "unknown", icon = "❔", title = "Gate: UNKNOWN", detail = "Không đủ dữ liệu Gate. Vui lòng kiểm tra lại luồng KO.";

        if (st === "PASS") {
            cls = "pass"; icon = "✅"; title = "Gate: PASS";
            detail = "Đã qua Hard KO và Soft KO. Điểm MRSM được tính bình thường.";
        } else if (st === "G0") {
            cls = "g0"; icon = "⛔"; title = "Gate: G0 (Hard KO Failed)";
            detail = "Thiếu/không đạt điều kiện bắt buộc (Hard KO). MRSM_Final = 0.";
        } else if (st === "G1") {
            cls = "g1"; icon = "⏳"; title = "Gate: G1 (Soft KO Pending)";
            detail = "Đang trong 7 ngày khắc phục Soft KO. Chưa đủ điều kiện tính điểm.";
        } else if (st === "G2") {
            cls = "g2"; icon = "⚠️"; title = "Gate: G2 (Soft KO Overdue)";
            detail = "Quá hạn khắc phục Soft KO. Chưa đủ điều kiện tính điểm.";
        }

        if (badge) {
            badge.textContent = `${icon} ${title}`;
            badge.classList.remove("pass", "g0", "g1", "g2", "unknown");
            badge.classList.add(cls);
        }
        if (desc) desc.textContent = detail;

        // Warning strip
        const warn = $("gateWarning");
        const warnText = $("gateWarningText");
        if (warn && warnText) {
            if (st !== "PASS") {
                warn.style.display = "flex";
                warnText.textContent = "Gate chưa PASS → hệ thống sẽ fail-closed: MRSM_Final = 0 và Fixlist ưu tiên P0 (nếu có).";
            } else {
                warn.style.display = "none";
            }
        }
    }

    function renderOverallScore() {
        // Sidebar score components in DASHBOARD.html
        const scoreEl = $("totalScoreDisplay");
        const arc = $("scoreArc");
        const tierBadge = $("tierBadge");
        const tierNote = $("tierNote");

        // New storytelling widgets
        const needle = $("gaugeNeedle");
        const progress = $("gaugeProgress");
        const tlBadge = $("trafficLightBadge");
        const tlText = $("trafficLightText");

        const gateStatus = (assessmentData?.gate?.status || "UNKNOWN").toUpperCase();
        const rawScore = Number(assessmentData?.overallScore ?? 0);
        const score = (gateStatus === "PASS") ? Math.max(0, Math.min(100, Math.round(rawScore))) : 0;

        // --- Donut ---
        if (scoreEl) scoreEl.textContent = String(score);

        if (arc) {
            const CIRC = 534; // pre-set in HTML
            const pct = score / 100;
            const offset = Math.round(CIRC * (1 - pct));
            arc.setAttribute("stroke-dashoffset", String(offset));

            // Color by traffic-light
            let stroke = "var(--nguy-hiem)";
            if (score >= 70) stroke = "var(--xanh)";
            else if (score >= 50) stroke = "var(--cam)";
            arc.setAttribute("stroke", stroke);
        }

        // --- Tier badge + note ---
        const t = tiering(score);
        if (tierBadge) {
            tierBadge.textContent = `${t.icon} ${t.label}`;
            tierBadge.classList.remove("tier-not-ready", "tier-partial", "tier-near", "tier-ready");
            tierBadge.classList.add(t.cls);
        }
        if (tierNote) tierNote.textContent = t.note;

        // --- Gauge (semi-circle) ---
        // Map score 0..100 => -90..90 degrees
        const angle = -90 + (score * 180 / 100);
        if (needle) needle.style.transform = `rotate(${angle}deg)`;

        if (progress) {
            // Path length ~ 314 (depends on SVG). We'll compute dynamically if possible.
            try {
                const len = progress.getTotalLength();
                progress.style.strokeDasharray = `${len}`;
                progress.style.strokeDashoffset = `${Math.max(0, Math.min(len, len * (1 - score / 100)))}`;
            } catch (_) {
                // best-effort fallback
            }

            let stroke = "var(--nguy-hiem)";
            if (score >= 70) stroke = "var(--xanh)";
            else if (score >= 50) stroke = "var(--cam)";
            progress.style.stroke = stroke;
        }

        // --- Traffic light ---
        const tl = trafficLight(score);
        if (tlBadge) {
            tlBadge.textContent = tl.dot;
            tlBadge.classList.remove("red", "orange", "green");
            tlBadge.classList.add(tl.cls);
        }
        if (tlText) tlText.textContent = tl.text;

        // Optional: summary header fields
        const shopName = $("shopName");
        const shopId = $("shopId");
        const computedAt = $("computedAt");
        const assessmentId = $("assessmentId");
        if (shopName) shopName.textContent = assessmentData?.shop?.name || assessmentData?.shop?.shop_name || "—";
        if (shopId) shopId.textContent = assessmentData?.shop?.id || assessmentData?.shop?.shop_id || "—";
        if (computedAt) computedAt.textContent = formatDateTime(assessmentData?.computedAt || assessmentData?.evaluatedAt);
        if (assessmentId) assessmentId.textContent = assessmentData?.assessmentId || "—";
    }

    function renderGroups() {
        const el = $("groups-section");
        if (!el) return;

        const groups = assessmentData.groups || [];
        if (groups.length === 0) {
            el.innerHTML = '<p style="color: var(--chu-phu);">Không có nhóm KPI.</p>';
            return;
        }

        let html = '<div class="groups-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">';
        for (const g of groups) {
            let color = "var(--nguy-hiem)";
            if (g.avgScore >= 80) color = "var(--xanh)";
            else if (g.avgScore >= 60) color = "var(--canh-bao)";

            html += `
        <div class="group-card" style="padding: 16px; background: var(--trang); border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.08);">
          <div style="font-size: 14px; font-weight: 600; color: var(--chu); margin-bottom: 8px;">${escapeHtml(g.name)}</div>
          <div style="font-size: 32px; font-weight: 700; color: ${color};">${g.avgScore}</div>
          <div style="font-size: 13px; color: var(--chu-phu); margin-top: 4px;">${g.count} KPI</div>
        </div>
      `;
        }
        html += "</div>";
        el.innerHTML = html;
    }

    function renderFixlist() {
        const el = $("fixlist-section");
        if (!el) return;

        const { items: fixItems } = buildFixlist(allKpis);
        const show = fixItems.filter((it) => it.gateType !== "NONE" || it.impactGap > 0);

        if (show.length === 0) {
            el.innerHTML = '<p style="color: var(--chu-phu);">Không có mục nào cần ưu tiên.</p>';
            return;
        }

        const top8 = show.slice(0, 8);

        let html = '<div class="fixlist-grid" style="display: grid; gap: 12px;">';
        for (const it of top8) {
            const prioColor = { P0: "var(--nguy-hiem)", P1: "var(--cam)", P2: "var(--canh-bao)", P3: "var(--chu-phu)" }[it.priority] || "var(--chu-phu)";
            const gateLabel = it.gateType === "HARD_KO" ? "🚫 Hard KO" : it.gateType === "SOFT_KO" ? "⏳ Soft KO" : "";
            const kpiIdArg = JSON.stringify(it.kpiId);

            html += `
        <div class="fixlist-item"
             style="padding: 14px; background: var(--trang); border-radius: 6px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); cursor: pointer; transition: box-shadow 0.2s;"
             onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,0.15)'"
             onmouseout="this.style.boxShadow='0 1px 4px rgba(0,0,0,0.08)'"
             onclick="renderRecommendationModal(${kpiIdArg})">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
            <span style="font-weight:700;color:${prioColor};font-size:12px;">${it.priority}</span>
            ${gateLabel ? `<span style="font-size:12px;color:var(--nguy-hiem);">${gateLabel}</span>` : ""}
          </div>
          <div style="font-weight:600;color:var(--chu);margin-bottom:4px;">${escapeHtml(it.title || it.kpiId)}</div>
          <div style="font-size:13px;color:var(--chu-phu);">
            Điểm: ${Number(it.score ?? 0)} • Gap: ${Number(it.impactGap ?? 0).toFixed(1)} • Nỗ lực: ${Number(it.effort ?? 0)}
          </div>
        </div>
      `;
        }
        html += "</div>";
        el.innerHTML = html;
    }

    function renderKpiTable() {
        const el = $("kpi-table-section");
        if (!el) return;

        const filtered = allKpis;

        if (filtered.length === 0) {
            el.innerHTML = '<p style="color: var(--chu-phu);">Không có KPI nào.</p>';
            return;
        }

        const tableHtml = `
      <div class="table-desktop" style="overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse; background: var(--trang); border-radius: 8px; overflow: hidden;">
          <thead>
            <tr style="background: var(--nen-phu); color: var(--chu);">
              <th style="padding: 12px; text-align: left; font-weight: 600;">Ưu tiên</th>
              <th style="padding: 12px; text-align: left; font-weight: 600;">KPI</th>
              <th style="padding: 12px; text-align: left; font-weight: 600;">Nhóm</th>
              <th style="padding: 12px; text-align: center; font-weight: 600;">Điểm</th>
              <th style="padding: 12px; text-align: center; font-weight: 600;">Trọng số</th>
              <th style="padding: 12px; text-align: left; font-weight: 600;">Impact</th>
              <th style="padding: 12px; text-align: center; font-weight: 600;">Hành động</th>
            </tr>
          </thead>
          <tbody>
            ${renderTableRows(filtered)}
          </tbody>
        </table>
      </div>
      <div class="table-mobile" style="display:none;">
        ${renderMobileCards(filtered)}
      </div>
    `;

        el.innerHTML = tableHtml;
    }

    function renderTableRows(kpis) {
        const { items: fixItems } = buildFixlist(allKpis);
        const prioMap = new Map();
        for (const it of fixItems) prioMap.set(it.kpiId, { priority: it.priority, impactGap: it.impactGap, gateType: it.gateType });

        const maxImpact = Math.max(...fixItems.map((x) => x.impactGap || 0), 0.0001);

        let html = "";
        for (const k of kpis) {
            const pid = normalizeKpiId(k.kpiId || k.rule_id || k);
            const info = prioMap.get(pid) || { priority: "P3", impactGap: 0, gateType: "NONE" };
            const prioColor = { P0: "var(--nguy-hiem)", P1: "var(--cam)", P2: "var(--canh-bao)", P3: "var(--chu-phu)" }[info.priority] || "var(--chu-phu)";

            let scoreColor = "var(--nguy-hiem)";
            if (k.score >= 80) scoreColor = "var(--xanh)";
            else if (k.score >= 60) scoreColor = "var(--canh-bao)";

            let impactBarHtml = "";
            if (info.gateType === "NONE") {
                const barWidth = Math.min(100, Math.max(0, (info.impactGap / maxImpact) * 100));
                let barColor = "var(--chu-phu)";
                if (info.impactGap >= 10) barColor = "var(--cam)";
                if (info.impactGap >= 20) barColor = "var(--nguy-hiem)";

                impactBarHtml = `
          <div style="width:100%;max-width:120px;height:8px;background:var(--nen-phu);border-radius:4px;overflow:hidden;">
            <div style="width:${barWidth}%;height:100%;background:${barColor};"></div>
          </div>
          <span style="font-size:12px;color:var(--chu-phu);margin-left:6px;">${Number(info.impactGap).toFixed(1)}</span>
        `;
            } else {
                impactBarHtml = '<span style="font-size: 12px; color: var(--chu-phu);">—</span>';
            }

            const kpiIdArg = JSON.stringify(pid);

            html += `
        <tr onclick="renderRecommendationModal(${kpiIdArg})" style="border-bottom: 1px solid var(--vien); cursor: pointer;">
          <td style="padding: 12px;">
            <span style="display:inline-block;padding:4px 8px;background:${prioColor};color:var(--trang);border-radius:4px;font-size:11px;font-weight:700;">
              ${info.priority}
            </span>
          </td>
          <td style="padding: 12px; font-weight: 600; color: var(--chu);">${escapeHtml(k.title || pid)}</td>
          <td style="padding: 12px; color: var(--chu-phu);">${escapeHtml(k.group || groupOf(pid))}</td>
          <td style="padding: 12px; text-align: center; font-weight: 700; color: ${scoreColor};">${Number(k.score ?? 0)}</td>
          <td style="padding: 12px; text-align: center; color: var(--chu-phu);">${(Number(k.weight_final ?? 0) * 100).toFixed(0)}%</td>
          <td style="padding: 12px;"><div style="display:flex;align-items:center;">${impactBarHtml}</div></td>
          <td style="padding: 12px; text-align: center;">
            <button onclick="event.stopPropagation(); renderRecommendationModal(${kpiIdArg})"
                    style="padding: 6px 12px; background: var(--xanh); color: var(--trang); border: none; border-radius: 4px; font-size: 13px; font-weight: 600; cursor: pointer;">
              Chi tiết
            </button>
          </td>
        </tr>
      `;
        }
        return html;
    }

    function renderMobileCards(kpis) {
        const { items: fixItems } = buildFixlist(allKpis);
        const prioMap = new Map();
        for (const it of fixItems) prioMap.set(it.kpiId, { priority: it.priority, impactGap: it.impactGap, gateType: it.gateType });

        let html = '<div style="display: grid; gap: 12px;">';
        for (const k of kpis) {
            const pid = normalizeKpiId(k.kpiId || k.rule_id || k);
            const info = prioMap.get(pid) || { priority: "P3", impactGap: 0, gateType: "NONE" };
            const prioColor = { P0: "var(--nguy-hiem)", P1: "var(--cam)", P2: "var(--canh-bao)", P3: "var(--chu-phu)" }[info.priority] || "var(--chu-phu)";

            let scoreColor = "var(--nguy-hiem)";
            if (k.score >= 80) scoreColor = "var(--xanh)";
            else if (k.score >= 60) scoreColor = "var(--canh-bao)";

            const kpiIdArg = JSON.stringify(pid);

            html += `
        <div class="mobile-card"
             style="padding:14px;background:var(--trang);border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,0.08);cursor:pointer;"
             onclick="renderRecommendationModal(${kpiIdArg})">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <span style="display:inline-block;padding:4px 8px;background:${prioColor};color:var(--trang);border-radius:4px;font-size:11px;font-weight:700;">
              ${info.priority}
            </span>
            <span style="font-size:24px;font-weight:700;color:${scoreColor};">${Number(k.score ?? 0)}</span>
          </div>
          <div style="font-weight:600;color:var(--chu);margin-bottom:4px;">${escapeHtml(k.title || pid)}</div>
          <div style="font-size:13px;color:var(--chu-phu);margin-bottom:8px;">
            ${escapeHtml(k.group || groupOf(pid))} • Trọng số: ${(Number(k.weight_final ?? 0) * 100).toFixed(0)}%
          </div>
          <button onclick="event.stopPropagation(); renderRecommendationModal(${kpiIdArg})"
                  style="padding:6px 12px;background:var(--xanh);color:var(--trang);border:none;border-radius:4px;font-size:13px;font-weight:600;cursor:pointer;width:100%;">
            Xem chi tiết
          </button>
        </div>
      `;
        }
        html += "</div>";
        return html;
    }

    // ========================
    // Modal (simple + safe)
    // ========================
    window.renderRecommendationModal = function renderRecommendationModal(kpiIdRaw) {
        const modal = $("recommendation-modal");
        const modalBody = $("modal-body");
        if (!modal || !modalBody) return;

        const kpiId = normalizeKpiId(kpiIdRaw);
        const item = allKpis.find((x) => normalizeKpiId(x) === kpiId);
        if (!item) return;

        const rec = getRecommendation(kpiId);

        const impactGap = calcImpactGap(item);
        const score = Number(item?.score ?? 0);
        const w = Number(item?.weight_final ?? 0);

        const gateType = detectGateType(kpiId, item);
        let gateLabel = "";
        if (gateType === "HARD_KO") gateLabel = '<span style="color: var(--nguy-hiem); font-weight: 700;">🚫 Hard KO</span>';
        else if (gateType === "SOFT_KO") gateLabel = '<span style="color: var(--canh-bao); font-weight: 700;">⏳ Soft KO</span>';

        modalBody.innerHTML = `
      <div class="modal-header" style="border-bottom:2px solid var(--vien);padding-bottom:12px;margin-bottom:16px;">
        <h3 style="margin:0;font-size:20px;font-weight:700;color:var(--chu);">${escapeHtml(rec?.ten_kpi || item?.title || kpiId)}</h3>
        <div style="font-size:13px;color:var(--chu-phu);margin-top:4px;">
          ID: ${escapeHtml(kpiId)} • Nhóm: ${escapeHtml(rec?.nhom || item?.group || "N/A")}
          ${gateLabel ? ` • ${gateLabel}` : ""}
        </div>
      </div>

      <div class="modal-section" style="margin-bottom:16px;">
        <h4 style="font-size:16px;font-weight:600;color:var(--chu);margin-bottom:8px;">📊 Thông tin</h4>
        <div style="font-size:14px;color:var(--chu-phu);">
          <div>Điểm: <strong style="color: var(--chu);">${score}</strong></div>
          <div>Trọng số: <strong style="color: var(--chu);">${(w * 100).toFixed(1)}%</strong></div>
          <div>Impact Gap: <strong style="color: var(--chu);">${impactGap.toFixed(2)}</strong></div>
        </div>
      </div>

      ${fallbackRecommendation(kpiId)}
    `;

        modal.classList.add("active");
    };

    window.closeRecommendationModal = function closeRecommendationModal() {
        const modal = $("recommendation-modal");
        if (modal) modal.classList.remove("active");
    };

    function fallbackRecommendation(id) {
        const rec = getRecommendation(id);
        if (!rec) return '<p style="color: var(--chu-phu);">Chưa có khuyến nghị chi tiết cho KPI này.</p>';

        const toText = (x) => {
            if (x == null) return "";
            if (typeof x === "string") return x;
            if (typeof x === "number") return String(x);
            if (typeof x === "object") return x.viec || x.text || x.noi_dung || x.title || JSON.stringify(x);
            return String(x);
        };

        let html = "";

        if (Array.isArray(rec.hanh_dong_uu_tien) && rec.hanh_dong_uu_tien.length > 0) {
            html += `
        <div class="recommendation-box">
          <h5>✅ Hành động ưu tiên</h5>
          <ul>${rec.hanh_dong_uu_tien.map((h) => `<li>${escapeHtml(toText(h))}</li>`).join("")}</ul>
        </div>
      `;
        }

        if (Array.isArray(rec.hanh_dong_khac_phuc) && rec.hanh_dong_khac_phuc.length > 0) {
            html += `
        <div class="recommendation-box" style="background: var(--canh-bao-nen); border-color: var(--canh-bao);">
          <h5 style="color: var(--canh-bao);">🛠️ Hành động khắc phục</h5>
          <ul>${rec.hanh_dong_khac_phuc.map((h) => `<li>${escapeHtml(toText(h))}</li>`).join("")}</ul>
        </div>
      `;
        }

        if (Array.isArray(rec.luu_y) && rec.luu_y.length > 0) {
            html += `
        <div class="recommendation-box" style="background: var(--xanh-nen); border-color: var(--xanh);">
          <h5 style="color: var(--xanh);">💡 Lưu ý</h5>
          <ul>${rec.luu_y.map((l) => `<li>${escapeHtml(toText(l))}</li>`).join("")}</ul>
        </div>
      `;
        }

        if (rec.thoi_han) {
            html += `<p style="margin-top:12px;font-size:13px;color:var(--nguy-hiem);font-weight:700;">⏰ Thời hạn khuyến nghị: ${escapeHtml(rec.thoi_han)}</p>`;
        }

        return html || '<p style="color: var(--chu-phu);">Không có khuyến nghị.</p>';
    }

    // ========================
    // Export JSON
    // ========================
    window.exportJSON = function exportJSON() {
        if (!assessmentData) return;

        try {
            const blob = new Blob([JSON.stringify(assessmentData, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `assessment_${assessmentData.assessment_id || "export"}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            alert("Lỗi khi xuất file JSON.");
        }
    };

    // ========================
    // Trend analysis (optional)
    // ========================
    function computeTrendStatus(history, eps = 2) {
        const pts = (history || [])
            .map((x) => Number(x?.mrsm?.final_score ?? x?.final_score ?? x?.totalScore ?? NaN))
            .filter((x) => Number.isFinite(x));

        if (pts.length < 4) return { trend_status: "STABLE", delta: 0 };

        const a = (pts[pts.length - 1] + pts[pts.length - 2]) / 2;
        const b = (pts[pts.length - 3] + pts[pts.length - 4]) / 2;
        const delta = a - b;

        if (delta >= eps) return { trend_status: "IMPROVING", delta };
        if (delta <= -eps) return { trend_status: "DECLINING", delta };
        return { trend_status: "STABLE", delta };
    }

    function renderTrendAnalysis() {
        const historyRaw = localStorage.getItem("assessment_history");
        if (!historyRaw) return;

        try {
            const history = JSON.parse(historyRaw);
            if (!Array.isArray(history) || history.length < 2) return;

            const trendRaw = localStorage.getItem("assessment_trend");
            const trend = trendRaw ? JSON.parse(trendRaw) : computeTrendStatus(history);

            const trendDisplay = document.getElementById("trendDisplay");
            if (!trendDisplay) return;

            const { trend_status, delta } = trend || { trend_status: "STABLE", delta: 0 };

            let trendIcon = "➖";
            let trendLabel = "Stable";
            let trendColor = "var(--chu-phu)";

            if (trend_status === "IMPROVING") {
                trendIcon = "📈";
                trendLabel = "Improving";
                trendColor = "var(--tot)";
            } else if (trend_status === "DECLINING") {
                trendIcon = "📉";
                trendLabel = "Declining";
                trendColor = "var(--nguy-hiem)";
            }

            const deltaText = delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
            trendDisplay.innerHTML = `<span style="font-weight:700;color:${trendColor};">${trendIcon} ${trendLabel} (${deltaText})</span>`;
        } catch (err) {
            console.error("Error rendering trend:", err);
        }
    }

    // ========================
    // Empty state
    // ========================
    // ========================
    // Storytelling helpers (Dashboard UX)
    // ========================
    let _controlsBound = false;
    let fixlistItems = [];

    function tiering(score) {
        if (score < 50) return { cls: "tier-not-ready", label: "Not Ready", icon: "🔴", note: "Điểm thấp: cần ưu tiên xử lý các điểm nghẽn lớn." };
        if (score <= 69) return { cls: "tier-partial", label: "Partially Ready", icon: "🟠", note: "Đã có nền tảng nhưng chưa đủ tiêu chuẩn Mall." };
        if (score <= 84) return { cls: "tier-near", label: "Near Mall-Ready", icon: "🟢", note: "Rất gần chuẩn Mall — tập trung đóng các gap trọng số cao." };
        return { cls: "tier-ready", label: "Mall-Ready", icon: "🏅", note: "Đạt mức Mall-Ready — duy trì KPI và tuân thủ Gate." };
    }

    function trafficLight(score) {
        if (score < 50) return { cls: "red", dot: "🔴", text: "Rủi ro cao — ưu tiên P0/P1" };
        if (score < 70) return { cls: "orange", dot: "🟠", text: "Cần cải thiện — tập trung gap lớn" };
        return { cls: "green", dot: "🟢", text: "Tốt — tối ưu để đạt Mall-Ready" };
    }

    function setLoading(isLoading) {
        try {
            if (isLoading) document.body.classList.add("is-loading");
            else document.body.classList.remove("is-loading");

            const overlay = $("loadingOverlay");
            if (overlay) overlay.style.display = isLoading ? "block" : "none";
        } catch (_) { }
    }

    function safeJsonParse(raw) { try { return JSON.parse(raw); } catch { return null; } }

    function round2(x) { return Math.round(Number(x || 0) * 100) / 100; }

    function hasValue(v) {
        if (v === null || v === undefined) return false;
        if (typeof v === "string") return v.trim().length > 0;
        if (typeof v === "number") return Number.isFinite(v);
        if (typeof v === "boolean") return true;
        if (typeof v === "object") return Object.keys(v).length > 0;
        return false;
    }

    function computeInputCoverage(kpis) {
        let filled = 0;
        for (const k of (kpis || [])) {
            if (hasValue(k.value)) filled++;
        }
        return { filled, total: (kpis || []).length };
    }

    function renderInsights() {
        const topDragEl = $("insightTopDragBody");
        const gateRiskEl = $("insightGateRiskBody");
        const coverageEl = $("insightCoverageBody");
        const weakestEl = $("insightWeakestGroupBody");
        if (!topDragEl && !gateRiskEl && !coverageEl && !weakestEl) return;

        const gateStatus = (assessmentData?.gate?.status || "UNKNOWN").toUpperCase();

        // Prepare fixlist cache
        if (!fixlistItems || !fixlistItems.length) fixlistItems = buildFixlist(allKpis).items;


        if (!Array.isArray(fixlistItems)) fixlistItems = (fixlistItems && typeof fixlistItems === "object") ? (fixlistItems.items || []) : [];
        // 1) Top drag (top 3 by impactGap, excluding P0 hard gate if already blocked)
        if (topDragEl) {
            const top = fixlistItems
                .filter((x) => x.gateType === "NONE" && x.impactGap > 0)
                .slice(0, 3);

            if (!top.length) {
                topDragEl.innerHTML = `<div class="empty-state">Không có gap đáng kể (hoặc đang bị Gate chặn).</div>`;
            } else {
                topDragEl.innerHTML = top.map((x) => {
                    const gap = Math.round(x.impactGap * 10) / 10;
                    return `<div class="insight-row">
                        <div class="kpi-pill">${escapeHtml(x.kpiId)}</div>
                        <div class="insight-main">
                          <div class="insight-title">${escapeHtml(x.name || x.kpi_name || "KPI")}</div>
                          <div class="insight-sub">ImpactGap ≈ <strong>${gap}</strong> (w=${round2(x.weight_final || 0)})</div>
                        </div>
                      </div>`;
                }).join("");
            }
        }

        // 2) Gate risk
        if (gateRiskEl) {
            if (gateStatus === "PASS") {
                gateRiskEl.innerHTML = `<div class="pill-success">✅ Gate PASS</div>
                  <div class="muted-small">Điểm MRSM được tính bình thường. Tiếp tục tối ưu KPI theo Fixlist.</div>`;
            } else if (gateStatus === "G0") {
                gateRiskEl.innerHTML = `<div class="pill-danger">⛔ Hard KO Failed</div>
                  <div class="muted-small">MRSM_Final bị chặn (0 điểm). Ưu tiên hoàn thiện hồ sơ Hard KO.</div>`;
            } else if (gateStatus === "G1") {
                gateRiskEl.innerHTML = `<div class="pill-warn">⏳ Soft KO Pending</div>
                  <div class="muted-small">Đang trong 7 ngày khắc phục. Cần PASS để mở tính điểm.</div>`;
            } else if (gateStatus === "G2") {
                gateRiskEl.innerHTML = `<div class="pill-danger">⚠️ Soft KO Overdue</div>
                  <div class="muted-small">Quá hạn khắc phục. Cần xử lý và re-check để PASS.</div>`;
            } else {
                gateRiskEl.innerHTML = `<div class="pill-warn">❔ Gate UNKNOWN</div>
                  <div class="muted-small">Thiếu bằng chứng Gate. Kiểm tra luồng KO_GATE → SOFT_KO.</div>`;
            }
        }

        // 3) Coverage
        if (coverageEl) {
            const { filled, total } = computeInputCoverage(allKpis);
            const pct = total ? Math.round((filled / total) * 100) : 0;
            coverageEl.innerHTML = `<div class="big-number">${pct}%</div>
              <div class="muted-small">Có dữ liệu: ${filled}/${total} KPI (theo breakdown lưu ở local/Firestore)</div>`;
        }

        // 4) Weakest group
        if (weakestEl) {
            const groups = (assessmentData?.groups || []).slice().sort((a, b) => a.avgScore - b.avgScore);
            const w = groups[0];
            if (!w) {
                weakestEl.innerHTML = `<div class="empty-state">Chưa có dữ liệu nhóm.</div>`;
            } else {
                weakestEl.innerHTML = `<div class="big-number">${w.avgScore}/100</div>
                  <div class="muted-small">Nhóm yếu nhất: <strong>${escapeHtml(w.name)}</strong> (${w.count} KPI)</div>`;
            }
        }
    }

    function renderGroupChart() {
        const root = $("groupChart");
        if (!root) return;

        const groups = (assessmentData?.groups || []);
        const order = ["Vận hành", "Thương hiệu", "Danh mục", "Quy mô"];
        const map = {};
        for (const g of groups) map[normalizeGroupName(g.name)] = g;

        const cols = order.map((name) => {
            const g = map[name] || { name, avgScore: 0, count: 0 };
            const h = Math.max(0, Math.min(100, Number(g.avgScore || 0)));
            const weak = h < 50 ? "weak" : "";
            return `
              <div class="gc-col">
                <div class="gc-track" data-group="${escapeHtml(name)}">
                  <div class="gc-fill ${weak}" style="--h:${h}%"></div>
                </div>
                <div class="gc-sub">${escapeHtml(name)}</div>
                <div class="gc-h">${h}</div>
              </div>
            `;
        }).join("");

        root.innerHTML = `
          <div class="gc-wrap">
            <div class="gc-head">
              <div class="gc-title">
                <div class="gc-icon">📊</div>
                <div>
                  <div class="gc-h">Điểm theo nhóm</div>
                  <div class="gc-sub">Tổng hợp trung bình theo trọng số nhóm (0–100)</div>
                </div>
              </div>
              <div class="gc-chips">
                <span class="gc-chip"><span class="p0"></span> &lt;50</span>
                <span class="gc-chip"><span class="p1"></span> 50–69</span>
                <span class="gc-chip"><span class="p2"></span> ≥70</span>
              </div>
            </div>

            <div class="gc-area">
              <div class="gc-grid">
                <div class="gc-gridline"></div>
                <div class="gc-gridline"></div>
                <div class="gc-gridline"></div>
                <div class="gc-gridline"></div>
              </div>
              <div class="gc-bars">
                ${cols}
              </div>
              <div class="gc-tooltip" id="gcTooltip"></div>
            </div>
          </div>
        `;

        // hover tooltip
        const tooltip = $("gcTooltip");
        root.querySelectorAll(".gc-track").forEach((track) => {
            const grp = track.getAttribute("data-group");
            const g = map[grp] || { avgScore: 0, count: 0 };
            track.addEventListener("mousemove", (e) => {
                if (!tooltip) return;
                tooltip.classList.add("show");
                tooltip.innerHTML = `${escapeHtml(grp)}: <strong>${Math.round(g.avgScore || 0)}/100</strong> <span class="muted">(${g.count} KPI)</span>`;
                const r = root.getBoundingClientRect();
                tooltip.style.left = (e.clientX - r.left) + "px";
                tooltip.style.top = (e.clientY - r.top) + "px";
            });
            track.addEventListener("mouseleave", () => { if (tooltip) tooltip.classList.remove("show"); });
        });
    }

    function renderParetoChart() {
        const root = $("paretoChart");
        if (!root) return;
        if (!fixlistItems || !fixlistItems.length) fixlistItems = buildFixlist(allKpis).items;


        if (!Array.isArray(fixlistItems)) fixlistItems = (fixlistItems && typeof fixlistItems === "object") ? (fixlistItems.items || []) : [];
        const top = fixlistItems.filter(x => x.gateType === "NONE" && x.impactGap > 0).slice(0, 5);
        if (!top.length) {
            root.innerHTML = `<div class="empty-state">Chưa có dữ liệu Pareto.</div>`;
            return;
        }
        const max = Math.max(...top.map(x => x.impactGap), 1);

        root.innerHTML = `<div class="pareto-wrap">
          ${top.map((x) => {
            const w = Math.round((x.impactGap / max) * 100);
            return `<div class="pareto-row">
              <div class="pareto-left">
                <div class="kpi-pill">${escapeHtml(x.kpiId)}</div>
                <div class="pareto-name">${escapeHtml(x.name || "KPI")}</div>
              </div>
              <div class="pareto-bar"><div class="pareto-fill" style="width:${w}%"></div></div>
              <div class="pareto-val">${round2(x.impactGap)}</div>
            </div>`;
        }).join("")}
        </div>`;
    }

    function renderDistChart() {
        const root = $("distChart");
        if (!root) return;
        const kpis = allKpis || [];
        const bins = { "0": 0, "50": 0, "100": 0, "other": 0 };
        for (const k of kpis) {
            const s = Math.round(Number(k.score ?? 0));
            if (s === 0) bins["0"]++;
            else if (s === 50) bins["50"]++;
            else if (s === 100) bins["100"]++;
            else bins["other"]++;
        }
        const total = kpis.length || 1;
        const row = (label, count) => {
            const w = Math.round((count / total) * 100);
            return `<div class="dist-row">
              <div class="dist-label">${label}</div>
              <div class="dist-bar"><div class="dist-fill" style="width:${w}%"></div></div>
              <div class="dist-val">${count}</div>
            </div>`;
        };
        root.innerHTML = `<div class="dist-wrap">
          ${row("0 điểm", bins["0"])}
          ${row("50 điểm", bins["50"])}
          ${row("100 điểm", bins["100"])}
          ${row("Khác", bins["other"])}
          <div class="legend-note">Phân bố điểm theo breakdown (0/50/100/khác).</div>
        </div>`;
    }

    function renderPriorityMap() {
        const root = $("priorityMap");
        if (!root) return;
        if (!fixlistItems || !fixlistItems.length) fixlistItems = buildFixlist(allKpis).items;


        if (!Array.isArray(fixlistItems)) fixlistItems = (fixlistItems && typeof fixlistItems === "object") ? (fixlistItems.items || []) : [];
        const pts = fixlistItems
            .filter(x => x.gateType === "NONE" && x.impactGap > 0)
            .slice(0, 20);

        if (!pts.length) {
            root.innerHTML = `<div class="empty-state">Chưa có dữ liệu Priority Map.</div>`;
            return;
        }

        const W = 520, H = 220, pad = 30;
        const maxImpact = Math.max(...pts.map(p => p.impactGap), 1);
        const maxEffort = Math.max(...pts.map(p => p.effort), 10);

        const sx = (e) => pad + (Math.min(maxEffort, Math.max(0, e)) / maxEffort) * (W - 2 * pad);
        const sy = (i) => (H - pad) - (Math.min(maxImpact, Math.max(0, i)) / maxImpact) * (H - 2 * pad);

        const circles = pts.map((p) => {
            const cx = sx(p.effort), cy = sy(p.impactGap);
            const lbl = `${p.kpiId}`;
            const color = p.priority === "P1" ? "var(--cam)" : "var(--xanh)";
            const r = p.priority === "P1" ? 7 : 6;
            return `<g class="pm-pt" data-id="${escapeHtml(p.kpiId)}">
              <circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" opacity="0.9"></circle>
              <text x="${cx + 10}" y="${cy + 4}" font-size="11" fill="var(--chu)">${escapeHtml(lbl)}</text>
            </g>`;
        }).join("");

        root.innerHTML = `
          <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" role="img" aria-label="Priority map">
            <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="var(--duong-ke)"/>
            <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${H - pad}" stroke="var(--duong-ke)"/>
            <text x="${W / 2}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--chu-phu)">Effort →</text>
            <text x="10" y="${H / 2}" transform="rotate(-90 10 ${H / 2})" text-anchor="middle" font-size="11" fill="var(--chu-phu)">Impact ↑</text>
            ${circles}
          </svg>
          <div class="legend-note">Ưu tiên: Impact cao + Effort thấp nằm góc trên-trái.</div>
        `;
    }

    function renderTrend() {
        const root = $("trendChart");
        const list = $("trendList");
        if (!root && !list) return;

        // Best-effort: read history list
        const raw = localStorage.getItem("assessment_history");
        const hist = safeJsonParse(raw) || [];

        if (!hist.length) {
            if (root) root.innerHTML = `<div class="empty-state">Chưa có lịch sử. (Tuỳ chọn) Lưu mỗi lần chấm để thấy xu hướng.</div>`;
            if (list) list.innerHTML = `<div class="empty-state">—</div>`;
            return;
        }

        // Take last 8
        const last = hist.slice(-8);
        const W = 520, H = 220, pad = 28;
        const maxS = 100, minS = 0;

        const sx = (i) => pad + (i / (last.length - 1)) * (W - 2 * pad);
        const sy = (s) => (H - pad) - ((Math.max(minS, Math.min(maxS, s)) - minS) / (maxS - minS)) * (H - 2 * pad);

        const pts = last.map((x, i) => `${sx(i)},${sy(Number(x.score ?? 0))}`).join(" ");
        root.innerHTML = `
          <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" role="img" aria-label="Trend chart">
            <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="var(--duong-ke)"/>
            <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${H - pad}" stroke="var(--duong-ke)"/>
            <polyline points="${pts}" fill="none" stroke="var(--xanh)" stroke-width="2.5" />
            ${last.map((x, i) => `<circle cx="${sx(i)}" cy="${sy(Number(x.score ?? 0))}" r="4" fill="var(--xanh)" />`).join("")}
          </svg>
        `;

        if (list) {
            list.innerHTML = last.slice().reverse().map((x) => {
                return `<div class="trend-item">
                  <div class="trend-date">${escapeHtml(formatDateTime(x.at))}</div>
                  <div class="trend-score"><strong>${Math.round(Number(x.score ?? 0))}</strong>/100</div>
                </div>`;
            }).join("");
        }
    }

    function renderFixlist() {
        const root = $("fixlist");
        if (!root) return;
        if (!fixlistItems || !fixlistItems.length) fixlistItems = buildFixlist(allKpis).items;


        if (!Array.isArray(fixlistItems)) fixlistItems = (fixlistItems && typeof fixlistItems === "object") ? (fixlistItems.items || []) : [];
        const gateStatus = (assessmentData?.gate?.status || "UNKNOWN").toUpperCase();

        // If gate blocked: show P0 first, else show top by impact gap
        let list = [];
        if (gateStatus !== "PASS") {
            list = fixlistItems.filter(x => x.gateType !== "NONE").slice(0, 6);
        } else {
            list = fixlistItems.filter(x => x.gateType === "NONE" && x.impactGap > 0).slice(0, 8);
        }

        if (!list.length) {
            root.innerHTML = `<div class="empty-state">Không có đề xuất ưu tiên.</div>`;
            return;
        }

        root.innerHTML = list.map((x) => {
            const pr = x.priority || "P3";
            const tagCls = pr === "P0" ? "p0" : pr === "P1" ? "p1" : pr === "P2" ? "p2" : "p3";
            const deadline = x.deadline ? `<div class="fixlist-deadline">Due: ${escapeHtml(x.deadline)}</div>` : "";
            const gap = round2(x.impactGap || 0);
            return `<div class="fixlist-item" data-kpi="${escapeHtml(x.kpiId)}">
              <div class="fixlist-left">
                <div class="fixlist-title">${escapeHtml(x.name || x.kpiId)}</div>
                <div class="fixlist-meta">
                  <span class="kpi-pill">${escapeHtml(x.kpiId)}</span>
                  <span class="tag ${tagCls}">${escapeHtml(pr)}</span>
                  <span class="muted-small">ImpactGap: ${gap}</span>
                </div>
                ${deadline}
              </div>
              <div class="fixlist-action">Xem</div>
            </div>`;
        }).join("");

        root.querySelectorAll(".fixlist-item").forEach((el) => {
            el.addEventListener("click", () => {
                const id = el.getAttribute("data-kpi");
                openKpiModal(id);
            });
        });
    }

    function renderKpiTable() {
        const tbody = $("kpiTableBody");
        const cards = $("kpiCards");
        if (!tbody && !cards) return;

        const search = ($("searchKPI")?.value || "").trim().toLowerCase();
        const groupFilter = ($("filterGroup")?.value || "").trim();

        // Sort by impact gap descending by default
        const items = (allKpis || []).slice();

        // Add computed fields
        items.forEach((k) => {
            const kpiId = normalizeKpiId(k);
            k.kpiId = kpiId;
            k.impactGap = calcImpactGap(k);
            k.priority = priorityOf(kpiId, k, Infinity);
        });

        items.sort((a, b) => (b.impactGap || 0) - (a.impactGap || 0));

        const filtered = items.filter((k) => {
            if (groupFilter && normalizeGroupName(k.group) !== normalizeGroupName(groupFilter)) return false;
            if (!search) return true;
            const hay = `${k.kpiId} ${k.name || ""} ${k.group || ""}`.toLowerCase();
            return hay.includes(search);
        });

        // Table
        if (tbody) {
            tbody.innerHTML = filtered.map((k) => {
                const score = Math.round(Number(k.score ?? 0));
                const w = round2(Number(k.weight_final ?? 0));
                const imp = round2(Number(k.impactGap ?? 0));
                const pr = k.priority || "P3";
                const tagCls = pr === "P0" ? "p0" : pr === "P1" ? "p1" : pr === "P2" ? "p2" : "p3";
                return `<tr data-kpi="${escapeHtml(k.kpiId)}">
                  <td><span class="kpi-pill">${escapeHtml(k.kpiId)}</span></td>
                  <td>${escapeHtml(k.name || "")}</td>
                  <td><span class="tag ${tagCls}">${escapeHtml(pr)}</span></td>
                  <td>${escapeHtml(normalizeGroupName(k.group) || "")}</td>
                  <td>${score}</td>
                  <td>${w}</td>
                  <td>${imp}</td>
                </tr>`;
            }).join("");

            tbody.querySelectorAll("tr").forEach((tr) => {
                tr.addEventListener("click", () => openKpiModal(tr.getAttribute("data-kpi")));
            });
        }

        // Cards (mobile)
        if (cards) {
            cards.innerHTML = filtered.slice(0, 40).map((k) => {
                const score = Math.round(Number(k.score ?? 0));
                const imp = round2(Number(k.impactGap ?? 0));
                const pr = k.priority || "P3";
                const tagCls = pr === "P0" ? "p0" : pr === "P1" ? "p1" : pr === "P2" ? "p2" : "p3";
                return `<div class="kpi-card-mini" data-kpi="${escapeHtml(k.kpiId)}">
                  <div class="top">
                    <div class="kpi-pill">${escapeHtml(k.kpiId)}</div>
                    <div class="tag ${tagCls}">${escapeHtml(pr)}</div>
                  </div>
                  <div class="name">${escapeHtml(k.name || "")}</div>
                  <div class="meta">
                    <span>${escapeHtml(normalizeGroupName(k.group) || "")}</span>
                    <span>Score: <strong>${score}</strong></span>
                    <span>ImpactGap: <strong>${imp}</strong></span>
                  </div>
                </div>`;
            }).join("");

            cards.querySelectorAll(".kpi-card-mini").forEach((c) => {
                c.addEventListener("click", () => openKpiModal(c.getAttribute("data-kpi")));
            });
        }
    }

    function bindDashboardControls() {
        if (_controlsBound) return;
        _controlsBound = true;

        const search = $("searchKPI");
        const filter = $("filterGroup");
        if (search) search.addEventListener("input", () => renderKpiTable());
        if (filter) filter.addEventListener("change", () => renderKpiTable());

        // Export JSON
        const btn = $("exportJSON");
        if (btn) {
            btn.addEventListener("click", () => {
                try {
                    const blob = new Blob([JSON.stringify(assessmentData, null, 2)], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `assessment_${assessmentData?.assessmentId || "local"}.json`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);
                } catch (e) {
                    console.warn("Export failed", e);
                }
            });
        }

        // Modal close
        const modal = $("kpiModal");
        const close = $("modalClose");
        if (close && modal) close.addEventListener("click", () => modal.classList.remove("open"));
        if (modal) {
            modal.addEventListener("click", (e) => {
                if (e.target === modal) modal.classList.remove("open");
            });
        }

        // Fixlist click is bound in renderFixlist
    }

    function openKpiModal(kpiIdRaw) {
        const kpiId = normalizeKpiId(kpiIdRaw);
        if (!kpiId) return;

        const modal = $("kpiModal");
        const titleEl = $("modalTitle");
        const bodyEl = $("modalBody");
        if (!modal || !titleEl || !bodyEl) return;

        const item =
            (allKpis || []).find((x) => normalizeKpiId(x) === kpiId) ||
            (fixlistItems || []).find((x) => normalizeKpiId(x?.kpiId) === kpiId);

        if (!item) return;

        const rec = getRecommendation(kpiId);
        const score = Math.round(Number(item?.score ?? 0));
        const w = Number(item?.weight_final ?? item?.weight ?? 0);
        const impactGap = round2(Number(calcImpactGap(item) ?? 0));

        const gateType = detectGateType(kpiId, item);
        const chipCls = score >= 80 ? "good" : score >= 60 ? "warn" : "bad";
        const gateChip =
            gateType === "HARD_KO"
                ? `<span class="chip bad">🚫 Hard KO</span>`
                : gateType === "SOFT_KO"
                    ? `<span class="chip warn">⏳ Soft KO</span>`
                    : `<span class="chip good">✅ Scoring</span>`;

        // Title (sticky header)
        titleEl.textContent = `${kpiId} — ${item?.name || item?.title || rec?.ten_kpi || "KPI"}`;

        // Body (SCAN UI + fallback to legacy renderer)
        bodyEl.innerHTML = `
          <div class="rec-head">
            <div>
              <div class="rec-kpi">${escapeHtml(rec?.ten_kpi || item?.name || item?.title || kpiId)}</div>
              <div class="rec-meta">
                <span class="chip ${chipCls}">Score: ${score}</span>
                <span class="chip">Weight: ${(w * 100).toFixed(1)}%</span>
                <span class="chip">ImpactGap: ${impactGap}</span>
                ${gateChip}
                <span class="chip">${escapeHtml(normalizeGroupName(item?.group) || groupOf(kpiId) || "N/A")}</span>
              </div>
            </div>
          </div>

          <div class="rec-kpi-grid">
            <div class="kpi-snap"><div class="k">KPI ID</div><div class="v">${escapeHtml(kpiId)}</div></div>
            <div class="kpi-snap"><div class="k">Nhóm</div><div class="v">${escapeHtml(normalizeGroupName(item?.group) || groupOf(kpiId) || "—")}</div></div>
            <div class="kpi-snap"><div class="k">Điểm hiện tại</div><div class="v">${score}/100</div></div>
            <div class="kpi-snap"><div class="k">Ưu tiên</div><div class="v">${escapeHtml((item?.priority || priorityOf(kpiId, item, 8)) || "—")}</div></div>
          </div>

          <div style="height:14px"></div>

          ${fallbackRecommendation(kpiId)}
        `;

        modal.classList.add("open");
    }

    function showEmptyState() {
        setLoading(false);
        document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:var(--nen);">
        <div style="text-align:center;padding:40px;max-width:520px;">
          <div style="font-size:64px;margin-bottom:20px;">📊</div>
          <h2 style="font-size:24px;font-weight:700;color:var(--chu);margin-bottom:12px;">Chưa có dữ liệu chấm điểm</h2>
          <p style="font-size:16px;color:var(--chu-phu);margin-bottom:24px;">
            Bạn có thể xem trạng thái Gate ở SOFT_KO, và thực hiện chấm KPI để có Dashboard đầy đủ.
          </p>
          <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
            <button onclick="window.location.href='./SOFT_KO.html'"
              style="padding:14px 22px;background:var(--canh-bao);color:var(--trang);border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;">
              Về Soft KO
            </button>
            <button onclick="window.location.href='./KPI_SCORING.html'"
              style="padding:14px 22px;background:var(--cam);color:var(--trang);border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;">
              Chấm điểm KPI
            </button>
          </div>
        </div>
      </div>
    `;
    }

    // ========================
    // Utils
    // ========================
    function escapeHtml(text) {
        if (text == null) return "";
        const div = document.createElement("div");
        div.textContent = String(text);
        return div.innerHTML;
    }

    function formatDateTime(dt) {
        if (!dt) return "N/A";
        try {
            const d = new Date(dt);
            if (isNaN(d)) return String(dt);
            return d.toLocaleString("vi-VN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
        } catch {
            return String(dt);
        }
    }
})();
