import { useState } from 'react'
import MoneyInput from '../common/MoneyInput'
import { parseVNDInput, capitalizeWords } from '../../utils'

interface Props {
    saving?: boolean
    onSubmit: (name: string, price: string) => void
}

// Tự giữ name/price: modal gỡ mount sau khi tạo xong nên state tự reset; lỗi thì form còn nguyên giá trị.
export default function CreateProductForm({ saving, onSubmit }: Props) {
    const [name, setName] = useState('')
    const [price, setPrice] = useState('')
    const canSubmit = name.trim() && parseVNDInput(price) >= 0 && !saving
    const submit = () => { if (canSubmit) onSubmit(name.trim(), price) }

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
