import { Check, Plus } from 'lucide-react'
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
    // Khi set → mỗi dòng đổi ô tick thành nút "+" mở phiếu Nhập kho (card "Chuẩn bị tồn
    // kho"). Bấm dòng gọi onRestock(ingredient). Không set → giữ hành vi tick như cũ.
    onRestock,
    title = 'Soạn cho hôm nay',
    icon = null,
    // Nhãn cho số tồn ở dòng phụ: card Soạn = tồn quầy đầu ca ("Quầy"),
    // card Chuẩn bị kho = tổng tồn cho mai ("Tồn kho").
    haveLabel = 'Còn',
    emptyTitle = 'Kho đủ dùng!',
    emptyHint = '',
    // Khi set (vd "Mua"): dòng lớn = "<packVerb> N bịch", dòng nhỏ = "Cần X".
    // Hợp với card đi chợ (mua theo bịch/hộp). Bỏ trống → dòng lớn là "Cần X" (soạn loose).
    packVerb = null,
    open = true,
    onToggleOpen,
}) {
    const restockMode = typeof onRestock === 'function'
    const doneCount = items.reduce((n, it) => n + (checked[it.ingredient] ? 1 : 0), 0)

    return (
        <CollapsibleCard
            icon={icon}
            title={title}
            count={items.length > 0 ? (restockMode ? String(items.length) : `${doneCount}/${items.length}`) : null}
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
                        // Kho tổng không đủ cho lượng sẽ rút ra (số quy đổi nguyên bịch) →
                        // tô đỏ để báo trước: tick vào sẽ "Vượt kho tổng" và chặn Lưu.
                        const shortfall = it.warehouse != null && it.warehouse < (it.fillQty ?? it.need)
                        return (
                            <button
                                key={it.ingredient}
                                type="button"
                                onClick={() => restockMode ? onRestock(it.ingredient) : onToggle?.(it.ingredient)}
                                className="flex items-center gap-3 py-2.5 border-b border-border/20 last:border-0 text-left active:scale-[0.99] transition"
                            >
                                {restockMode ? (
                                    <span className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-primary bg-primary/10" title="Nhập kho">
                                        <Plus size={16} strokeWidth={3} />
                                    </span>
                                ) : (
                                    <span className={`shrink-0 w-5 h-5 rounded-[7px] border flex items-center justify-center transition-colors ${isDone ? 'bg-primary border-primary' : 'bg-surface-light border-border'}`}>
                                        {isDone && <Check size={13} className="text-black" strokeWidth={3} />}
                                    </span>
                                )}
                                <div className="flex-1 min-w-0">
                                    <span className={`block text-[14px] font-bold leading-tight ${isDone ? 'text-text-dim line-through' : 'text-text'}`}>
                                        {ingredientLabel(it.ingredient)}
                                    </span>
                                    <span className="block text-[10px] text-text-dim mt-0.5">
                                        {it.warehouse != null && (
                                            <span className={shortfall ? 'text-danger font-bold' : ''}>
                                                Kho {it.warehouse} {it.unit}{' · '}
                                            </span>
                                        )}
                                        {haveLabel} {it.have} {it.unit}
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
