import { useState } from 'react'
import { Settings2 } from 'lucide-react'
import MoneyInput from '../common/MoneyInput'
import Dropdown from '../common/Dropdown'
import FormField, { FIELD_INPUT } from './FormField'
import { parseVNDInput, capitalizeWords } from '../../utils'

interface Props {
    saving?: boolean
    /** Danh mục menu (divider) để xếp món vào — rỗng → ẩn ô chọn. */
    categories?: { id: string; label: string }[]
    /** Id danh mục chọn sẵn ('' = chưa phân). */
    defaultCategory?: string
    onManageCategories: () => void
    onSubmit: (name: string, price: string, categoryId: string) => void
}

const FIELD_TRIGGER = 'w-full h-11 px-3 rounded-[12px] bg-surface-light border border-border/60 text-text text-[14px]'

// Tự giữ name/price: modal gỡ mount sau khi tạo xong nên state tự reset; lỗi thì form còn nguyên giá trị.
export default function CreateProductForm({ saving, categories = [], defaultCategory = '', onManageCategories, onSubmit }: Props) {
    const [name, setName] = useState('')
    const [price, setPrice] = useState('')
    const [category, setCategory] = useState(defaultCategory)
    const canSubmit = name.trim() && parseVNDInput(price) >= 0 && !saving
    const submit = () => { if (canSubmit) onSubmit(name.trim(), price, category) }

    return (
        <div className="flex flex-col gap-3">
            <div className="flex gap-2">
                <FormField label="Tên món" className="flex-1 min-w-0">
                    <input
                        type="text"
                        autoFocus
                        autoCapitalize="words"
                        placeholder="VD: Cà phê sữa"
                        value={name}
                        onChange={e => setName(capitalizeWords(e.target.value))}
                        className={`w-full ${FIELD_INPUT}`}
                    />
                </FormField>
                <FormField label="Giá bán" className="shrink-0 w-[140px]">
                    <MoneyInput
                        value={price}
                        onChange={setPrice}
                        onKeyDown={e => { if (e.key === 'Enter') submit() }}
                        placeholder="0"
                    />
                </FormField>
            </div>

            <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                    <span className="text-[11px] font-black uppercase tracking-widest text-text-secondary">Danh mục</span>
                    <button type="button" onClick={onManageCategories} className="flex items-center gap-1 text-[12px] font-bold text-primary active:opacity-70">
                        <Settings2 size={14} /> Quản lý
                    </button>
                </div>
                <Dropdown
                    ariaLabel="Danh mục của món"
                    value={category}
                    triggerLabel={categories.find(c => c.id === category)?.label ?? 'Không thuộc danh mục'}
                    align="left"
                    up
                    className="w-full"
                    triggerClassName={FIELD_TRIGGER}
                    items={[{ value: '', label: 'Không thuộc danh mục' }, ...categories.map(c => ({ value: c.id, label: c.label }))]}
                    onChange={setCategory}
                />
            </div>

            <hr className="-mx-5 border-border/60" />
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
