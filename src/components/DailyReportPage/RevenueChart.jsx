import { useState, useEffect, useRef } from 'react'
import { TrendingUp } from 'lucide-react'
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis } from 'recharts'
import { formatVND } from '../../utils'

export default function RevenueChart({ lineChartData }) {
    const [activePoint, setActivePoint] = useState(null)
    const wrapperRef = useRef(null)

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
                setActivePoint(null)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        document.addEventListener('touchstart', handleClickOutside)
        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
            document.removeEventListener('touchstart', handleClickOutside)
        }
    }, [])

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
        // dot ở nửa dưới → tooltip lên trên, dot ở nửa trên → tooltip xuống dưới
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
        <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60">
            <div className="flex flex-col mb-4 pl-2">
                <div className="flex justify-between items-center gap-2">
                    <h3 className="text-[13px] font-black uppercase text-text-second">Dòng tiền</h3>
                    <TrendingUp className="text-warning" size={20} />
                </div>
            </div>

            {lineChartData.length > 0 ? (
                <div className="h-[220px] w-full mt-2 relative" ref={wrapperRef}>
                    {activePoint && (
                        <div style={getTooltipStyle()}>
                            <div className="bg-[#1c1917] border border-[#44403c] rounded-[14px] px-3 py-2.5 shadow-xl">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[11px] font-black text-warning uppercase tracking-wider">
                                        {activePoint.hour}
                                    </span>
                                    <span className="text-[11px] font-black text-warning">
                                        +{formatVND(activePoint.hourRevenue)}
                                    </span>
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
                                    <div className="flex flex-col items-end border-t border-[#44403c] pt-1.5 mt-1">
                                        <span className="text-[11px] text-warning">
                                            Tổng cộng: {formatVND(activePoint.revenue)}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={lineChartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
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
                    </ResponsiveContainer>
                </div>
            ) : (
                <div className="text-center text-text-secondary text-[12px] py-4 bg-surface-light rounded-xl border border-border/40">
                    Chưa có dòng tiền trong ngày
                </div>
            )}
        </div>
    )
}
