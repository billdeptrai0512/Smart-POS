import { useState, useEffect } from 'react'
import Dropdown from '../common/Dropdown'
import { ingredientLabel } from '../../utils/ingredients'
import type { ToppingSource } from '../../services/toppingService'

interface Props {
    source: ToppingSource | null
    options: string[]
    unitOf: (key: string) => string
    canEdit: boolean
    onSave: (source: ToppingSource | null) => void
}

// Nguồn tồn kho của topping: bán 1 phần trừ `amount` của 1 nguyên liệu / thành phẩm. Chưa chọn → topping dùng công thức bên dưới.
export default function ToppingSourceSection({ source, options, unitOf, canEdit, onSave }: Props) {
    const [amount, setAmount] = useState(source ? String(source.amount) : '')
    useEffect(() => { setAmount(source ? String(source.amount) : '') }, [source])

    const commitAmount = () => {
        const n = Number(amount.replace(',', '.'))
        if (source && n > 0 && n !== source.amount) onSave({ ingredient: source.ingredient, amount: n })
        else setAmount(source ? String(source.amount) : '')
    }

    return (
        <section className="rounded-[14px] bg-surface border border-border/60 p-3 space-y-2">
            <div className="text-[11px] font-black uppercase tracking-widest text-text-secondary">Nguồn tồn kho</div>
            <div className="flex items-stretch gap-2">
                <Dropdown
                    ariaLabel="Chọn nguồn tồn kho"
                    value={source?.ingredient ?? ''}
                    triggerLabel={source ? ingredientLabel(source.ingredient) : 'Chưa chọn nguồn'}
                    disabled={!canEdit}
                    align="left"
                    className="flex-1 min-w-0"
                    panelClassName="max-h-64 overflow-y-auto min-w-[14rem]"
                    triggerClassName="w-full h-11 px-3 rounded-[12px] bg-bg border border-border/60 text-text text-[14px]"
                    items={[
                        { value: '', label: 'Không dùng nguồn (theo công thức)' },
                        ...options.map(k => ({ value: k, label: ingredientLabel(k) })),
                    ]}
                    onChange={k => onSave(k ? { ingredient: k, amount: source?.amount ?? 1 } : null)}
                />
                {source && (
                    <div className="flex items-center gap-1 shrink-0">
                        <input
                            type="text"
                            inputMode="decimal"
                            value={amount}
                            disabled={!canEdit}
                            onChange={e => setAmount(e.target.value)}
                            onBlur={commitAmount}
                            aria-label="Định lượng mỗi phần"
                            className="w-20 h-11 px-2 text-right rounded-[12px] bg-bg border border-border/60 text-text text-[14px] focus:outline-none focus:border-primary/60"
                        />
                        <span className="text-[13px] text-text-secondary">{unitOf(source.ingredient)}/phần</span>
                    </div>
                )}
            </div>
            <p className="text-[12px] text-text-dim">
                {source ? 'Mỗi phần bán trừ đúng lượng này từ nguồn; công thức bên dưới chỉ dùng khi bỏ nguồn.' : 'Chọn nguyên liệu hoặc thành phẩm mà topping này lấy từ kho.'}
            </p>
        </section>
    )
}
