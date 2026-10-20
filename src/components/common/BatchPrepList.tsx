import { useProducts } from '../../contexts/ProductContext'
import { ingredientLabel, normalizeIngredientKey } from '../../utils/ingredients'
import { r1 } from '../../utils/inventory'
import type { PrepItem } from '../../utils/prepToday'
import ProduceButton from './ProduceButton'

// Thành phẩm còn phải làm cho hôm nay (cạnh checklist "Lấy" trong Chuẩn bị hôm nay): mỗi dòng 1 nút Sản xuất
// mở sheet với số mẻ mớm sẵn theo lượng còn thiếu. Sản xuất xong dòng tự rớt khỏi danh sách khi đủ.
export default function BatchPrepList({ items }: { items: PrepItem[] }) {
    const { batchProducts } = useProducts()
    if (!items.length) return null

    return (
        <div className="mt-3 pt-3 border-t border-border/40 flex flex-col">
            <span className="text-[11px] font-black uppercase tracking-widest text-text-secondary mb-1">Thành phẩm cần làm</span>
            {items.map(it => {
                const product = batchProducts.find(b => normalizeIngredientKey(b.name) === it.ingredient)
                if (!product) return null
                return (
                    <div key={it.ingredient} className="flex items-center justify-between gap-3 py-2.5 border-b border-border/30 last:border-0">
                        <div className="min-w-0">
                            <span className="block text-[15px] font-bold leading-tight text-text">{ingredientLabel(it.ingredient)}</span>
                            <span className="block text-[12px] text-text-secondary">Còn {r1(it.have ?? 0)} {it.unit} · cần thêm {r1(it.need ?? 0)} {it.unit}</span>
                        </div>
                        <ProduceButton
                            product={product}
                            suggestedQty={it.need ?? 0}
                            className="shrink-0 min-h-[44px] min-w-[124px] px-3 flex items-center justify-center rounded-xl text-[12px] font-black bg-primary text-bg active:scale-95 transition"
                        >
                            Sản xuất
                        </ProduceButton>
                    </div>
                )
            })}
        </div>
    )
}
