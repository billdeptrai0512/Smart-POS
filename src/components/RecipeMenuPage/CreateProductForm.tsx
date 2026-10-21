import { useState } from 'react'
import MoneyInput from '../common/MoneyInput'
import Dropdown from '../common/Dropdown'
import { parseVNDInput, capitalizeWords } from '../../utils'

interface Props {
    saving?: boolean
    /** Món đã có công thức để chép định lượng sang món mới (không truyền / rỗng → ẩn ô chép). */
    copyable?: { id: string; name: string }[]
    onSubmit: (name: string, price: string, copyFromId: string) => void
}

// Tự giữ name/price: modal gỡ mount sau khi tạo xong nên state tự reset; lỗi thì form còn nguyên giá trị.
export default function CreateProductForm({ saving, copyable = [], onSubmit }: Props) {
    const [name, setName] = useState('')
    const [price, setPrice] = useState('')
    const [copyFrom, setCopyFrom] = useState('')
    const canSubmit = name.trim() && parseVNDInput(price) >= 0 && !saving
    const submit = () => { if (canSubmit) onSubmit(name.trim(), price, copyFrom) }

    return (
        <div className="flex flex-col gap-3">
            <div className="flex gap-2">
                <input
                    type="text"
                    autoCapitalize="words"
                    placeholder="Tên công thức"
                    value={name}
                    onChange={e => setName(capitalizeWords(e.target.value))}
                    className="flex-1 min-w-0 bg-surface-light border border-border/60 rounded-[12px] px-3 py-2.5 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-primary/40 transition-colors"
                />
                <MoneyInput
                    value={price}
                    onChange={setPrice}
                    onKeyDown={e => { if (e.key === 'Enter') submit() }}
                    placeholder="Giá bán"
                    className="shrink-0 w-[140px]"
                />
            </div>

            {copyable.length > 0 && (
                <Dropdown
                    ariaLabel="Chép định lượng nguyên liệu từ món"
                    value={copyFrom}
                    triggerLabel={copyable.find(p => p.id === copyFrom)?.name ?? 'Chép nguyên liệu từ món có sẵn (tùy chọn)'}
                    align="left"
                    up
                    className="w-full"
                    panelClassName="min-w-[14rem]"
                    triggerClassName="w-full h-11 px-3 rounded-[12px] bg-surface-light border border-border/60 text-text text-[14px]"
                    items={[{ value: '', label: 'Không chép (để trống)' }, ...copyable.map(p => ({ value: p.id, label: p.name }))]}
                    onChange={setCopyFrom}
                />
            )}

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
