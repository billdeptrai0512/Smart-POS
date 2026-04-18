import { Activity } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'

export default function HeatmapChart({ hourRange, soldProducts, products, heatmapData, maxHeatmapQty }) {
    const [tooltip, setTooltip] = useState(null)
    const tooltipRef = useRef(null)

    useEffect(() => {
        if (!tooltip) return
        const handleClickOutside = (e) => {
            if (tooltipRef.current && !tooltipRef.current.contains(e.target)) {
                setTooltip(null)
            }
        }
        document.addEventListener('pointerdown', handleClickOutside)
        return () => document.removeEventListener('pointerdown', handleClickOutside)
    }, [tooltip])

    const handleCellClick = (e, pName, qty, hour) => {
        if (qty === 0) return
        const rect = e.currentTarget.getBoundingClientRect()
        const parentRect = e.currentTarget.closest('.heatmap-container').getBoundingClientRect()
        setTooltip({
            name: pName,
            qty,
            hour,
            x: rect.left - parentRect.left + rect.width / 2,
            y: rect.top - parentRect.top
        })
    }

    return (
        <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 overflow-hidden">
            <div className="flex flex-col mb-4">
                <div className="flex justify-between items-center gap-2">
                    <h3 className="text-[13px] font-black uppercase text-text-secondary">Lượng khách</h3>
                    <Activity className="text-primary" size={20} />
                </div>
            </div>

            {hourRange.length > 0 ? (
                <div className="pb-2">
                    <div className="heatmap-container relative">
                        {/* Tooltip popup giống RevenueChart */}
                        {tooltip && (
                            <div
                                ref={tooltipRef}
                                className="absolute z-20 pointer-events-none"
                                style={{
                                    left: tooltip.x,
                                    top: tooltip.y,
                                    transform: 'translate(-50%, -100%)',
                                }}
                            >
                                <div
                                    className="pointer-events-auto px-3 py-2 rounded-xl shadow-lg text-center whitespace-nowrap"
                                    style={{
                                        backgroundColor: '#1c1917',
                                        border: '1px solid #44403c',
                                    }}
                                >
                                    <div style={{ color: '#fafaf9', fontWeight: 'bold', fontSize: '12px', marginBottom: '2px' }}>
                                        {tooltip.hour}:00 - {tooltip.hour + 1}:00
                                    </div>
                                    <div style={{ color: '#f59e0b', fontSize: '13px', fontWeight: 'bold' }}>
                                        {tooltip.name}: {tooltip.qty} ly
                                    </div>
                                </div>
                            </div>
                        )}

                        {Array.from(soldProducts).map(productId => {
                            const prodDef = products.find(p => p.id === productId)
                            const pName = prodDef ? prodDef.name : 'Unknown'
                            return (
                                <div key={productId} className="flex items-center py-[2px] gap-[2px]">
                                    {hourRange.map(h => {
                                        const qty = heatmapData[productId]?.[h] || 0
                                        const intensity = maxHeatmapQty > 0 ? qty / maxHeatmapQty : 0
                                        return (
                                            <div
                                                key={h}
                                                className="flex-1 flex justify-center cursor-pointer"
                                                onClick={(e) => handleCellClick(e, pName, qty, h)}
                                            >
                                                <div
                                                    className="w-full aspect-square rounded-lg flex items-center justify-center text-[12px] font-bold transition-all hover:scale-110"
                                                    style={{
                                                        backgroundColor: qty > 0 ? `rgba(245, 158, 11, ${Math.max(0.15, intensity)})` : 'transparent',
                                                        color: qty > 0 ? (intensity > 0.5 ? '#fff' : '#f59e0b') : 'transparent',
                                                    }}
                                                >
                                                    {qty > 0 ? qty : ''}
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )
                        })}

                        {/* Khung giờ ở dưới — style giống XAxis của RevenueChart */}
                        <div className="flex pt-3 mt-2 gap-[2px]">
                            {hourRange.map(h => (
                                <div key={h} className="flex-1 text-center text-[10px] leading-tight" style={{ color: '#a8a29e' }}>
                                    {h}h
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="text-center text-text-secondary text-[12px] py-4 bg-surface-light rounded-xl border border-border/40">
                    Chưa có dữ liệu hôm nay
                </div>
            )}
        </div>
    )
}
