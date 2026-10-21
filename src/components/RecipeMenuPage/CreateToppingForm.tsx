import { useState } from 'react'
import MoneyInput from '../common/MoneyInput'
import ToppingSourceSection from '../RecipeIngredientPage/ToppingSourceSection'
import { parseVNDInput, capitalizeWords } from '../../utils'
import { normalizeIngredientKey } from '../../utils/ingredients'
import type { ToppingSource } from '../../services/toppingService'

interface Props {
    saving?: boolean
    /** Nguyên liệu / thành phẩm có thể làm nguồn tồn kho (không truyền / rỗng → ẩn ô nguồn, vd. khách dùng thử). */
    sourceOptions?: string[]
    unitOf: (key: string) => string
    onSubmit: (name: string, price: number, unit: string, source: ToppingSource | null) => void
}

const FIELD = 'bg-surface-light border border-border/60 rounded-[12px] px-3 py-2.5 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-primary/40 transition-colors'

// Topping: tên, giá cộng thêm, đơn vị tồn kho (đếm tay ở Kiểm kê). Công thức + món dùng topping chỉnh ở trang chi tiết.
export default function CreateToppingForm({ saving, sourceOptions = [], unitOf, onSubmit }: Props) {
    const [name, setName] = useState('')
    const [price, setPrice] = useState('')
    const [unit, setUnit] = useState('')
    const [picked, setSource] = useState<ToppingSource | null>(null)
    // Topping không tự làm nguồn của chính nó (cùng khoá tồn kho với tên topping).
    const ownKey = normalizeIngredientKey(name)
    const options = sourceOptions.filter(k => k !== ownKey)
    const source = picked && options.includes(picked.ingredient) ? picked : null
    const canSubmit = name.trim() && parseVNDInput(price) >= 0 && !saving
    const submit = () => { if (canSubmit) onSubmit(name.trim(), parseVNDInput(price), unit.trim() || 'đv', source) }

    return (
        <div className="flex flex-col gap-3">
            <div className="flex gap-2">
                <input
                    type="text"
                    autoCapitalize="words"
                    placeholder="Tên topping"
                    value={name}
                    onChange={e => setName(capitalizeWords(e.target.value))}
                    className={`flex-1 min-w-0 ${FIELD}`}
                />
                <MoneyInput value={price} onChange={setPrice} onKeyDown={e => { if (e.key === 'Enter') submit() }} placeholder="Giá cộng thêm" className="shrink-0 w-[140px]" />
            </div>
            {!source && (
                <input
                    type="text"
                    placeholder="Đơn vị tồn kho (VD: ml, phần...)"
                    value={unit}
                    onChange={e => setUnit(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') submit() }}
                    className={FIELD}
                />
            )}
            {options.length > 0 && <ToppingSourceSection source={source} options={options} unitOf={unitOf} canEdit up onSave={setSource} />}
            <button
                onClick={submit}
                disabled={!canSubmit}
                className="w-full py-3 rounded-[12px] bg-primary text-bg text-[14px] font-black hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed uppercase"
            >
                {saving ? 'Đang...' : 'Tạo'}
            </button>
        </div>
    )
}
