import Dropdown from '../common/Dropdown'
import { fmtQty, parseQtyInput, toQty } from '../../utils/warehouseTransfer'
import { ingredientLabel } from '../../utils/ingredients'
import type { Row } from '../../types/domain'

interface GroupBranchRow {
    ingredient: string
    unit: string
    cfg?: Row // cấu hình đơn vị chung của kho (quy cách nhập) — mọi chi nhánh đọc cùng một cách
    value: string
    left: number // kho tổng còn lại của nguyên liệu này sau khi trừ mọi số đã chia (âm = chia vượt kho)
    suggest?: { qty: number; packs: number; packUnit?: string | null; sampleDays?: number } // dự báo cho ngày mai (đã trừ tồn quầy, làm tròn bịch)
}

// Thẻ của MỘT chi nhánh ở trang Chia hàng: mỗi nguyên liệu một dòng — tên + dòng "Gợi ý" (chạm để dùng) bên trái, ô số bên phải
// kèm "kho còn" ngay dưới ô (chỉ khi dòng có số) để vừa gõ vừa thấy kho. Kiểu danh sách theo địa chỉ như "Soạn cho hôm nay".
// Chi nhánh chưa có dòng nào thì thu thành 1 dòng đơn thay vì cả thẻ.
export default function GroupBranchCard({ label, rows, options, onChange, onAdd }: {
    label: string
    rows: GroupBranchRow[]
    options: { value: string; label: string }[] // mọi nguyên liệu chọn được; thẻ tự bỏ những món đã có dòng
    onChange: (ingredient: string, value: string) => void
    onAdd: (ingredient: string) => void
}) {
    const addOptions = options.filter(o => !rows.some(r => r.ingredient === o.value))
    const add = (triggerClassName: string, triggerLabel: string) => addOptions.length > 0 && (
        <Dropdown value="" align="left" triggerClassName={triggerClassName} triggerLabel={triggerLabel} items={addOptions} onChange={onAdd} />
    )
    if (rows.length === 0) return (
        <div className="flex items-center gap-2 px-3 py-2 bg-surface border border-border/60 rounded-[14px]">
            <h3 className="flex-1 min-w-0 truncate text-[13px] font-bold text-text">{label}</h3>
            <span className="shrink-0 text-[12px] text-text-dim">chưa có gợi ý</span>
            <div className="shrink-0 w-20">{add('text-[12px] text-primary', '+ Thêm')}</div>
        </div>
    )
    return (
        <div className="bg-surface border border-border/60 rounded-[14px] p-3">
            <h3 className="text-[13px] font-bold text-text">{label}</h3>
            {rows.map(r => {
                const s = r.suggest
                return (
                    <div key={r.ingredient} className="flex items-center gap-2 py-1.5 border-b border-border/20 last:border-0">
                        <div className="flex-1 min-w-0">
                            <span className="block truncate text-[13px] font-medium text-text">{ingredientLabel(r.ingredient)}</span>
                            {s && toQty(r.value) !== s.qty && (
                                <button type="button" onClick={() => onChange(r.ingredient, String(s.qty))} className="block text-left text-[11px] font-semibold text-primary">
                                    Gợi ý {fmtQty(s.qty, r.unit, r.cfg)}
                                    {s.sampleDays !== undefined && s.sampleDays < 3 && <span className="font-normal text-text-dim"> · ước lượng từ {s.sampleDays} ngày bán</span>}
                                </button>
                            )}
                        </div>
                        <div className="shrink-0 flex flex-col items-end">
                            <div className="flex items-center gap-1.5">
                                <input
                                    type="text" inputMode="decimal" placeholder="0" value={r.value}
                                    onChange={e => onChange(r.ingredient, e.target.value)}
                                    onBlur={e => { const p = parseQtyInput(e.target.value, r.unit); if (p !== r.value) onChange(r.ingredient, p) }}
                                    className="w-24 bg-surface-light border border-border/60 rounded-[8px] px-2.5 py-1.5 text-[16px] font-semibold text-right tabular-nums text-text focus:outline-none focus:border-primary/50"
                                />
                                <span className="w-5 text-[12px] text-text-secondary">{r.unit}</span>
                            </div>
                            {toQty(r.value) > 0 && (
                                <span className={`mr-[26px] text-[11px] tabular-nums ${r.left < 0 ? 'text-danger font-semibold' : 'text-text-dim'}`}>
                                    {r.left < 0 ? `Thiếu ${fmtQty(-r.left, r.unit, r.cfg)}` : `Kho còn ${fmtQty(r.left, r.unit, r.cfg)}`}
                                </span>
                            )}
                        </div>
                    </div>
                )
            })}
            {add('text-[12px] pt-1.5 text-primary', '+ Thêm nguyên liệu')}
        </div>
    )
}
