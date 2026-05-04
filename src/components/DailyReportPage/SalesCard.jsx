import { useState, useEffect, useRef } from 'react'
import { Filter, TrendingUp } from 'lucide-react'
import { LineChart, Line, CartesianGrid, XAxis } from 'recharts'
import { formatVND } from '../../utils'

const CHART_HEIGHT = 200

export default function SalesCard({
    totalCups,
    selectedProductId,
    onFilterChange,
    products,
    soldProducts,
    totalRevenue,
    productStats,
    lineChartData,
}) {
    const selectedProduct = selectedProductId !== 'all' ? products.find(p => p.id === selectedProductId) : null
    const singleStats = selectedProduct && productStats?.[selectedProductId] ? productStats[selectedProductId] : null
    const displayRevenue = singleStats ? singleStats.revenue : totalRevenue

    const [activePoint, setActivePoint] = useState(null)
    const [chartWidth, setChartWidth] = useState(0)
    const wrapperRef = useRef(null)

    useEffect(() => {
        if (!wrapperRef.current) return
        const ro = new ResizeObserver(([entry]) => setChartWidth(entry.contentRect.width))
        ro.observe(wrapperRef.current)
        return () => ro.disconnect()
    }, [])

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setActivePoint(null)
        }
        document.addEventListener('mousedown', handleClickOutside)
        document.addEventListener('touchstart', handleClickOutside)
        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
            document.removeEventListener('touchstart', handleClickOutside)
        }
    }, [])

    const handleChartClick = (e) => {
        if (e?.target?.tagName !== 'circle') setActivePoint(null)
    }

    const CustomDot = (props) => {
        const { cx, cy, payload, index } = props
        const isActive = activePoint?.hour === payload.hour
        const prevEntry = index > 0 ? lineChartData[index - 1] : null
        return (
            <circle
                cx={cx} cy={cy}
                r={isActive ? 7 : 5}
                fill={isActive ? '#f59e0b' : '#1c1917'}
                stroke="#f59e0b"
                strokeWidth={isActive ? 2 : 3}
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                    e.stopPropagation()
                    if (isActive) {
                        setActivePoint(null)
                    } else {
                        setActivePoint({
                            cx, cy,
                            hour: payload.hour,
                            items: payload.items || [],
                            hourRevenue: payload.hourRevenue || 0,
                            revenue: payload.revenue || 0,
                            prevRevenue: prevEntry ? prevEntry.hourRevenue : null,
                        })
                    }
                }}
            />
        )
    }

    const getTooltipStyle = () => {
        if (!activePoint || !wrapperRef.current) return {}
        const wrapperWidth = wrapperRef.current.offsetWidth
        const wrapperHeight = wrapperRef.current.offsetHeight
        const tooltipWidth = 220
        const left = Math.max(tooltipWidth / 2 + 8, Math.min(activePoint.cx, wrapperWidth - tooltipWidth / 2 - 8))
        const showBelow = activePoint.cy < wrapperHeight / 2
        return {
            position: 'absolute',
            left,
            top: activePoint.cy,
            transform: showBelow ? 'translate(-50%, 14px)' : 'translate(-50%, calc(-100% - 14px))',
            zIndex: 50,
            pointerEvents: 'none',
            width: 'fit-content',
            minWidth: 140,
            maxWidth: tooltipWidth,
        }
    }

    return (
        <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col gap-4">
            {/* Row: Tổng cộng + Doanh thu */}
            <div className="flex items-start justify-between">
                {/* Left: cup count */}
                <div className="flex flex-col min-w-0 flex-1 mt-1">
                    <span className="text-[12px] font-black text-text-secondary uppercase mb-1">Tổng cộng</span>
                    <span className="text-[17px] font-bold text-primary tabular-nums leading-none truncate">
                        {totalCups} ly {selectedProduct ? selectedProduct.name.toLowerCase() : ''}
                    </span>
                    {singleStats && singleStats.variants && Object.keys(singleStats.variants).length > 0 && (
                        <div className="flex flex-col gap-0.5 mt-1.5">
                            {Object.entries(singleStats.variants)
                                .sort((a, b) => b[1] - a[1])
                                .map(([label, qty]) => (
                                    <span key={label} className="text-[11px] text-text-secondary tabular-nums">
                                        · {label}: <span className="font-black text-text">{qty} ly</span>
                                    </span>
                                ))}
                        </div>
                    )}
                </div>

                {/* Right: revenue + filter */}
                <div className="flex flex-col items-end shrink-0 ml-3">
                    <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[12px] font-black text-text-secondary uppercase">Doanh thu</span>
                        <div className="mb-0.5 relative flex items-center justify-center w-5 h-5 bg-surface-light rounded-full border border-border/40 text-text-secondary hover:text-primary transition-colors cursor-pointer">
                            <Filter size={10} className={selectedProductId !== 'all' ? 'text-primary' : ''} />
                            <select
                                value={selectedProductId}
                                onChange={(e) => onFilterChange(e.target.value)}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            >
                                <option value="all">Tất cả</option>
                                {products.filter(p => soldProducts.has(p.id)).sort((a, b) => a.name.localeCompare(b.name)).map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div className={`px-3 py-1 rounded-xl border ${displayRevenue > 0 ? 'bg-success/10 border-success/20 text-success' : 'bg-surface-light border-border/40 text-text-secondary'}`}>
                        <span className="text-[14px] font-black tabular-nums leading-none block">
                            {formatVND(displayRevenue || 0)}
                        </span>
                    </div>
                </div>
            </div>

            {/* Revenue % bar (single product) */}
            {singleStats && (
                <div className="pt-1 border-t border-border/30">
                    <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-black tabular-nums text-primary">
                            {totalRevenue > 0 ? ((singleStats.revenue / totalRevenue) * 100).toFixed(1) : 0}%
                        </span>
                        <span className="text-[10px] font-bold text-primary">100%</span>
                    </div>
                    <div className="h-[6px] rounded-full bg-border/30 overflow-hidden">
                        <div
                            className="h-full rounded-full bg-primary transition-all duration-300"
                            style={{ width: `${totalRevenue > 0 ? Math.max(2, (singleStats.revenue / totalRevenue) * 100) : 0}%` }}
                        />
                    </div>
                </div>
            )}

            {/* Divider */}
            <div className="h-[1px] bg-border/30 -mx-1" />

            {/* Revenue chart */}
            <div>
                <div className="flex justify-between items-center mb-2 pl-1">
                    <h3 className="text-[11px] font-black uppercase text-text-secondary tracking-widest">Dòng tiền theo giờ</h3>
                    <TrendingUp className="text-warning" size={16} />
                </div>

                {lineChartData.length > 0 ? (
                    <div
                        className="w-full relative [&_*]:outline-none [&_*]:focus:outline-none"
                        style={{ height: CHART_HEIGHT }}
                        ref={wrapperRef}
                        onClick={handleChartClick}
                    >
                        {activePoint && (
                            <div style={getTooltipStyle()}>
                                <div className="bg-[#1c1917] border border-[#44403c] rounded-[14px] px-3 py-2.5 shadow-xl">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-[11px] font-black text-warning uppercase tracking-wider">{activePoint.hour}</span>
                                        <span className="text-[11px] font-black text-warning">+{formatVND(activePoint.hourRevenue)}</span>
                                    </div>
                                    {activePoint.items.length === 0 ? (
                                        <span className="text-[12px] text-[#a8a29e]">Không có đơn</span>
                                    ) : (
                                        <div className="flex flex-col gap-1 mb-2">
                                            {activePoint.items.map((item, i) => (
                                                <span key={i} className="text-[12px] text-[#fafaf9] font-medium leading-snug">
                                                    {item.qty} {item.name}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    {activePoint.prevRevenue !== null && (
                                        <div className="flex flex-col items-start border-t border-[#44403c] pt-1.5 mt-1">
                                            <span className="text-[11px] text-warning">Tổng: {formatVND(activePoint.revenue)}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                        {chartWidth > 0 && (
                            <LineChart width={chartWidth} height={CHART_HEIGHT} data={lineChartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#44403c" vertical={false} />
                                <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#a8a29e' }} axisLine={false} tickLine={false} tickMargin={10} />
                                <Line
                                    type="monotone"
                                    dataKey="revenue"
                                    stroke="#f59e0b"
                                    strokeWidth={4}
                                    dot={<CustomDot />}
                                    activeDot={false}
                                />
                            </LineChart>
                        )}
                    </div>
                ) : (
                    <div className="text-center text-text-secondary text-[12px] py-4 bg-surface-light rounded-xl border border-border/40">
                        Chưa có dòng tiền trong ngày
                    </div>
                )}
            </div>
        </div>
    )
}
