import { memo, useState, useRef } from 'react'
import { ChevronDown } from 'lucide-react'
import { formatVND } from '../../utils'
import { useClickOutside } from '../../hooks/useClickOutside'

// memo: parent (DailyReportPage) re-renders on every cash/inventory keystroke;
// all props here come from page-level useMemo / stable setters, so memo lets the
// chart subtree bail out instead of re-rendering per keystroke.
function SalesCard({
    totalCups,
    products,
    soldProducts,
    totalRevenue,
    productStats,
    lineChartData,
    showChart = true,
}) {
    const [expandedId, setExpandedId] = useState(null)
    const [showAllProducts, setShowAllProducts] = useState(false)
    // Tap a column to pin its tooltip; tap it again (or anywhere else) to close.
    const [activeIdx, setActiveIdx] = useState(null)
    const wrapperRef = useRef(null)

    useClickOutside(wrapperRef, () => setActiveIdx(null))

    const peakRevenue = lineChartData.length > 0 ? Math.max(...lineChartData.map(d => d.hourRevenue)) : 0
    const barPct = (d) => (peakRevenue ? (d.hourRevenue / peakRevenue) * 100 : 0)
    const active = activeIdx != null ? lineChartData[activeIdx] : null
    const tipPos = ((activeIdx + 0.5) / lineChartData.length) * 100

    const rankedProducts = Object.entries(productStats || {})
        .filter(([id]) => soldProducts.has(id))
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .map(([id, stats]) => ({ id, name: products.find(p => p.id === id)?.name || '', ...stats }))

    return (
        <div className="bg-surface rounded-[24px] p-5 shadow-sm border border-border/60 flex flex-col gap-4">
            {/* Row: Tổng cộng + Doanh thu */}
            <div className="flex items-start justify-between">
                {/* Left: cup count */}
                <div className="flex flex-col min-w-0 flex-1 mt-1">
                    <span className="text-[12px] font-black text-text uppercase mb-1">Tổng cộng</span>
                    <span className="text-[17px] font-bold text-primary tabular-nums leading-none truncate">
                        {totalCups} ly
                    </span>
                </div>

                {/* Right: revenue */}
                <div className="flex flex-col items-end shrink-0 ml-3">
                    <span className="text-[12px] font-black text-text uppercase mb-0.5">Doanh thu</span>
                    <span className={`text-[17px] font-bold tabular-nums leading-none ${totalRevenue > 0 ? 'text-success' : 'text-text-secondary'}`}>
                        {formatVND(totalRevenue || 0)}
                    </span>
                </div>
            </div>

            {rankedProducts.length > 0 && (<>
                <div className="h-[1px] bg-border/30 -mx-1" />
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-[11px] font-black uppercase text-text-secondary tracking-widest">Trong đó</h3>
                        {rankedProducts.length > 3 && (
                            <button
                                type="button"
                                onClick={() => setShowAllProducts(v => !v)}
                                aria-label={showAllProducts ? 'Thu gọn' : 'Xem thêm'}
                                className="text-text-secondary hover:text-primary transition-colors"
                            >
                                <ChevronDown size={16} className={`transition-transform ${showAllProducts ? 'rotate-180' : ''}`} />
                            </button>
                        )}
                    </div>
                    <div className="flex flex-col gap-1">
                        {(showAllProducts ? rankedProducts : rankedProducts.slice(0, 3)).map((p) => {
                            const isExpanded = expandedId === p.id
                            // >1 check, not >0: a single-variant product (everything bucketed
                            // under 'Thường') would just repeat the qty already shown above.
                            const variants = p.variants && Object.keys(p.variants).length > 1
                                ? Object.entries(p.variants).sort((a, b) => {
                                    if (a[0] === 'Thường') return -1
                                    if (b[0] === 'Thường') return 1
                                    return b[1] - a[1]
                                })
                                : []
                            return (
                                <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => setExpandedId(isExpanded ? null : p.id)}
                                    className="flex flex-col text-left rounded-lg -mx-1 px-1 py-1"
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="text-[12px] font-bold truncate text-text">
                                            {p.name} <span className="text-text-secondary font-medium">x {p.qty} ly</span>
                                        </span>
                                        <span className="text-[13px] font-black text-primary tabular-nums shrink-0 ml-2">{formatVND(p.revenue)}</span>
                                    </div>
                                    {isExpanded && variants.length > 0 && (
                                        <div className="flex flex-col gap-0.5">
                                            {variants.map(([label, qty]) => (
                                                <span key={label} className="text-[11px] text-text-secondary tabular-nums">
                                                    <span className="text-[8px] leading-none text-text-dim">●</span> <span className="font-black text-text">{label}</span>: {qty} ly
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </button>
                            )
                        })}
                    </div>
                </div>
            </>)}

            {/* Revenue chart — hidden on range scopes (bar chart shown separately) */}
            {showChart && (<>
            <div>
                {lineChartData.length > 0 ? (
                    <div
                        className="w-full h-[200px] relative flex flex-col pt-5"
                        ref={wrapperRef}
                        onClick={() => setActiveIdx(null)}
                    >
                        <div className="relative flex-1 flex">
                            {[0, 25, 50, 75].map(p => (
                                <div key={p} className="absolute inset-x-0 border-t border-dashed border-[#44403c]" style={{ top: `${p}%` }} />
                            ))}
                            {active && (
                                // Always above the bar's top edge — a below-placement can land on top of
                                // neighboring hour columns and block taps on them. left p% + translateX(-p%)
                                // keeps it inside both edges at any width without measuring.
                                <div
                                    className="absolute z-50 pointer-events-none w-max min-w-[140px] max-w-[220px]"
                                    style={{ left: `${tipPos}%`, bottom: `calc(${barPct(active)}% + 14px)`, transform: `translateX(-${tipPos}%)` }}
                                >
                                    <div className="bg-[#1c1917] border border-[#44403c] rounded-[14px] px-3 py-2.5 shadow-xl">
                                        <div className="flex items-center justify-between gap-3 mb-2">
                                            <span className="text-[11px] font-black text-warning uppercase tracking-wider">{active.hour}</span>
                                            <span className="text-[11px] font-black text-warning">+{formatVND(active.hourRevenue || 0)}</span>
                                        </div>
                                        {!active.items?.length ? (
                                            <span className="text-[12px] text-[#a8a29e]">Không có đơn</span>
                                        ) : (
                                            <div className="flex flex-col gap-1 mb-2">
                                                {active.items.map((item, i) => (
                                                    <span key={i} className="text-[12px] text-[#fafaf9] font-medium leading-snug">
                                                        {item.qty} {item.name}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                        {activeIdx > 0 && (
                                            <div className="flex flex-col items-start border-t border-[#44403c] pt-1.5 mt-1">
                                                <span className="text-[11px] text-warning">Tổng: {formatVND(active.revenue || 0)}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                            {lineChartData.map((d, i) => {
                                const isPeak = peakRevenue > 0 && d.hourRevenue === peakRevenue
                                return (
                                    <div
                                        key={d.hour}
                                        className="flex-1 flex items-end justify-center cursor-pointer"
                                        onClick={(e) => { e.stopPropagation(); setActiveIdx(cur => cur === i ? null : i) }}
                                    >
                                        <div
                                            className={`relative w-[90%] rounded-[4px] ${activeIdx === i || isPeak ? 'bg-[#f59e0b]' : 'bg-[#57534e]'}`}
                                            style={{ height: `max(${barPct(d)}%, 1px)` }}
                                        >
                                            {isPeak && (
                                                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 text-[9px] font-black text-[#f59e0b] whitespace-nowrap">Cao điểm</span>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                        <div className="flex pt-2.5">
                            {lineChartData.map((d, i) => (
                                // ponytail: >12 cột thì chỉ ghi nhãn cách 1 để khỏi đè nhau trên màn hẹp.
                                <span key={d.hour} className="flex-1 text-center text-[10px] text-[#a8a29e] whitespace-nowrap">
                                    {lineChartData.length <= 12 || i % 2 === 0 ? d.hour : ''}
                                </span>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="text-center text-text-secondary text-[12px] py-4 bg-surface-light rounded-xl border border-border/40">
                        Chưa có dòng tiền trong ngày
                    </div>
                )}
            </div>
            </>)}
        </div>
    )
}

export default memo(SalesCard)
