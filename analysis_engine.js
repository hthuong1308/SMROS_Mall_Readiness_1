/**
 * analysis_engine.global.js
 * ------------------------------------------------------------
 * Pure functions only: NO DOM, NO localStorage
 * Static Hosting friendly:
 * - No `export` (ESM). Expose via window.AnalysisEngine
 */
(function (global) {
    "use strict";

    const DEFAULT_GROUP_ORDER = ["Operation", "Brand", "Category", "Scale"];

    function defaultGroupOf(ruleId = "") {
        const id = String(ruleId).toUpperCase();
        if (id.startsWith("OP-") || id.startsWith("CS-") || id.startsWith("PEN-") || id.startsWith("CO-")) return "Operation";
        if (id.startsWith("BR-")) return "Brand";
        if (id.startsWith("CAT-")) return "Category";
        if (id.startsWith("SC-")) return "Scale";
        return "Operation";
    }

    // ✅ VN/EN -> canonical EN group
    function normalizeGroupName(name) {
        const s = String(name || "").trim();
        if (!s) return "";

        const upper = s.toUpperCase();

        // canonical EN
        if (upper === "OPERATION") return "Operation";
        if (upper === "BRAND") return "Brand";
        if (upper === "CATEGORY") return "Category";
        if (upper === "SCALE") return "Scale";

        // VN strict
        if (upper === "VẬN HÀNH" || upper === "VAN HANH") return "Operation";
        if (upper === "THƯƠNG HIỆU" || upper === "THUONG HIEU") return "Brand";
        if (upper === "DANH MỤC" || upper === "DANH MUC") return "Category";
        if (upper === "QUY MÔ" || upper === "QUY MO") return "Scale";

        // VN fuzzy
        if (upper.includes("VẬN") || upper.includes("VAN")) return "Operation";
        if (upper.includes("THƯƠNG") || upper.includes("THUONG")) return "Brand";
        if (upper.includes("DANH")) return "Category";
        if (upper.includes("QUY")) return "Scale";

        return s; // unknown, keep
    }

    // ✅ normalize gate status (PASS/G0/G1/G2/UNKNOWN)
    function normalizeGateStatus(raw) {
        const s = String(raw || "").trim().toUpperCase();
        if (!s) return "UNKNOWN";
        if (s === "PASS") return "PASS";
        if (s === "G0" || s === "HARD_FAIL" || s === "HARD_FAILED") return "G0";
        if (s === "G1" || s === "PENDING") return "G1";
        if (s === "G2" || s === "OVERDUE") return "G2";
        return s;
    }

    function normalizeKpis(rawKpis, opts = {}) {
        const groupOf = typeof opts.groupOf === "function" ? opts.groupOf : defaultGroupOf;

        const list = Array.isArray(rawKpis) ? rawKpis : [];
        const kpis = list
            .map((k) => {
                const rule_id = k && (k.rule_id || k.id || k.kpiId);
                if (!rule_id) return null;

                const score = Number(k.score ?? 0);
                const wf = Number(k.weight_final ?? k.weight ?? 0);

                const gRaw = k.group || "";
                const gNorm = normalizeGroupName(gRaw) || groupOf(rule_id);

                return {
                    ...k,
                    rule_id,
                    score: Number.isFinite(score) ? score : 0,
                    weight_final: Number.isFinite(wf) ? wf : 0,
                    group: gNorm,
                };
            })
            .filter(Boolean);

        // Normalize weights so ImpactGap stable even if sum != 1
        const sumW = kpis.reduce((s, it) => s + (it.weight_final || 0), 0);
        if (sumW > 0) {
            kpis.forEach((it) => (it.weight_final = (it.weight_final || 0) / sumW));
        }

        return kpis;
    }

    function computeImpactGap(kpis, opts = {}) {
        const norm = normalizeKpis(kpis, opts);
        return norm
            .map((k) => ({
                rule_id: k.rule_id,
                group: k.group,
                score: k.score,
                weight_final: k.weight_final,
                impact: (100 - k.score) * k.weight_final,
            }))
            .filter((x) => x.impact > 0)
            .sort((a, b) => b.impact - a.impact);
    }

    function computeBreakdown(kpis, opts = {}) {
        const groupOrder = Array.isArray(opts.groupOrder) ? opts.groupOrder : DEFAULT_GROUP_ORDER;
        const groupOf = typeof opts.groupOf === "function" ? opts.groupOf : defaultGroupOf;

        const norm = normalizeKpis(kpis, { groupOf });

        const groups = {};
        for (const g of groupOrder) groups[g] = { score: 0, contribution: 0 };

        for (const k of norm) {
            const g = normalizeGroupName(k.group) || groupOf(k.rule_id);
            if (!groups[g]) groups[g] = { score: 0, contribution: 0 };

            groups[g]._wsum = (groups[g]._wsum || 0) + (k.weight_final || 0);
            groups[g].contribution += (k.score || 0) * (k.weight_final || 0);
        }

        Object.entries(groups).forEach(([g, v]) => {
            const wsum = Number(v._wsum || 0);
            groups[g] = {
                score: wsum > 0 ? v.contribution / wsum : 0,
                contribution: Number(v.contribution || 0),
            };
        });

        return groups;
    }

    function buildTopFixlist(kpis, opts = {}) {
        const topN = Number(opts.topN ?? 5) || 5;
        return computeImpactGap(kpis, opts).slice(0, topN);
    }

    /**
     * ✅ NEW: normalize ANY payload schema to a renderable shape
     * Accepts:
     * - {kpis: [...]}
     * - {breakdown: [...]}
     * - {mrsm: { breakdown: [...] }}
     * - local record / firestore record
     */
    function normalizeAssessmentPayload(payload, opts = {}) {
        const p = payload && typeof payload === "object" ? payload : {};

        const rawKpis =
            (Array.isArray(p.kpis) && p.kpis) ||
            (Array.isArray(p.breakdown) && p.breakdown) ||
            (p.mrsm && Array.isArray(p.mrsm.breakdown) && p.mrsm.breakdown) ||
            [];

        const kpis = normalizeKpis(rawKpis, opts);

        const groups = computeBreakdown(kpis, opts);
        const fixlist = buildTopFixlist(kpis, { ...opts, topN: opts.topN ?? 5 });

        const totalScore =
            Number(p.totalScore ?? p.total_score ?? p.mrsm?.final_score ?? p.mrsm?.finalScore ?? 0) || 0;

        const tier = String(p.tier ?? p.mrsm?.tier ?? "NOT_READY");

        const gateStatus =
            normalizeGateStatus(p.gate?.status ?? p.gate_status ?? p.gateStatus ?? p.soft_gate_status ?? "UNKNOWN");

        return {
            ...p,
            gate: { ...(p.gate || {}), status: gateStatus },
            mrsm: { ...(p.mrsm || {}), final_score: totalScore, tier },
            kpis,
            groups,
            fixlist,
        };
    }

    global.AnalysisEngine = {
        DEFAULT_GROUP_ORDER,
        defaultGroupOf,
        normalizeGroupName,
        normalizeGateStatus,
        normalizeKpis,
        computeImpactGap,
        computeBreakdown,
        buildTopFixlist,
        normalizeAssessmentPayload, // ✅ new
    };
})(typeof window !== "undefined" ? window : globalThis);
