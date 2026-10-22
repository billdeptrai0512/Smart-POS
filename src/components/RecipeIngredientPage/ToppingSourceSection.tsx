import Dropdown from '../common/Dropdown'
import { ingredientLabel } from '../../utils/ingredients'
import type { ToppingSource } from '../../services/toppingService'

interface Props {
    source: ToppingSource | null
    options: string[]
    unitOf: (key: string) => string
    canEdit: boolean
    /** Danh sách mở lên trên — dùng trong bottom sheet để khỏi bị cắt ở đáy màn hình. */
    up?: boolean
    onSave: (source: ToppingSource | null) => void
}

// Nguồn tồn kho của topping: bán 1 phần trừ `amount` của 1 nguyên liệu / thành phẩm. Topping cũ chưa chọn nguồn vẫn dùng công thức riêng bên dưới.
export default function ToppingSourceSection({ source, options, unitOf, canEdit, up, onSave }: Props) {
    // Ô số không kiểm soát: key theo giá trị đã lưu nên đổi nguồn / lưu xong thì ô tự nạp lại; số sai (≤ 0, chữ) thì trả về giá trị cũ.
    const commitAmount = (input: HTMLInputElement) => {
        const n = Number(input.value.replace(',', '.'))
        if (source && n > 0 && n !== source.amount) onSave({ ingredient: source.ingredient, amount: n })
        else if (source) input.value = String(source.amount)
    }

    return (
        <section className="rounded-[14px] bg-surface border border-border/60 p-3 space-y-2">
            <div className="text-[11px] font-black uppercase tracking-widest text-text-secondary">Mỗi phần bán trừ gì trong kho?</div>
            <div className="flex items-stretch gap-2">
                <Dropdown
                    ariaLabel="Chọn nguồn tồn kho"
                    value={source?.ingredient ?? ''}
                    triggerLabel={source ? ingredientLabel(source.ingredient) : 'Chưa chọn nguồn'}
                    disabled={!canEdit}
                    align="left"
                    up={up}
                    className="flex-1 min-w-0"
                    panelClassName="max-h-64 overflow-y-auto min-w-[14rem]"
                    triggerClassName="w-full h-11 px-3 rounded-[12px] bg-bg border border-border/60 text-text text-[14px]"
                    items={[
                        { value: '', label: 'Không dùng nguồn' },
                        ...options.map(k => ({ value: k, label: ingredientLabel(k) })),
                    ]}
                    onChange={k => { if (k !== (source?.ingredient ?? '')) onSave(k ? { ingredient: k, amount: source?.amount ?? 1 } : null) }}
                />
                {source && (
                    <div className="flex items-center gap-1 shrink-0">
                        <input
                            type="text"
                            inputMode="decimal"
                            key={`${source.ingredient}:${source.amount}`}
                            defaultValue={source.amount}
                            disabled={!canEdit}
                            onBlur={e => commitAmount(e.currentTarget)}
                            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                            aria-label="Định lượng mỗi phần"
                            className="w-20 h-11 px-2 text-right rounded-[12px] bg-bg border border-border/60 text-text text-[14px] focus:outline-none focus:border-primary/60"
                        />
                        <span className="text-[13px] text-text-secondary">{unitOf(source.ingredient)}/phần</span>
                    </div>
                )}
            </div>
            <p className="text-[12px] text-text-dim">
                {source ? 'Mỗi phần bán trừ đúng lượng này từ nguồn.' : 'Chọn nguyên liệu mà topping này lấy từ kho. Topping tự nấu thì thêm từ 2 nguyên liệu ở trang topping sau khi tạo.'}
            </p>
        </section>
    )
}
