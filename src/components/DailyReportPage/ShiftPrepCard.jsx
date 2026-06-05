import { Check } from 'lucide-react'
import { ingredientLabel } from '../../utils/ingredients'
import CollapsibleCard from './CollapsibleCard'

// Checklist card dùng chung cho khu Tồn kho — dùng cho cả "Soạn cho hôm nay"
// (đưa hàng ra quầy) và "Chuẩn bị tồn kho" (đi chợ đắp kho). Mỗi dòng có ô tick
// + so sánh "Còn" (tồn hiện có) vs "Cần" (lượng cần thêm) + quy đổi ra bịch.
//
// items: [{ ingredient, have, need, needPacks, unit, packUnit }]
// Tick (checked/onToggle) + thu gọn (open/onToggleOpen) đều do parent (DailyReportPage) giữ.
export default function ShiftPrepCard({
    items = [],
    checked = {},
    onToggle,
    title = 'Soạn cho hôm nay',
    icon = null,
    emptyTitle = 'Kho đủ dùng!',
    emptyHint = '',
    // Khi set (vd "Mua"): dòng lớn = "<packVerb> N bịch", dòng nhỏ = "Cần X".
    // Hợp với card đi chợ (mua theo bịch/hộp). Bỏ trống → dòng lớn là "Cần X" (soạn loose).
    packVerb = null,
    open = true,
    onToggleOpen,
}) {
    const doneCount = items.reduce((n, it) => n + (checked[it.ingredient] ? 1 : 0), 0)

    return (
        <CollapsibleCard
            icon={icon}
            title={title}
            count={items.length > 0 ? `${doneCount}/${items.length}` : null}
            open={open}
            onToggle={onToggleOpen}
        >
            {items.length === 0 ? (
                <div className="py-3 text-center flex flex-col items-center gap-1">
                    <span className="text-[13px] font-bold text-success">{emptyTitle}</span>
                    {emptyHint && <span className="text-[11px] text-text-secondary">{emptyHint}</span>}
                </div>
            ) : (
                <div className="flex flex-col">
                    {items.map(it => {
                        const isDone = !!checked[it.ingredient]
                        return (
                            <button
                                key={it.ingredient}
                                type="button"
                                onClick={() => onToggle?.(it.ingredient)}
                                className="flex items-center gap-3 py-2.5 border-b border-border/20 last:border-0 text-left active:scale-[0.99] transition"
                            >
                                <span className={`shrink-0 w-5 h-5 rounded-[7px] border flex items-center justify-center transition-colors ${isDone ? 'bg-primary border-primary' : 'bg-surface-light border-border'}`}>
                                    {isDone && <Check size={13} className="text-black" strokeWidth={3} />}
                                </span>
                                <div className="flex-1 min-w-0">
                                    <span className={`block text-[14px] font-bold leading-tight ${isDone ? 'text-text-dim line-through' : 'text-text'}`}>
                                        {ingredientLabel(it.ingredient)}
                                    </span>
                                    <span className="block text-[10px] text-text-dim mt-0.5">
                                        Còn {it.have} {it.unit}
                                    </span>
                                </div>
                                <div className="flex flex-col items-end shrink-0">
                                    {packVerb && it.needPacks > 0 ? (
                                        <>
                                            <span className={`text-[12px] font-black leading-tight text-right ${isDone ? 'text-text-dim line-through' : 'text-primary'}`}>
                                                {packVerb} {it.needPacks} {it.packUnit || ''}
                                            </span>
                                            <span className="text-[10px] font-bold text-text-dim mt-0.5 tabular-nums">
                                                Cần {it.need} {it.unit}
                                            </span>
                                        </>
                                    ) : (
                                        <>
                                            <span className={`text-[14px] font-black leading-none tabular-nums ${isDone ? 'text-text-dim line-through' : 'text-primary'}`}>
                                                Cần {it.need} {it.unit}
                                            </span>
                                            {it.needPacks > 0 && (
                                                <span className="text-[10px] font-bold text-text-dim mt-0.5">
                                                    {it.needPacks} {it.packUnit || ''} {ingredientLabel(it.ingredient).toLowerCase()}
                                                </span>
                                            )}
                                        </>
                                    )}
                                </div>
                            </button>
                        )
                    })}
                </div>
            )}
        </CollapsibleCard>
    )
}
