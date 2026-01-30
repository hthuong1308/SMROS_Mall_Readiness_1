/**
 * analysis_engine.js
 * ------------------------------------------------------------
 * Pure functions only: NO DOM, NO localStorage
 *
 * IMPORTANT (Static Hosting friendly):
 * - Không dùng `export` (ESM) để tránh lỗi cú pháp khi load bằng <script>.
 * - Expose qua `window.AnalysisEngine`.
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

    function normalizeKpis(rawKpis, opts = {}) {
        const groupOf = typeof opts.groupOf === "function" ? opts.groupOf : defaultGroupOf;

        const list = Array.isArray(rawKpis) ? rawKpis : [];
        const kpis = list
            .map((k) => {
                const rule_id = k && (k.rule_id || k.id || k.kpiId);
                if (!rule_id) return null;

                const score = Number(k.score ?? 0);
                const wf = Number(k.weight_final ?? k.weight ?? 0);

                return {
                    ...k,
                    rule_id,
                    score: Number.isFinite(score) ? score : 0,
                    weight_final: Number.isFinite(wf) ? wf : 0,
                    // Nếu upstream có group (VN/EN) thì giữ; nếu thiếu thì map theo rule_id
                    group: k.group || groupOf(rule_id),
                };
            })
            .filter(Boolean);

        // Normalize weights so ImpactGap is stable even if upstream sums ≠ 1
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

    /**
     * Group breakdown:
     * - score = (Σ score_i * wf_i) / (Σ wf_i)   (weighted avg within group)
     * - contribution = Σ score_i * wf_i         (absolute contribution to final)
     */
    function computeBreakdown(kpis, opts = {}) {
        const groupOrder = Array.isArray(opts.groupOrder) ? opts.groupOrder : DEFAULT_GROUP_ORDER;
        const groupOf = typeof opts.groupOf === "function" ? opts.groupOf : defaultGroupOf;

        const norm = normalizeKpis(kpis, { groupOf });

        const groups = {};
        for (const g of groupOrder) groups[g] = { score: 0, contribution: 0 };

        for (const k of norm) {
            const g = groupOf(k.rule_id);
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

    // Expose
    global.AnalysisEngine = {
        defaultGroupOf,
        normalizeKpis,
        computeImpactGap,
        computeBreakdown,
        buildTopFixlist,
    };
})(typeof window !== "undefined" ? window : globalThis);
