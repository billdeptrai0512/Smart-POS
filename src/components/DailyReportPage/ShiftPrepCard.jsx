import { Truck, Check } from 'lucide-react'
import { ingredientLabel } from '../../utils/ingredients'

// "Soạn cho mai" — checklist riêng cho thao tác cuối ca: sau khi đếm tồn, nhân viên
// thấy danh sách món cần bổ sung và tick từng món khi đã bỏ lên xe cho ca sáng.
//
// items: [{ ingredient, finalRefill, packsNeeded, packUnit, unit }]
// Controlled component: tick state (checked) + onToggle do parent (DailyReportPage) giữ,
// vì "đã soạn hết" là một điều kiện để chốt ca. Parent persist localStorage theo address+ngày.
export default function ShiftPrepCard({ items = [], checked = {}, onToggle }) {
    const toggle = (ingredient) => onToggle?.(ingredient)

    const doneCount = items.reduce((n, it) => n + (checked[it.ingredient] ? 1 : 0), 0)

    return (
        <div className="bg-surface rounded-[20px] p-3 border border-border/60 shadow-sm">
            <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-1.5">
                    <Truck size={15} className="text-primary shrink-0" />
                    <span className="text-[12px] font-black uppercase tracking-widest text-text">Soạn cho mai</span>
                </div>
                {items.length > 0 && (
                    <span className="text-[11px] font-bold text-text-secondary tabular-nums">
                        {items.length} món · {doneCount} đã soạn
                    </span>
                )}
            </div>

            {items.length === 0 ? (
                <div className="py-3 text-center flex flex-col items-center gap-1">
                    <span className="text-[13px] font-bold text-success">Kho đủ dùng!</span>
                    <span className="text-[11px] text-text-secondary">Đếm tồn cuối ca để xem món cần soạn cho ngày mai.</span>
                </div>
            ) : (
                <div className="flex flex-col">
                    {items.map(it => {
                        const isDone = !!checked[it.ingredient]
                        return (
                            <button
                                key={it.ingredient}
                                type="button"
                                onClick={() => toggle(it.ingredient)}
                                className="flex items-center gap-3 py-2.5 border-b border-border/20 last:border-0 text-left active:scale-[0.99] transition"
                            >
                                <span className={`shrink-0 w-5 h-5 rounded-[7px] border flex items-center justify-center transition-colors ${isDone ? 'bg-primary border-primary' : 'bg-surface-light border-border'}`}>
                                    {isDone && <Check size={13} className="text-black" strokeWidth={3} />}
                                </span>
                                <span className={`flex-1 text-[14px] font-bold leading-tight ${isDone ? 'text-text-dim line-through' : 'text-text'}`}>
                                    {ingredientLabel(it.ingredient)}
                                </span>
                                <div className="flex flex-col items-end shrink-0">
                                    <span className={`text-[14px] font-black leading-none tabular-nums ${isDone ? 'text-text-dim line-through' : 'text-primary'}`}>
                                        {it.finalRefill} {it.unit}
                                    </span>
                                    {it.packsNeeded > 0 && (
                                        <span className="text-[10px] font-bold text-text-dim mt-0.5">
                                            {it.packsNeeded} {it.packUnit || ''} {ingredientLabel(it.ingredient).toLowerCase()}
                                        </span>
                                    )}
                                </div>
                            </button>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
