export default function CreateProductForm({
    name, price, saving,
    onNameChange, onPriceChange, onSubmit,
}) {
    const canSubmit = name.trim() && price && !isNaN(price) && Number(price) > 0 && !saving

    return (
        <div className="flex flex-col gap-3">
            <div className="flex gap-2">
                <input
                    type="text"
                    placeholder="Tên món mới..."
                    value={name}
                    onChange={e => onNameChange(e.target.value)}
                    className="flex-1 min-w-0 bg-surface-light border border-border/60 rounded-[12px] px-3 py-2.5 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-primary/40 transition-colors"
                />
                <div className="relative shrink-0 flex items-center w-[125px] bg-surface-light border border-border/60 rounded-[12px] focus-within:border-primary/40 transition-colors overflow-hidden">
                    <input
                        type="number"
                        placeholder="Giá bán..."
                        value={price}
                        onChange={e => onPriceChange(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') onSubmit() }}
                        className="w-full bg-transparent px-3 py-2.5 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none z-10 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    {price && (
                        <div className="absolute inset-0 pointer-events-none px-3 py-2.5 flex items-center space-x-0 whitespace-pre z-0">
                            <span className="text-[14px] font-medium text-transparent">{price}</span>
                            <span className="text-[14px] font-medium text-text-secondary/60">.000đ</span>
                        </div>
                    )}
                </div>
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
