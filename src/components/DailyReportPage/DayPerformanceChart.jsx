import { memo, useMemo, useState, useRef } from 'react'
import { formatVND } from '../../utils'
import { useClickOutside } from '../../hooks/useClickOutside'

const DAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

function countableQty(items, countMap) {
    return (items || []).reduce((s, i) => {
        if (countMap.get(i.product_id) === false) return s
        return s + (i.quantity || 1)
    }, 0)
}

// 7 cột T2..CN, mọi order gộp theo THỨ trong tuần.
//   `start` có → tuần cụ thể: gắn thêm `date` cho từng cột để làm mờ ngày chưa tới.
//   `start` null (tháng/custom) → mỗi cột là tổng của thứ đó trên cả kỳ, không có
//   ngày cụ thể nên không cột nào bị làm mờ.
function buildDayData(orders, countMap, start) {
    const slots = DAY_LABELS.map((label, i) => {
        if (!start) return { label, cups: 0, revenue: 0 }
        const d = new Date(start)
        d.setDate(start.getDate() + i)
        return { label, date: d, cups: 0, revenue: 0 }
    })
    for (const o of orders) {
        const idx = (new Date(o.created_at).getDay() + 6) % 7 // 0=Mon … 6=Sun
        slots[idx].cups += countableQty(o.order_items, countMap)
        slots[idx].revenue += o.total
    }
    return slots
}

// memo: only mounts in range scope, but the parent still re-renders on unrelated
// state changes — props (orders/range/start/products) are stable refs, so memo
// keeps the bar chart from re-rendering needlessly.
function DayPerformanceChart({ orders, range, start, products }) {
    const now = new Date()
    const [active, setActive] = useState(null)
    const chartRef = useRef(null)
    useClickOutside(chartRef, () => setActive(null), { active: active !== null })

    const countMap = useMemo(
        () => new Map((products || []).map(p => [p.id, p.count_as_cup !== false])),
        [products]
    )

    const data = useMemo(
        () => (start ? buildDayData(orders, countMap, range === 'week' ? start : null) : []),
        [orders, range, start, countMap],
    )

    const maxCups = useMemo(() => Math.max(...data.map(d => d.cups), 1), [data])

    const getBarColor = (entry) => {
        if (entry.cups === 0) return '#292524'
        if (entry.cups === maxCups) return '#f59e0b'
        return '#78716c'
    }

    const isFuture = (entry) => entry.date && entry.date > now

    if (!data.length) return null

    const bestDay = data.reduce((a, b) => b.cups > a.cups ? b : a, data[0])

    return (
        <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <h3 className="text-[12px] font-black uppercase text-text-secondary">
                    Hiệu suất theo ngày
                </h3>
                {bestDay.cups > 0 && (
                    <span className="text-[11px] font-bold text-warning">
                        Cao nhất: {bestDay.cups} ly
                    </span>
                )}
            </div>

            <div ref={chartRef} className="h-[140px] w-full flex flex-col px-1 pt-1">
                <div className="flex-1 flex">
                    {data.map((entry, i) => (
                        <div
                            key={entry.label}
                            className="flex-1 flex items-end justify-center"
                            onMouseEnter={() => setActive(i)}
                            onMouseLeave={() => setActive(null)}
                            onClick={() => setActive(i)}
                        >
                            <div
                                className="relative w-[72%] rounded-t-[6px]"
                                style={{
                                    height: `${(entry.cups / maxCups) * 100}%`,
                                    background: isFuture(entry) ? '#292524' : getBarColor(entry),
                                    opacity: isFuture(entry) ? 0.4 : 1,
                                }}
                            >
                                {active === i && entry.cups > 0 && (
                                    <div className={`absolute bottom-full mb-1 z-10 whitespace-nowrap bg-[#1c1917] border border-[#44403c] rounded-[12px] px-3 py-2 shadow-xl ${i === 0 ? 'left-0' : i === data.length - 1 ? 'right-0' : 'left-1/2 -translate-x-1/2'}`}>
                                        <div className="text-[11px] font-black text-warning uppercase mb-1">{entry.label}</div>
                                        <div className="text-[12px] text-white font-bold">{entry.cups} ly</div>
                                        <div className="text-[11px] text-[#a8a29e]">{formatVND(entry.revenue)}</div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
                <div className="flex pt-1.5">
                    {data.map(entry => (
                        <span key={entry.label} className="flex-1 text-center text-[10px] font-bold text-[#a8a29e]">{entry.label}</span>
                    ))}
                </div>
            </div>
        </div>
    )
}

export default memo(DayPerformanceChart)
