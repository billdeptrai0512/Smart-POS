import { useMemo } from 'react'
import { BarChart, Bar, XAxis, ResponsiveContainer, Cell, Tooltip } from 'recharts'
import { formatVND } from '../../utils'

const DAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

function countableQty(items, countMap) {
    return (items || []).reduce((s, i) => {
        if (countMap.get(i.product_id) === false) return s
        return s + (i.quantity || 1)
    }, 0)
}

function buildWeekData(orders, start, countMap) {
    const slots = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(start)
        d.setDate(start.getDate() + i)
        return { label: DAY_LABELS[i], date: new Date(d), cups: 0, revenue: 0 }
    })
    orders.forEach(o => {
        const d = new Date(o.created_at)
        const diff = Math.floor((d - start) / 86400000)
        if (diff >= 0 && diff < 7) {
            slots[diff].cups += countableQty(o.order_items, countMap)
            slots[diff].revenue += o.total
        }
    })
    return slots
}

function buildMonthData(orders, start, end, countMap) {
    const slots = []
    let wStart = new Date(start)
    let wNum = 1
    while (wStart <= end) {
        const wEnd = new Date(wStart)
        wEnd.setDate(wStart.getDate() + 6)
        slots.push({ label: `T${wNum}`, wStart: new Date(wStart), wEnd: new Date(Math.min(wEnd.getTime(), end.getTime())), cups: 0, revenue: 0 })
        wStart.setDate(wStart.getDate() + 7)
        wNum++
    }
    orders.forEach(o => {
        const d = new Date(o.created_at)
        const slot = slots.find(w => d >= w.wStart && d <= w.wEnd)
        if (slot) {
            slot.cups += countableQty(o.order_items, countMap)
            slot.revenue += o.total
        }
    })
    return slots
}

const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const { cups, revenue } = payload[0].payload
    if (!cups) return null
    return (
        <div className="bg-[#1c1917] border border-[#44403c] rounded-[12px] px-3 py-2 shadow-xl">
            <div className="text-[11px] font-black text-warning uppercase mb-1">{label}</div>
            <div className="text-[12px] text-white font-bold">{cups} ly</div>
            <div className="text-[11px] text-[#a8a29e]">{formatVND(revenue)}</div>
        </div>
    )
}

export default function DayPerformanceChart({ orders, range, start, end, products }) {
    const now = new Date()

    const countMap = useMemo(
        () => new Map((products || []).map(p => [p.id, p.count_as_cup !== false])),
        [products]
    )

    const data = useMemo(() => {
        if (!start) return []
        if (range === 'week') return buildWeekData(orders, start, countMap)
        if (range === 'month') return buildMonthData(orders, start, end, countMap)
        return []
    }, [orders, range, start, end, countMap])

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
                    Hiệu suất theo {range === 'week' ? 'ngày' : 'tuần'}
                </h3>
                {bestDay.cups > 0 && (
                    <span className="text-[11px] font-bold text-warning">
                        Cao nhất: {bestDay.cups} ly
                    </span>
                )}
            </div>

            <div className="h-[140px] w-full [&_*]:outline-none [&_*]:focus:outline-none">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} barCategoryGap="28%" margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                        <XAxis
                            dataKey="label"
                            tick={{ fontSize: 10, fill: '#a8a29e', fontWeight: 700 }}
                            axisLine={false}
                            tickLine={false}
                            tickMargin={6}
                        />
                        <Tooltip content={<CustomTooltip />} cursor={false} />
                        <Bar dataKey="cups" radius={[6, 6, 0, 0]}>
                            {data.map((entry, i) => (
                                <Cell
                                    key={i}
                                    fill={isFuture(entry) ? '#292524' : getBarColor(entry)}
                                    fillOpacity={isFuture(entry) ? 0.4 : 1}
                                />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    )
}
