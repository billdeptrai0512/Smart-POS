import React, { useMemo, useState } from 'react';
import { calculateEstimatedConsumption } from '../../utils/inventory';
import { ingredientLabel, getIngredientUnit } from '../../utils/ingredients';
import { ChevronDown, Lock } from 'lucide-react';
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
    ingredientUnits = {},
    isLocked = false,
    onUnlockClick
}) {
    const { ingredientConfigs = [], products = [] } = useProducts() || {};
    const [expandedRows, setExpandedRows] = useState({});
    const toggleRow = (ingredient) => {
        setExpandedRows(prev => ({ ...prev, [ingredient]: !prev[ingredient] }));
    };

    // For each ingredient, pick a "reference product" = sản phẩm bán chạy nhất
    // có dùng nguyên liệu đó. Dùng để quy đổi hụt/dư → số ly tương đương,
    // giúp user hình dung magnitude (vd: "≈ 33 ly cà phê sữa").
    const ingredientToProduct = useMemo(() => {
        const sales = {};
        orders.forEach(o => {
            if (o.deleted_at) return;
            (o.order_items || []).forEach(i => {
                const pid = i.product_id || i.productId;
                sales[pid] = (sales[pid] || 0) + (i.quantity || i.qty || 1);
            });
        });

        const map = {};
        (recipes || []).forEach(r => {
            if (!r.amount || r.amount <= 0) return;
            const s = sales[r.product_id] || 0;
            const cur = map[r.ingredient];
            // Prefer best-seller; fall back to first-seen recipe
            if (!cur || s > cur.sales) {
                map[r.ingredient] = { productId: r.product_id, amountPerCup: r.amount, sales: s };
            }
        });
        // Resolve product names; drop entries whose product không tìm thấy hoặc 1:1 ratio
        // (vd: nắp/ly — "≈ 220 ly cà phê sữa" cho "Dư 220 cái" không thêm thông tin)
        for (const ing of Object.keys(map)) {
            const ref = map[ing];
            const p = products.find(pp => pp.id === ref.productId);
            if (!p?.name || ref.amountPerCup === 1) {
                delete map[ing];
                continue;
            }
            ref.productName = p.name.toLowerCase();
        }
        return map;
    }, [recipes, products, orders]);

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
                productId: i.product_id || i.productId, qty: i.quantity || i.qty || 1,
                extras: i.extra_ids ? i.extra_ids.map(id => ({ id })) : (i.extras || [])
            }));
        });

        // Pre-calculate estimated consumption per day
        const dailyConsumption = {};
        for (const [dayStr, items] of Object.entries(dailyOrderItems)) {
            dailyConsumption[dayStr] = calculateEstimatedConsumption(items, recipes, extraIngredients);
        }

        // --- Step 2: Keep only the LAST closing per calendar day, oldest → newest.
        // Mỗi ngày có thể có nhiều ca (sáng/tối). dailyConsumption là tổng cả ngày,
        // nếu audit từng ca sẽ bị đếm trùng tiêu hao. Daily audit (RPC LIMIT 1) cũng
        // chỉ dùng ca cuối ngày — range giữ đúng convention đó để tổng = tổng daily.
        const lastClosingPerDay = {};
        for (const c of shiftClosings) {
            const dayStr = new Date(c.closed_at).toLocaleDateString('sv-SE');
            const prev = lastClosingPerDay[dayStr];
            if (!prev || new Date(c.closed_at) > new Date(prev.closed_at)) {
                lastClosingPerDay[dayStr] = c;
            }
        }
        const sortedClosings = Object.values(lastClosingPerDay).sort(
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
                // Skip ingredients where staff didn't count actual remaining at end of shift —
                // treating null as 0 would surface a fake hao hụt = −theoretical (the whole stock).
                if (item.remaining == null) return;

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
                const actual = item.remaining;
                const diff = Math.round((actual - theoretical) * 10) / 10;

                const diffValue = diff * unitCost;

                if (!totalLossPerIngredient[item.ingredient]) {
                    totalLossPerIngredient[item.ingredient] = { diff: 0, diffValue: 0, daily: [] };
                }

                totalLossPerIngredient[item.ingredient].diff += diff;
                totalLossPerIngredient[item.ingredient].diffValue += diffValue;
                totalLossPerIngredient[item.ingredient].daily.push({ dayStr, diff, diffValue });

                if (diffValue < 0) totalLossValue += Math.abs(diffValue);
            });
        });

        // --- Step 5: Build display rows ---
        // Card này chỉ quan tâm thất thoát (hụt). Bỏ row có net dư.
        // Giữ row "Bù trừ" (net ≈ 0) nếu có ngày hụt — ngày hụt là anomaly thật.
        const rows = Object.entries(totalLossPerIngredient)
            .filter(([_, data]) => data.diff <= 0.05 && data.daily.some(d => d.diff < -0.05))
            .map(([ingredient, data]) => {
                const unit = getIngredientUnit(ingredient, '', ingredientUnits);
                const diff = Math.round(data.diff * 10) / 10;
                const hasAnomaly = data.daily.some(d => Math.abs(d.diff) > 0.05);
                let diffText, diffColor, diffBg;

                if (diff < -0.05) {
                    diffText = `Hụt ${Math.abs(diff)} ${unit}`;
                    diffColor = 'text-danger';
                    diffBg = 'bg-danger/10';
                } else if (diff > 0.05) {
                    diffText = `Dư ${diff} ${unit}`;
                    diffColor = 'text-warning';
                    diffBg = 'bg-warning/10';
                } else if (hasAnomaly) {
                    diffText = 'Bù trừ';
                    diffColor = 'text-text-secondary';
                    diffBg = 'bg-surface-light';
                } else {
                    diffText = 'Khớp';
                    diffColor = 'text-success';
                    diffBg = 'bg-success/10';
                }

                // Sort daily entries chronologically, only keep anomalous days
                const dailyAnomalies = data.daily
                    .filter(d => Math.abs(d.diff) > 0.05)
                    .sort((a, b) => a.dayStr.localeCompare(b.dayStr))
                    .map(d => {
                        let dText, dColor;
                        if (d.diff < 0) {
                            dText = `Hụt ${Math.abs(d.diff)} ${unit}`;
                            dColor = 'text-danger';
                        } else {
                            dText = `Dư ${d.diff} ${unit}`;
                            dColor = 'text-warning';
                        }
                        const [, m, day] = d.dayStr.split('-');
                        return { ...d, dateLabel: `${day}/${m}`, dText, dColor };
                    });

                // Quy đổi sang số ly tương đương dựa trên best-seller dùng nguyên liệu này
                const ref = ingredientToProduct[ingredient];
                let equivText = null;
                if (ref && ref.amountPerCup > 0) {
                    const cups = Math.round(Math.abs(diff) / ref.amountPerCup);
                    if (cups > 0) equivText = `≈ ${cups} ly ${ref.productName}`;
                }

                return {
                    ingredient, diff,
                    diffValue: data.diffValue,
                    diffText, diffColor, diffBg, unit,
                    dailyAnomalies,
                    equivText
                };
            }).sort((a, b) => a.diffValue - b.diffValue);

        return { rows, totalLossValue };
    }, [shiftClosings, prevShiftClosings, orders, recipes, extraIngredients, ingredientConfigs, ingredientUnits, ingredientToProduct]);

    if (!auditData.rows.length && auditData.totalLossValue === 0) return null;

    if (isLocked) {
        return (
            <button
                id="range-loss-upsell-card"
                onClick={onUnlockClick}
                className="w-full bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 text-left hover:border-primary/30 active:scale-[0.99] transition-all"
            >
                <div className="flex items-center gap-3 mb-2">
                    <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                        <Lock size={13} className="text-primary" />
                    </div>
                    <span className="text-[13px] font-black text-text">Kiểm kê thất thoát</span>
                    <span className="ml-auto text-[10px] font-black text-primary bg-primary/10 px-2 py-0.5 rounded-full">PRO</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-border/40 mb-3">
                    <span className="text-[13px] font-bold text-text">Tổng giá trị hao hụt ước tính</span>
                    <span className="text-[16px] font-black text-danger tabular-nums">-{formatVND(auditData.totalLossValue)}</span>
                </div>
                <p className="text-[12px] text-text-secondary leading-relaxed">
                    Theo dõi chi tiết nguyên liệu thất thoát theo từng ngày trong kỳ. Nâng cấp Pro để mở khoá.
                </p>
                <p className="text-[12px] font-black text-primary mt-2">Nâng cấp Pro →</p>
            </button>
        );
    }

    return (
        <div className="bg-surface rounded-[20px] p-4 border border-border/60 shadow-sm flex flex-col gap-2.5">
            <div className="flex items-center justify-center border-b border-border/40 pb-2.5">
                <span className="text-[12px] font-bold text-text uppercase tracking-widest opacity-80">Hao hụt trong kỳ</span>

            </div>

            <div className="flex flex-col space-y-2">
                {auditData.rows.map(item => {
                    const isExpanded = !!expandedRows[item.ingredient];
                    const moneyVal = Math.abs(item.diffValue);
                    return (
                        <div key={item.ingredient} className="flex flex-col border-b border-border/20 last:border-0 pb-2 last:pb-0">
                            <div
                                className="flex items-center justify-between cursor-pointer group"
                                onClick={() => toggleRow(item.ingredient)}
                            >
                                <div className="flex flex-col flex-1 pr-2 min-w-0">
                                    <div className="flex items-center gap-1">
                                        <span className="text-[13px] font-bold text-text leading-tight truncate">
                                            {ingredientLabel(item.ingredient)}
                                        </span>
                                        <ChevronDown size={12} className={`text-text-dim shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                                    </div>
                                    <span className={`text-[11px] font-black tabular-nums mt-1 ${item.diffColor}`}>
                                        {item.equivText && <span className="opacity-80 font-medium text-[10px]">{item.equivText}</span>}
                                    </span>
                                </div>
                                <div className="flex flex-col items-end shrink-0 gap-1">
                                    <div className={`px-2 py-0.5 rounded border border-transparent ${item.diffBg} border-${item.diffColor.replace('text-', '')}/20`}>
                                        <span className={`text-[11px] font-black tabular-nums ${item.diffColor}`}>
                                            {item.diffText}
                                        </span>
                                    </div>
                                    {moneyVal >= 1 && item.diffValue < 0 && (
                                        <span className={`text-[11px] font-black tabular-nums ${item.diffColor}`}>
                                            -{formatVND(moneyVal)}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {isExpanded && item.dailyAnomalies.length > 0 && (
                                <div className="mt-2 px-3 py-2 bg-surface-light rounded-[10px] border border-border/40 flex flex-col gap-1">
                                    <span className="text-[9px] font-black text-text-dim uppercase mb-0.5">Chi tiết theo ngày</span>
                                    {item.dailyAnomalies.map(d => (
                                        <div key={d.dayStr} className="flex items-center justify-between">
                                            <span className="text-[11px] font-medium text-text-secondary tabular-nums">{d.dateLabel}</span>
                                            <div className="flex items-center gap-2">
                                                <span className={`text-[11px] font-bold tabular-nums ${d.dColor}`}>{d.dText}</span>
                                                {Math.abs(d.diffValue) >= 1 && d.diffValue < 0 && (
                                                    <span className={`text-[11px] font-black tabular-nums ${d.dColor} min-w-[60px] text-right`}>
                                                        -{formatVND(Math.abs(d.diffValue))}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="mt-2 flex flex-col">
                <div
                    className="pt-3 border-t border-border/40 flex items-center justify-between cursor-pointer"
                >
                    <div className="flex items-center gap-1">
                        <span className="text-[14px] font-bold text-text-secondary">Tổng cộng:</span>
                    </div>
                    <span className="text-[14px] font-black text-danger tabular-nums">-{formatVND(auditData.totalLossValue)}</span>
                </div>

            </div>
        </div>
    );
}
