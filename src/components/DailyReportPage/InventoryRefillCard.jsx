import React, { useState, useEffect, useMemo } from 'react';
import { calculateEstimatedConsumption, calculateConsumptionBreakdown } from '../../utils/inventory';
import { ingredientLabel, getIngredientUnit } from '../common/recipeUtils';
import { fetchPastDaysOrderItems } from '../../services/orderService';
import { Settings2, ChevronDown } from 'lucide-react';

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
    ingredientUnits = {}
}) {
    const [wastageBuffer, setWastageBuffer] = useState(10);
    const [past7DaysItems, setPast7DaysItems] = useState([]);
    const [isLoadingPast, setIsLoadingPast] = useState(false);
    const [activeTab, setActiveTab] = useState('audit');
    const [expandedRows, setExpandedRows] = useState({});

    const toggleRow = (ingredient) => {
        setExpandedRows(prev => ({ ...prev, [ingredient]: !prev[ingredient] }));
    };

    useEffect(() => {
        if (selectedAddress?.id) {
            setIsLoadingPast(true);
            fetchPastDaysOrderItems(selectedAddress.id, 7).then(items => {
                setPast7DaysItems(items || []);
            }).finally(() => setIsLoadingPast(false));
        }
    }, [selectedAddress?.id]);

    // All useMemo hooks BEFORE early return (React rules of hooks)

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
        todayOrders.forEach(o => {
            (o.order_items || []).forEach(i => items.push({
                productId: i.product_id, qty: i.quantity || 1,
                extras: (i.extra_ids || []).map(id => ({ id }))
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

    const mappedPastItems = useMemo(() =>
        past7DaysItems.map(i => ({
            productId: i.product_id, qty: i.quantity,
            extras: (i.extra_ids || []).map(id => ({ id }))
        })),
        [past7DaysItems]
    );

    const past7DaysConsumption = useMemo(() =>
        calculateEstimatedConsumption(mappedPastItems, recipes, extraIngredients),
        [mappedPastItems, recipes, extraIngredients]
    );

    if (!shiftClosing?.inventory_report?.length) return null;

    return (
        <div className="bg-surface rounded-[20px] p-4 border border-border/60 shadow-sm flex flex-col gap-3">
            {/* Header & Tabs */}
            <div className="flex flex-col gap-3 border-b border-border/40 pb-2">
                <div className="flex items-center justify-between">
                    <div className="flex p-0.5 bg-surface-light rounded-[12px] gap-1 shrink-0">
                        <button
                            onClick={() => setActiveTab('audit')}
                            className={`px-3 py-1.5 rounded-[10px] text-[11px] font-bold transition-all ${activeTab === 'audit' ? 'bg-surface text-text shadow-sm' : 'text-text-secondary/70 hover:text-text'}`}
                        >
                            Tồn kho
                        </button>
                        <button
                            onClick={() => setActiveTab('refill')}
                            className={`px-3 py-1.5 rounded-[10px] text-[11px] font-bold transition-all flex items-center justify-center gap-1 ${activeTab === 'refill' ? 'bg-primary text-white shadow-sm' : 'text-text-secondary/70 hover:text-text'}`}
                        >
                            Đi chợ
                        </button>
                    </div>

                    {activeTab === 'refill' && (
                        <div className="flex items-center gap-1.5 bg-surface-light px-2 py-1.5 rounded-[10px] border border-border/40 shrink-0">
                            <Settings2 size={12} className="text-text-secondary" />
                            <span className="text-[10px] font-bold text-text-secondary uppercase">Hao hụt:</span>
                            <select
                                value={wastageBuffer}
                                onChange={(e) => setWastageBuffer(Number(e.target.value))}
                                className="bg-transparent text-[11px] font-black text-primary focus:outline-none cursor-pointer appearance-none text-right"
                            >
                                <option value={0}>0%</option>
                                <option value={5}>5%</option>
                                <option value={10}>10%</option>
                                <option value={15}>15%</option>
                                <option value={20}>20%</option>
                                <option value={30}>30%</option>
                            </select>
                        </div>
                    )}
                </div>

                {activeTab === 'audit' ? (
                    <div className="flex items-center gap-1 mt-1 px-1">
                        <span className="flex-1 text-[10px] font-black text-text-dim uppercase">Nguyên liệu</span>
                        <span className="w-[52px] text-[10px] font-black text-text-dim uppercase text-center" title="Lý thuyết hôm nay">Lý.T</span>
                        <span className="w-[52px] text-[10px] font-black text-text-dim uppercase text-center" title="Thực tế hôm nay">T.Tế</span>
                        <span className="w-[56px] text-[10px] font-black text-text-dim uppercase text-center" title="Lệch">Lệch</span>
                    </div>
                ) : (
                    <div className="flex items-center gap-1 mt-1 px-1">
                        <span className="flex-1 text-[10px] font-black text-text-dim uppercase">Nguyên liệu</span>
                        <span className="w-[50px] text-[10px] font-black text-text-dim uppercase text-center">Tồn</span>
                        <span className="w-[50px] text-[10px] font-black text-text-dim uppercase text-center" title={`Mục tiêu ngày mai (Kèm ${wastageBuffer}% hao hụt)`}>Sử dụng</span>
                        <span className="w-[50px] text-[10px] font-black text-text-dim uppercase text-center" title="Số lượng cần mua thêm">Mua</span>
                    </div>
                )}
            </div>

            <div className="space-y-1">
                {shiftClosing.inventory_report.map(item => {
                    const opening = openingMap[item.ingredient] ?? 0;
                    const restock = item.restock || 0;
                    const used = Math.round((todayEstimatedConsumption[item.ingredient] || 0) * 10) / 10;

                    const theoretical = Math.round((opening + restock - used) * 10) / 10;
                    const actual = item.remaining || 0;
                    const diff = Math.round((actual - theoretical) * 10) / 10;

                    let diffText, diffColor;
                    if (diff < 0) {
                        diffText = `Hụt ${Math.abs(diff)}`;
                        diffColor = 'text-danger';
                    } else if (diff > 0) {
                        diffText = `Dư ${diff}`;
                        diffColor = 'text-warning';
                    } else {
                        diffText = 'Khớp';
                        diffColor = 'text-success';
                    }

                    const total7DayUsed = past7DaysConsumption[item.ingredient] || 0;
                    const dailyAvgAvg = total7DayUsed / 7;
                    const target = Math.round(dailyAvgAvg * (1 + wastageBuffer / 100) * 10) / 10;

                    let refill = Math.round((target - actual) * 10) / 10;
                    if (refill <= 0) refill = 0;

                    const isExpanded = !!expandedRows[item.ingredient];
                    const canExpand = activeTab === 'audit';

                    return (
                        <div key={item.ingredient} className="border-b border-border/20 last:border-0">
                            <div
                                className={`flex items-center gap-1 py-2 rounded-lg transition-colors px-1 ${canExpand ? 'cursor-pointer active:bg-surface-light' : ''} ${isExpanded ? 'bg-surface-light' : 'hover:bg-surface-light'}`}
                                onClick={canExpand ? () => toggleRow(item.ingredient) : undefined}
                            >
                                <div className="flex-1 min-w-0 pr-1 flex items-center gap-1">
                                    <span className="text-[12px] font-bold text-text truncate">
                                        {ingredientLabel(item.ingredient)}
                                        <span className="text-[10px] font-normal text-text-dim ml-1">({getIngredientUnit(item.ingredient, item.unit, ingredientUnits)})</span>
                                    </span>
                                    {canExpand && (
                                        <ChevronDown
                                            size={12}
                                            className={`text-text-dim shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                                        />
                                    )}
                                </div>

                                {activeTab === 'audit' ? (
                                    <>
                                        <span className="w-[52px] text-[12px] font-bold text-text text-center tabular-nums">{theoretical}</span>
                                        <span className="w-[52px] text-[12px] font-bold text-text text-center tabular-nums">{actual}</span>
                                        <span className={`w-[56px] text-[11px] font-black text-center tabular-nums ${diffColor}`}>{diffText}</span>
                                    </>
                                ) : (
                                    <>
                                        <span className="w-[50px] text-[12px] font-bold text-text text-center tabular-nums">{actual}</span>
                                        <span className="w-[50px] text-[12px] font-bold text-text text-center tabular-nums">
                                            {isLoadingPast ? '...' : target > 0 ? target : '—'}
                                        </span>
                                        <span className={`w-[50px] text-[11px] font-black text-center tabular-nums ${refill > 0 ? 'text-warning' : 'text-success'}`}>
                                            {isLoadingPast ? '...' : refill > 0 ? `+${refill}` : 'Ok'}
                                        </span>
                                    </>
                                )}
                            </div>

                            {isExpanded && activeTab === 'audit' && (
                                <div className="mx-1 mb-2 px-3 py-2.5 bg-surface rounded-[10px] border border-border/40 flex flex-col gap-2.5">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            <div className="flex flex-col items-center">
                                                <span className="text-[13px] font-black text-text tabular-nums">{opening}</span>
                                                <span className="text-[9px] font-bold text-text-dim uppercase mt-0.5">Đầu kỳ</span>
                                            </div>
                                            <span className="text-[11px] font-black text-text-dim">+</span>
                                            <div className="flex flex-col items-center">
                                                <span className="text-[13px] font-black text-text tabular-nums">{restock}</span>
                                                <span className="text-[9px] font-bold text-text-dim uppercase mt-0.5">Nhập</span>
                                            </div>
                                            <span className="text-[11px] font-black text-text-dim">−</span>
                                            <div className="flex flex-col items-center">
                                                <span className="text-[13px] font-black text-text tabular-nums">{used}</span>
                                                <span className="text-[9px] font-bold text-text-dim uppercase mt-0.5">Tiêu CT</span>
                                            </div>
                                            <span className="text-[11px] font-black text-text-dim">=</span>
                                            <div className="flex flex-col items-center">
                                                <span className="text-[13px] font-black text-text tabular-nums">{theoretical}</span>
                                                <span className="text-[9px] font-bold text-text-dim uppercase mt-0.5">Lý.T</span>
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-center shrink-0">
                                            <span className={`text-[13px] font-black tabular-nums ${diffColor}`}>{actual}</span>
                                            <span className="text-[9px] font-bold text-text-dim uppercase mt-0.5">T.Tế</span>
                                        </div>
                                    </div>

                                    {consumptionBreakdown[item.ingredient] && Object.keys(consumptionBreakdown[item.ingredient]).length > 0 && (
                                        <div className="border-t border-border/30 pt-2 flex flex-col gap-1">
                                            <span className="text-[9px] font-black text-text-dim uppercase mb-0.5">Chi tiết Tiêu CT</span>
                                            {Object.values(consumptionBreakdown[item.ingredient])
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
        </div>
    );
}
