import { useState } from 'react'
import { BottomSheet, SheetHeader, SHEET_PANEL } from '../common/ModalShell'
import MoneyInput from '../common/MoneyInput'
import Dropdown from '../common/Dropdown'
import FormField, { FIELD_INPUT } from './FormField'
import { parseVNDInput, formatVNDInput, capitalizeWords } from '../../utils'
import type { Row } from '../../types/domain'

interface Props {
    product: Row
    saving?: boolean
    categories: { id: string; label: string }[]
    /** Id danh mục hiện tại của món ('' = chưa phân danh mục). */
    category: string
    onSave: (changes: { name: string; price: number; category: string }) => void
    onDelete: () => void
    onClose: () => void
}

// Sửa nhanh 1 món ngay ở tab Menu: tên, giá, danh mục (công thức mở từ thanh chọn món của trang). Chi tiết công thức vẫn ở trang riêng (onOpenRecipe).
export default function EditProductSheet({ product, saving, categories, category: initialCategory, onSave, onDelete, onClose }: Props) {
    const [name, setName] = useState(product.name)
    const [price, setPrice] = useState(formatVNDInput(String(product.price ?? 0)))
    const [category, setCategory] = useState(initialCategory)
    const canSubmit = name.trim() && parseVNDInput(price) >= 0 && !saving
    const submit = () => { if (canSubmit) onSave({ name: name.trim(), price: parseVNDInput(price), category }) }

    return (
        <BottomSheet onClose={() => !saving && onClose()} panelClassName={SHEET_PANEL}>
            <SheetHeader title="Sửa món" onClose={onClose} closeDisabled={saving} />
            <hr className="-mx-5 border-border/60" />
            <div className="flex flex-col gap-3">
                <div className="flex gap-2">
                    <FormField label="Tên món" className="flex-1 min-w-0">
                        <input
                            type="text"
                            autoCapitalize="words"
                            value={name}
                            onChange={e => setName(capitalizeWords(e.target.value))}
                            onKeyDown={e => { if (e.key === 'Enter') submit() }}
                            className={`w-full ${FIELD_INPUT}`}
                        />
                    </FormField>
                    <FormField label="Giá bán" className="shrink-0 w-[140px]">
                        <MoneyInput value={price} onChange={setPrice} onKeyDown={e => { if (e.key === 'Enter') submit() }} />
                    </FormField>
                </div>

                {categories.length > 0 && (
                    <FormField label="Danh mục">
                        <Dropdown
                            ariaLabel="Danh mục của món"
                            value={category}
                            triggerLabel={categories.find(c => c.id === category)?.label ?? 'Chưa phân danh mục'}
                            align="left"
                            up
                            className="w-full"
                            triggerClassName="w-full h-11 px-3 rounded-[12px] bg-surface-light border border-border/60 text-text text-[14px]"
                            items={[{ value: '', label: 'Chưa phân danh mục' }, ...categories.map(c => ({ value: c.id, label: c.label }))]}
                            onChange={setCategory}
                        />
                    </FormField>
                )}

                <hr className="-mx-5 mt-1 border-border/60" />

                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={onDelete}
                        disabled={saving}
                        className="flex-1 py-3 rounded-[12px] bg-danger-soft text-danger font-black text-[14px] hover:bg-danger/20 active:scale-95 transition-all disabled:opacity-50"
                    >
                        Xóa món
                    </button>
                    <button
                        onClick={submit}
                        disabled={!canSubmit}
                        className="flex-1 py-3 rounded-[12px] bg-primary text-bg font-black text-[14px] hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50"
                    >
                        {saving ? 'Đang...' : 'Lưu'}
                    </button>
                </div>
            </div>
        </BottomSheet>
    )
}
