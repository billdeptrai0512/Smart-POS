export default function ProductCreator({ addingProduct, setAddingProduct, newProductName, setNewProductName, newProductPrice, setNewProductPrice, handleCreateProduct }) {
    if (addingProduct) {
        return (
            <div className="flex w-full items-center gap-2 px-4 py-2 bg-surface border border-border/60 rounded-[16px] shadow-sm">
                <input
                    className="flex-1 min-w-0 bg-bg border border-border/60 rounded-lg px-2 py-1.5 text-[13px] text-text focus:outline-none focus:border-primary"
                    placeholder="Tên món"
                    value={newProductName}
                    onChange={e => setNewProductName(e.target.value)}
                    autoFocus
                />
                <input
                    className="w-[85px] bg-bg border border-border/60 rounded-lg px-2 py-1.5 text-[13px] text-text focus:outline-none focus:border-primary"
                    placeholder="Giá bán"
                    type="number"
                    value={newProductPrice}
                    onChange={e => setNewProductPrice(e.target.value)}
                />
                <div className="flex gap-1 shrink-0">
                    <button
                        onClick={() => setAddingProduct(false)}
                        className="text-[12px] font-bold text-text-secondary px-3 py-1.5 rounded-lg hover:bg-surface-light transition-colors"
                    >
                        Hủy
                    </button>
                    <button
                        onClick={handleCreateProduct}
                        className="text-[12px] font-bold text-bg bg-primary px-4 py-1.5 rounded-lg hover:bg-primary/90 active:scale-[0.98] transition-all disabled:opacity-50"
                    >
                        Lưu
                    </button>
                </div>
            </div>
        )
    }

    return (
        <button
            onClick={() => setAddingProduct(true)}
            className="w-full h-full bg-surface border border-border/60 rounded-[1.5rem] p-4 flex flex-col items-center justify-center min-h-[80px] text-[14px] font-bold text-primary hover:bg-surface-light active:scale-[0.98] transition-all shadow-sm"
        >
            + Thêm món
        </button>
    )
}
