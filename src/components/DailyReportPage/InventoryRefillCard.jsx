import React, { useState, useEffect, useMemo } from 'react';
import { calculateEstimatedConsumption, calculateConsumptionBreakdown, calculateRefillTarget } from '../../utils/inventory';
import { ingredientLabel, getIngredientUnit } from '../../utils/ingredients';
import { fetchLastWeekSameDayOrderItems } from '../../services/orderService';
import { ChevronDown } from 'lucide-react';
import { useProducts } from '../../contexts/ProductContext';
import { formatVND } from '../../utils';

// Fallback: if exact ingredient key has no consumption, try matching by display label.
// This handles the case where recipes use 'condensed_milk_ml' but inventory tracks 'sữa_đặc'
// — both display as "Sữa đặc" via ingredientLabel(), causing Tiêu CT = 0 with exact lookup.
function lookupByLabel(ingredient, estimatedMap) {
    const exact = estimatedMap[ingredient]
    if (exact) return exact
    const label = ingredientLabel(ingredient).toLowerCase()
    for (const [key, val] of Object.entries(estimatedMap)) {
        if (key !== ingredient && ingredientLabel(key).toLowerCase() === label) return val
    }
    return 0
}

export default function InventoryRefillCard({
    shiftClosing,
    yesterdayClosing,
    todayOrders,
    offlineToday,
    recipes,
    extraIngredients,
    selectedAddress,
    products = [],
    productExtras = {},
    ingredientUnits = {},
    isPastDate = false,
    forcedTab,               // when set, lock activeTab + hide tab nav (used by /daily-report inventory "Bổ sung" sub-tab)
}) {
    const { ingredientConfigs = [] } = useProducts() || {};
    const [lastWeekItems, setLastWeekItems] = useState([]);
    const [isLoadingPast, setIsLoadingPast] = useState(false);
    const [activeTab, setActiveTab] = useState(forcedTab || 'audit');
    const [expandedRows, setExpandedRows] = useState({});
    const [isLossExpanded, setIsLossExpanded] = useState(false);

    const toggleRow = (ingredient) => {
        setExpandedRows(prev => ({ ...prev, [ingredient]: !prev[ingredient] }));
    };

    useEffect(() => {
        if (!selectedAddress?.id || isPastDate) return;

        // Cache key for exactly last week same day
        const today = new Date().toISOString().split('T')[0];
        const cacheKey = `lastWeekSameDay_${selectedAddress.id}_${today}`;
        const cached = sessionStorage.getItem(cacheKey);

        if (cached) {
            try {
                setLastWeekItems(JSON.parse(cached));
                return;
            } catch { /* ignore parse errors, re-fetch */ }
        }

        setIsLoadingPast(true);
        fetchLastWeekSameDayOrderItems(selectedAddress.id).then(items => {
            const result = items || [];
            setLastWeekItems(result);
            try { sessionStorage.setItem(cacheKey, JSON.stringify(result)); } catch { /* storage full, skip */ }
        }).finally(() => setIsLoadingPast(false));
    }, [selectedAddress?.id]);

    const openingMap = useMemo(() => {
        const map = {};
        if (yesterdayClosing?.inventory_report) {
            yesterdayClosing.inventory_report.forEach(item => {
                map[item.ingredient] = item.remaining || 0;
            });
        }
        if (shiftClosing?.inventory_report) {
            shiftClosing.inventory_report.forEach(item => {
                if (item.opening != null) map[item.ingredient] = item.opening;
            });
        }
        return map;
    }, [shiftClosing, yesterdayClosing]);

    const todayOrderItems = useMemo(() => {
        const items = [];
        todayOrders.filter(o => !o.deleted_at).forEach(o => {
            (o.order_items || []).forEach(i => items.push({
                productId: i.product_id || i.productId, qty: i.quantity || i.qty || 1,
                extras: i.extra_ids ? i.extra_ids.map(id => ({ id })) : (i.extras || [])
            }));
        });
        offlineToday.forEach(o => {
            (o.cart || o.orderItems || []).forEach(i => items.push({
                productId: i.productId, qty: i.quantity || 1,
                extras: i.extras || []
            }));
        });
        return items;
    }, [todayOrders, offlineToday]);

    const todayEstimatedConsumption = useMemo(() =>
        calculateEstimatedConsumption(todayOrderItems, recipes, extraIngredients),
        [todayOrderItems, recipes, extraIngredients]
    );

    const consumptionBreakdown = useMemo(() =>
        calculateConsumptionBreakdown(todayOrderItems, recipes, extraIngredients, products, productExtras),
        [todayOrderItems, recipes, extraIngredients, products, productExtras]
    );

    const ingredientToProduct = useMemo(() => {
        const sales = {};
        todayOrderItems.forEach(i => {
            sales[i.productId] = (sales[i.productId] || 0) + (i.qty || 1);
        });

        const map = {};
        (recipes || []).forEach(r => {
            if (!r.amount || r.amount <= 0) return;
            const s = sales[r.product_id] || 0;
            const cur = map[r.ingredient];
            if (!cur || s > cur.sales) {
                map[r.ingredient] = { productId: r.product_id, amountPerCup: r.amount, sales: s };
            }
        });
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
    }, [recipes, products, todayOrderItems]);

    const mappedPastItems = useMemo(() =>
        lastWeekItems.map(i => ({
            productId: i.product_id, qty: i.quantity,
            extras: (i.extra_ids || []).map(id => ({ id }))
        })),
        [lastWeekItems]
    );

    const lastWeekConsumption = useMemo(() =>
        calculateEstimatedConsumption(mappedPastItems, recipes, extraIngredients),
        [mappedPastItems, recipes, extraIngredients]
    );

    // Calculate aggregated audit data
    const auditData = useMemo(() => {
        if (!shiftClosing?.inventory_report) return [];
        let totalLossValue = 0;

        const rows = shiftClosing.inventory_report
            // Skip ingredients staff didn't count actual remaining for. `remaining == null`
            // means "chưa kiểm cuối ca" — treating it as 0 would surface a fake hụt = −theoretical.
            .filter(item => item.remaining != null)
            .map(item => {
                const config = ingredientConfigs.find(c => c.ingredient === item.ingredient) || {};
                const unitCost = config.unit_cost || 0; // assuming unit_cost is available in config, else 0

                const opening = openingMap[item.ingredient] ?? 0;
                const restock = item.restock || 0;
                const used = Math.round(lookupByLabel(item.ingredient, todayEstimatedConsumption) * 10) / 10;

                const theoretical = Math.round((opening + restock - used) * 10) / 10;
                const actual = item.remaining;
                const diff = Math.round((actual - theoretical) * 10) / 10;

                const diffValue = diff * unitCost;
                if (diffValue < 0) totalLossValue += Math.abs(diffValue);

                const unit = getIngredientUnit(item.ingredient, item.unit, ingredientUnits);

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

                const ref = ingredientToProduct[item.ingredient];
                let equivText = null;
                if (ref && ref.amountPerCup > 0 && diff < 0) {
                    const cups = Math.round(Math.abs(diff) / ref.amountPerCup);
                    if (cups > 0) equivText = `≈ ${cups} ly ${ref.productName}`;
                }

                const labelLower = ingredientLabel(item.ingredient).toLowerCase()
                const bd = consumptionBreakdown[item.ingredient]
                    || Object.entries(consumptionBreakdown).find(([k]) =>
                        k !== item.ingredient && ingredientLabel(k).toLowerCase() === labelLower
                    )?.[1]
                    || {}

                return {
                    ...item, config, opening, restock, used, theoretical, actual, diff, diffValue,
                    diffText, diffColor, diffBg, unitCost, unit, equivText, bd
                };
            });

        rows.sort((a, b) => {
            const getPriority = (diff) => {
                if (diff === 0) return 0;
                if (diff > 0) return 1;
                return 2;
            };
            const pA = getPriority(a.diff);
            const pB = getPriority(b.diff);
            if (pA !== pB) return pA - pB;
            return Math.abs(b.diffValue) - Math.abs(a.diffValue);
        });

        return { rows, totalLossValue };
    }, [shiftClosing, openingMap, todayEstimatedConsumption, consumptionBreakdown, ingredientConfigs, ingredientToProduct, ingredientUnits]);

    // Calculate aggregated refill data
    const refillData = useMemo(() => {
        if (!shiftClosing?.inventory_report) return [];

        return shiftClosing.inventory_report.map(item => {
            const config = ingredientConfigs.find(c => c.ingredient === item.ingredient) || {};
            const todayUsed = Math.round(lookupByLabel(item.ingredient, todayEstimatedConsumption) * 10) / 10;
            const lastWeekUsed = Math.round(lookupByLabel(item.ingredient, lastWeekConsumption) * 10) / 10;

            // Smart Forecast: Max of today or same day last week
            const rawTarget = Math.max(todayUsed, lastWeekUsed);

            const actual = item.remaining || 0;
            const minStock = config.min_stock || 0;

            // Refill logic: if actual is less than target, we buy the difference. 
            // Also consider min_stock to trigger purchase if low.
            let finalRefill = 0;
            if (actual < minStock || actual < rawTarget) {
                finalRefill = Math.max(minStock - actual, rawTarget - actual);
                finalRefill = Math.round(finalRefill * 10) / 10;
            }

            let packsNeeded = 0;
            if (finalRefill > 0 && config.pack_size && config.pack_size > 0) {
                packsNeeded = Math.ceil(finalRefill / config.pack_size);
            }

            return {
                ...item, config, todayUsed, lastWeekUsed, rawTarget, actual, finalRefill, packsNeeded, minStock
            };
        }).filter(item => item.finalRefill > 0);
    }, [shiftClosing, todayEstimatedConsumption, lastWeekConsumption, ingredientConfigs]);

    if (!shiftClosing?.inventory_report?.length) return null;

    return (
        <div className="bg-surface rounded-[20px] p-4 border border-border/60 shadow-sm flex flex-col gap-3">
            {/* Header & Tabs — hidden when forcedTab pins the view (parent already owns its own tab nav). */}
            {!forcedTab && !isPastDate ? (
                <div className="flex flex-col gap-3 border-b border-border/40 pb-3">
                    <div className="flex p-1 bg-surface-light rounded-[12px] gap-1 w-full">
                        <button
                            onClick={() => setActiveTab('audit')}
                            className={`flex-1 py-1.5 rounded-[10px] uppercase text-[13px] font-bold transition-all ${activeTab === 'audit' ? 'bg-surface text-text shadow-sm' : 'text-text-secondary/70 hover:text-text'}`}
                        >
                            Hao hụt
                        </button>
                        <button
                            onClick={() => setActiveTab('refill')}
                            className={`flex-1 py-1.5 rounded-[10px] uppercase text-[13px] font-bold transition-all flex items-center justify-center gap-1 ${activeTab === 'refill' ? 'bg-primary/70 text-white shadow-sm' : 'text-text-secondary/70 hover:text-text'}`}
                        >
                            Bổ sung
                        </button>
                    </div>
                </div>
            ) : !forcedTab && isPastDate ? (
                <div className="flex flex-col gap-3 border-b border-border/40 pb-3">
                    <div className="flex items-center justify-center w-full">
                        <span className="text-[13px] font-bold text-text uppercase tracking-widest opacity-80">Hao hụt trong ngày</span>
                    </div>
                </div>
            ) : null}

            {/* Audit Tab */}
            {activeTab === 'audit' && (
                <div className="flex flex-col">
                    <div className="space-y-3 pb-3">
                        {auditData.rows.length === 0 ? (
                            <div className="py-4 text-center flex flex-col items-center gap-1">
                                <span className="text-[14px] font-bold text-success">Tuyệt vời!</span>
                                <span className="text-[12px] text-text-secondary">Chưa có dữ liệu tồn kho để đối chiếu.</span>
                            </div>
                        ) : auditData.rows.map(item => {
                            const isExpanded = !!expandedRows[item.ingredient];

                            return (
                                <div key={item.ingredient} className="flex flex-col border-b border-border/20 last:border-0 pb-3 last:pb-0">
                                    <div
                                        className="flex flex-col cursor-pointer group"
                                        onClick={() => toggleRow(item.ingredient)}
                                    >

                                        <div className="flex items-center justify-between gap-1 mb-0.5">
                                            <span className="text-[14px] font-bold text-text leading-tight">
                                                {ingredientLabel(item.ingredient)}
                                            </span>
                                            <ChevronDown size={14} className={`text-text-dim shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                                        </div>

                                        <div className='flex justify-between w-full'>
                                            <div className="flex flex-col flex-1 pr-2">
                                                <span className="text-[11px] font-medium text-text-secondary">
                                                    <span className="mx-1 text-border">•</span> Đầu kỳ: {item.opening}
                                                </span>
                                                <span className="text-[11px] font-medium text-text-secondary">
                                                    <span className="mx-1 text-border">•</span> Nhập thêm: {item.restock}
                                                </span>
                                                <span className="text-[11px] font-medium text-text-secondary">
                                                    <span className="mx-1 text-border">•</span> Sử dụng: {item.used}
                                                </span>
                                            </div>

                                            <div className="flex flex-col flex-1 items-end">

                                                <span className="text-[11px] font-medium text-text-secondary">
                                                    <span className="mx-1 text-border">•</span> Lý thuyết: {item.theoretical}
                                                </span>
                                                <span className="text-[11px] font-medium text-text-secondary">
                                                    <span className="mx-1 text-border">•</span> Tồn kho: {item.actual}
                                                </span>
                                                <span className={`text-[11px] font-black tabular-nums ${item.diffColor}`}>
                                                    <span className="mx-1 text-border">•</span> {item.diffText}
                                                </span>
                                                {item.equivText && (
                                                    <span className="text-[11px] font-bold text-danger/80 text-right">{item.equivText}</span>
                                                )}
                                            </div>
                                        </div>

                                    </div>

                                    {isExpanded && (
                                        <div className="mt-3 px-3 py-2.5 bg-surface-light rounded-[12px] border border-border/40 flex flex-col gap-2.5">

                                            {Object.keys(item.bd || {}).length > 0 && (
                                                <div className=" flex flex-col gap-1">
                                                    {/* <span className="text-[9px] font-black text-text-dim uppercase mb-0.5">Chi tiết sử dụng</span> */}
                                                    {Object.values(item.bd)
                                                        .sort((a, b) => b.totalAmount - a.totalAmount)
                                                        .map((entry, i) => (
                                                            <div key={i} className="flex items-center justify-between">
                                                                <span className="text-[11px] text-text-secondary truncate flex-1">{entry.name}</span>
                                                                <span className="text-[11px] font-bold text-text-dim tabular-nums shrink-0 ml-2">
                                                                    {entry.qty} ly × {Math.round(entry.totalAmount / entry.qty * 10) / 10} = <span className="text-text font-black">{entry.totalAmount}</span>
                                                                </span>
                                                            </div>
                                                        ))
                                                    }
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {auditData.totalLossValue > 0 && (
                        <div className="mt-2 flex flex-col">
                            <div
                                className="pt-3 border-t border-border/40 flex items-center justify-between cursor-pointer"
                                onClick={() => setIsLossExpanded(!isLossExpanded)}
                            >
                                <div className="flex items-center gap-1">
                                    <span className="text-[12px] font-bold text-text-secondary">Tổng giá trị hao hụt:</span>
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
            )}

            {/* Refill Tab */}
            {activeTab === 'refill' && (
                <div className="flex flex-col">
                    {isLoadingPast ? (
                        <div className="py-4 text-center text-text-dim text-[12px] animate-pulse">Đang dự báo AI...</div>
                    ) : refillData.length === 0 ? (
                        <div className="py-4 text-center flex flex-col items-center gap-1">
                            <span className="text-[14px] font-bold text-success">Kho đủ dùng!</span>
                            <span className="text-[12px] text-text-secondary">Không cần đi chợ thêm cho ngày mai.</span>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {refillData.map(item => {
                                const unit = getIngredientUnit(item.ingredient, item.unit, ingredientUnits);
                                return (
                                    <div key={item.ingredient} className="flex items-start justify-between border-b border-border/20 pb-3 last:border-0 last:pb-0">
                                        <div className="flex flex-col flex-1 pr-2 gap-0.5">
                                            <span className="text-[14px] font-bold text-text leading-tight mb-0.5">
                                                {ingredientLabel(item.ingredient)}
                                            </span>
                                            <span className="text-[11px] font-medium text-text-secondary">
                                                Tồn: {item.actual} {unit}
                                            </span>
                                            <span className="text-[11px] font-medium text-text-secondary">
                                                Dự báo tiêu thụ: {item.rawTarget} {unit}
                                            </span>
                                        </div>

                                        <div className="flex flex-col items-end shrink-0 ">
                                            {item.packsNeeded > 0 ? (
                                                <div className="flex flex-col items-end">
                                                    <span className="text-[14px] font-black text-warning leading-none mb-1">
                                                        + {item.finalRefill} {unit}
                                                    </span>
                                                    <span className="text-[10px] font-bold text-text-dim">
                                                        {item.packsNeeded} {item.config.pack_unit || " "} {ingredientLabel(item.ingredient).toLowerCase()}
                                                    </span>
                                                </div>
                                            ) : (
                                                <span className="text-[14px] font-black text-warning">
                                                    +{item.finalRefill} <span className="text-[11px] font-bold">{unit}</span>
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
