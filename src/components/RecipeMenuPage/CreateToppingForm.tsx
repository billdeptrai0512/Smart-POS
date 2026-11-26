import { useState } from 'react'
import MoneyInput from '../common/MoneyInput'
import FormField, { FIELD_INPUT as FIELD } from './FormField'
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
                <FormField label="Tên topping" className="flex-1 min-w-0">
                    <input
                        type="text"
                        autoFocus
                        autoCapitalize="words"
                        placeholder="VD: Trân châu"
                        value={name}
                        onChange={e => setName(capitalizeWords(e.target.value))}
                        className={`w-full ${FIELD}`}
                    />
                </FormField>
                <FormField label="Giá cộng thêm" className="shrink-0 w-[140px]">
                    <MoneyInput value={price} onChange={setPrice} onKeyDown={e => { if (e.key === 'Enter') submit() }} placeholder="0" />
                </FormField>
            </div>
            {!source && (
                <FormField label="Đơn vị tồn kho">
                    <input
                        type="text"
                        placeholder="VD: ml, phần..."
                        value={unit}
                        onChange={e => setUnit(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') submit() }}
                        className={`w-full ${FIELD}`}
                    />
                </FormField>
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
