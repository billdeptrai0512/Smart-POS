import React, { useMemo, useState } from 'react';
import { calculateEstimatedConsumption } from '../../utils/inventory';
import { ingredientLabel, getIngredientUnit } from '../common/recipeUtils';
import { ChevronDown } from 'lucide-react';
import { useProducts } from '../../contexts/ProductContext';
import { formatVND } from '../../utils';

/**
 * RangeLossCard – Aggregated inventory loss for a week/month.
 *
 * Uses the exact same per-day formula as InventoryRefillCard's audit tab,
 * then sums across all days that have a shift_closing in the period.
 *
 * Per-day formula (identical to daily audit):
 *   opening  = previousClosing.remaining (or current closing.opening override)
 *   restock  = closing.restock
 *   used     = estimatedConsumption from that day's orders
 *   theoretical = opening + restock - used
 *   diff     = actual - theoretical        (negative = loss)
 *
 * We sum `diff` and `diffValue` per ingredient across all days.
 */
export default function RangeLossCard({
    orders,
    shiftClosings,
    prevShiftClosings,
    recipes,
    extraIngredients,
    ingredientUnits = {}
}) {
    const { ingredientConfigs = [] } = useProducts() || {};
    const [isLossExpanded, setIsLossExpanded] = useState(false);

    const auditData = useMemo(() => {
        if (!shiftClosings || shiftClosings.length === 0) return { rows: [], totalLossValue: 0 };

        // --- Step 1: Build daily order-item lists keyed by YYYY-MM-DD ---
        const dailyOrderItems = {};
        orders.forEach(o => {
            if (o.deleted_at) return;
            const d = new Date(o.created_at);
            const dayStr = d.toLocaleDateString('sv-SE'); // YYYY-MM-DD in local TZ
            if (!dailyOrderItems[dayStr]) dailyOrderItems[dayStr] = [];

            (o.order_items || []).forEach(i => dailyOrderItems[dayStr].push({
                productId: i.product_id, qty: i.quantity || 1,
                extras: (i.extra_ids || []).map(id => ({ id }))
            }));
        });

        // Pre-calculate estimated consumption per day
        const dailyConsumption = {};
        for (const [dayStr, items] of Object.entries(dailyOrderItems)) {
            dailyConsumption[dayStr] = calculateEstimatedConsumption(items, recipes, extraIngredients);
        }

        // --- Step 2: Sort closings oldest → newest ---
        const sortedClosings = [...shiftClosings].sort(
            (a, b) => new Date(a.closed_at) - new Date(b.closed_at)
        );

        // --- Step 3: Determine opening stock for the FIRST closing ---
        // This comes from the newest prevShiftClosing's remaining (= yesterday's tồn cuối).
        // If not available, fall back to the first closing's `opening` field.
        const prevClosingReport = (() => {
            if (!prevShiftClosings || prevShiftClosings.length === 0) return {};
            // prevShiftClosings is sorted DESC from RPC, so [0] is the newest
            const latest = prevShiftClosings[0];
            if (!latest?.inventory_report) return {};
            const map = {};
            latest.inventory_report.forEach(item => {
                map[item.ingredient] = item.remaining ?? 0;
            });
            return map;
        })();

        // --- Step 4: Walk through each closing day-by-day, same logic as daily audit ---
        const totalLossPerIngredient = {};
        let totalLossValue = 0;

        sortedClosings.forEach((closing, idx) => {
            if (!closing.inventory_report) return;

            // Map closing to its business day
            const cDate = new Date(closing.closed_at);
            const dayStr = cDate.toLocaleDateString('sv-SE');

            const todayEstimatedConsumption = dailyConsumption[dayStr] || {};

            closing.inventory_report.forEach(item => {
                const config = ingredientConfigs.find(c => c.ingredient === item.ingredient) || {};
                const unitCost = config.unit_cost || 0;

                // Opening: for the first closing, use prevClosing remaining.
                // For subsequent closings, use the previous closing's remaining.
                // If the closing has a manual `opening` override, prefer that.
                let opening;
                if (item.opening != null) {
                    // Manual override set during shift close
                    opening = item.opening;
                } else if (idx === 0) {
                    // First closing in the range: use previous period's remaining
                    opening = prevClosingReport[item.ingredient] ?? 0;
                } else {
                    // Use previous closing's remaining
                    const prevClosing = sortedClosings[idx - 1];
                    const prevItem = (prevClosing?.inventory_report || []).find(
                        i => i.ingredient === item.ingredient
                    );
                    opening = prevItem?.remaining ?? 0;
                }

                const restock = item.restock || 0;
                const used = Math.round((todayEstimatedConsumption[item.ingredient] || 0) * 10) / 10;

                const theoretical = Math.round((opening + restock - used) * 10) / 10;
                const actual = item.remaining || 0;
                const diff = Math.round((actual - theoretical) * 10) / 10;

                const diffValue = diff * unitCost;

                if (!totalLossPerIngredient[item.ingredient]) {
                    totalLossPerIngredient[item.ingredient] = { diff: 0, diffValue: 0 };
                }

                totalLossPerIngredient[item.ingredient].diff += diff;
                totalLossPerIngredient[item.ingredient].diffValue += diffValue;

                if (diffValue < 0) totalLossValue += Math.abs(diffValue);
            });
        });

        // --- Step 5: Build display rows ---
        const rows = Object.entries(totalLossPerIngredient)
            .filter(([_, data]) => Math.abs(data.diff) > 0.05)
            .map(([ingredient, data]) => {
                const unit = getIngredientUnit(ingredient, '', ingredientUnits);
                const diff = Math.round(data.diff * 10) / 10;
                let diffText, diffColor, diffBg;

                if (diff < 0) {
                    diffText = `Hụt ${Math.abs(diff)} ${unit}`;
                    diffColor = 'text-danger';
                    diffBg = 'bg-danger/10';
                } else if (diff > 0) {
                    diffText = `Dư ${diff} ${unit}`;
                    diffColor = 'text-warning';
                    diffBg = 'bg-warning/10';
                } else {
                    diffText = 'Khớp';
                    diffColor = 'text-success';
                    diffBg = 'bg-success/10';
                }

                return {
                    ingredient, diff,
                    diffValue: data.diffValue,
                    diffText, diffColor, diffBg, unit
                };
            }).sort((a, b) => a.diffValue - b.diffValue);

        return { rows, totalLossValue };
    }, [shiftClosings, prevShiftClosings, orders, recipes, extraIngredients, ingredientConfigs, ingredientUnits]);

    if (!auditData.rows.length && auditData.totalLossValue === 0) return null;

    return (
        <div className="bg-surface rounded-[20px] p-4 border border-border/60 shadow-sm flex flex-col gap-3">
            <div className="flex flex-col gap-3 border-b border-border/40 pb-3">
                <div className="flex items-center justify-center w-full">
                    <span className="text-[13px] font-bold text-text uppercase tracking-widest opacity-80">Thất thoát trong kỳ</span>
                </div>
            </div>

            <div className="flex flex-col">
                <div className="space-y-3 pb-3">
                    {auditData.rows.map(item => (
                        <div key={item.ingredient} className="flex flex-col border-b border-border/20 last:border-0 pb-3 last:pb-0">
                            <div className="flex items-start justify-between group">
                                <div className="flex flex-col flex-1 pr-2">
                                    <div className="flex items-center gap-1 mb-0.5">
                                        <span className="text-[14px] font-bold text-text leading-tight">
                                            {ingredientLabel(item.ingredient)}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end shrink-0">
                                    <div className={`px-2 py-0.5 rounded border border-transparent ${item.diff !== 0 ? item.diffBg + ' border-' + item.diffColor.replace('text-', '') + '/20' : ''}`}>
                                        <span className={`text-[11px] font-black tabular-nums ${item.diffColor}`}>
                                            {item.diffText}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {auditData.totalLossValue > 0 && (
                    <div className="mt-2 flex flex-col">
                        <div
                            className="pt-3 border-t border-border/40 flex items-center justify-between cursor-pointer"
                            onClick={() => setIsLossExpanded(!isLossExpanded)}
                        >
                            <div className="flex items-center gap-1">
                                <span className="text-[12px] font-bold text-text-secondary">Tổng thất thoát trong kỳ:</span>
                                <ChevronDown size={14} className={`text-text-dim transition-transform duration-200 ${isLossExpanded ? 'rotate-180' : ''}`} />
                            </div>
                            <span className="text-[14px] font-black text-danger tabular-nums">-{formatVND(auditData.totalLossValue)}</span>
                        </div>

                        {isLossExpanded && (
                            <div className="mt-3 px-3 py-2.5 bg-danger/5 rounded-[12px] border border-danger/10 flex flex-col gap-2">
                                {auditData.rows.filter(r => r.diffValue < 0).map((r, i) => (
                                    <div key={i} className="flex items-center justify-between">
                                        <span className="text-[11px] font-medium text-text-secondary">{ingredientLabel(r.ingredient)}</span>
                                        <span className="text-[11px] font-bold text-danger tabular-nums">
                                            {r.diffText} = {formatVND(Math.abs(r.diffValue))}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
