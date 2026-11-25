import type { ReactNode } from 'react'
import { formatVND } from '../../utils'
import type { Row } from '../../types/domain'
import type { RecipeRow } from '../../utils/inventory'
import { ingredientLabel, getIngredientUnit, normalizeIngredientKey } from '../../utils/ingredients'
import { useAuth } from '../../contexts/AuthContext'

interface Props {
    product: Row
    prodRecipes: RecipeRow[]
    cost: number
    ingredientUnits: Record<string, string>
    onClick?: () => void
    dragHandle?: ReactNode
    /** Tab Menu: thẻ gọn giống thẻ món ở POS (tên + giá), sắp xếp bằng kéo thả. */
    sortMode?: boolean
    /** Nhãn giá bán (mặc định "Giá bán"; topping dùng "Giá cộng thêm"). */
    priceLabel?: string
}

const SYMBOL_UNITS = new Set(['g', 'ml', 'l', 'kg', 'oz', 'mg'])

export default function ProductCard({ product, prodRecipes, cost, ingredientUnits, onClick, dragHandle, sortMode = false, priceLabel = 'Giá bán' }: Props) {
    const { isStaff } = useAuth()
    const isOrphan = prodRecipes.length === 0
    const notCup = product.count_as_cup === false

    // Cùng khuôn với ProductCard của POS (MenuGrid): rounded-[1.25rem], min-h 76px, tên trên – giá dưới.
    if (sortMode) {
        return (
            <div
                onClick={onClick}
                className={`relative rounded-[1.25rem] px-3 py-2.5 text-left min-h-[76px] flex flex-col justify-between transition-all duration-300 ${onClick ? 'cursor-pointer' : ''} bg-surface border border-border/60 shadow-sm hover:border-text/30 hover:shadow-md hover:bg-surface-hover`}
            >
                <h3 className="relative z-10 w-full font-black text-[15px] sm:text-[16px] leading-tight break-words text-text">
                    {product.name}
                </h3>
                <div className="relative z-10 flex items-end justify-between mt-1.5 w-full gap-2">
                    <span className="font-extrabold text-[13px] text-text-secondary">{formatVND(product.price)}</span>
                    {dragHandle}
                </div>
                {isOrphan && <span className="relative z-10 mt-1 text-[11px] font-bold text-danger">Chưa có công thức</span>}
            </div>
        )
    }

    return (
        <div
            onClick={onClick}
            className={`bg-surface border ${isOrphan ? 'border-danger/30 bg-danger/5' : 'border-border/60'} rounded-[1.5rem] transition-all shadow-sm p-4 flex flex-col justify-between gap-2 cursor-pointer hover:border-text/30 hover:shadow-md active:scale-[0.98]`}
        >
            <div className="flex flex-col gap-1.5 min-w-0">
                <h3 className="font-black text-[15px] leading-tight text-text break-words line-clamp-2">{product.name}</h3>

                {(prodRecipes.length > 0 || notCup) && (
                    <div className="flex flex-col gap-0.5">
                        {prodRecipes.map(r => {
                            const u = getIngredientUnit(r.ingredient, r.unit, ingredientUnits)
                            const isSymbol = SYMBOL_UNITS.has(String(u).toLowerCase())
                            return (
                                <span key={r.ingredient} className="text-[12px] font-medium text-text-secondary">
                                    • {ingredientLabel(r.ingredient)} {r.amount}{isSymbol ? u : ` ${u}`}
                                </span>
                            )
                        })}
                        {notCup && (
                            <span title="Không cộng vào số ly bán" className="text-[12px] font-medium text-text-secondary">
                                • Không tính ly
                            </span>
                        )}
                    </div>
                )}

                <div className="flex flex-col gap-0.5 text-[12px] text-text-secondary mt-1 pt-2 border-t border-border/40">
                    {!isStaff && <span>Giá vốn: <span className="text-primary font-bold">{formatVND(cost)}</span></span>}
                    {product.is_batch
                        ? <span>Mẻ: <span className="text-success font-bold">{product.batch_yield} {ingredientUnits?.[normalizeIngredientKey(product.name)] || ''}</span></span>
                        : <span>{priceLabel}: <span className="text-success font-bold">{formatVND(product.price)}</span></span>}
                </div>
            </div>
        </div>
    )
}
