import MoneyInput from '../common/MoneyInput'
import { parseVNDInput, capitalizeWords } from '../../utils'

export default function CreateProductForm({
    name, price, saving,
    onNameChange, onPriceChange, onSubmit,
}) {
    const canSubmit = name.trim() && parseVNDInput(price) > 0 && !saving

    return (
        <div className="flex flex-col gap-3">
            <div className="flex gap-2">
                <input
                    type="text"
                    autoCapitalize="words"
                    placeholder="Tên món mới..."
                    value={name}
                    onChange={e => onNameChange(capitalizeWords(e.target.value))}
                    className="flex-1 min-w-0 bg-surface-light border border-border/60 rounded-[12px] px-3 py-2.5 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-primary/40 transition-colors"
                />
                <MoneyInput
                    value={price}
                    onChange={onPriceChange}
                    onKeyDown={e => { if (e.key === 'Enter') onSubmit() }}
                    placeholder="Giá bán"
                    className="shrink-0 w-[140px]"
                />
            </div>

            <button
                onClick={onSubmit}
                disabled={!canSubmit}
                className="w-full py-3 rounded-[12px] bg-primary text-bg text-[14px] font-black hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed uppercase"
            >
                {saving ? 'Đang...' : 'Tạo'}
            </button>
        </div>
    )
}
