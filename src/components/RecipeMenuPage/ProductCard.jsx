import { formatVND } from '../../utils'
import { ingredientLabel, getIngredientUnit } from '../../utils/ingredients'
import { useAuth } from '../../contexts/AuthContext'

const SYMBOL_UNITS = new Set(['g', 'ml', 'l', 'kg', 'oz', 'mg'])

export default function ProductCard({ product, prodRecipes, cost, ingredientUnits, onClick }) {
    const { isStaff } = useAuth()
    const isOrphan = prodRecipes.length === 0

    return (
        <div
            onClick={onClick}
            className={`bg-surface border ${isOrphan ? 'border-danger/30 bg-danger/5' : 'border-border/60'} rounded-[1.5rem] p-4 flex flex-col justify-between gap-2 cursor-pointer transition-all shadow-sm hover:border-text/30 hover:shadow-md active:scale-[0.98]`}
        >
            <div className="flex flex-col gap-1.5">
                <div className="flex items-start justify-between gap-1.5">
                    <h3 className="font-black text-[15px] leading-tight text-text break-words line-clamp-2 flex-1 min-w-0">{product.name}</h3>
                    {product.count_as_cup === false && (
                        <span
                            title="Không tính vào tổng số ly bán/ngày"
                            className="shrink-0 text-[10px] font-bold text-text-secondary bg-surface-light border border-border/60 rounded-md px-1.5 py-0.5 leading-none"
                        >
                            ∅ ly
                        </span>
                    )}
                </div>

                {prodRecipes.length > 0 && (
                    <div className="flex flex-col items-left gap-y-1">
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
                        </div>
                    </div>
                )}

                {!isStaff && (
                    <div className="flex items-center gap-1.5 text-[12px] text-text-secondary mt-0.5">
                        <span>Giá vốn: <span className="text-primary font-bold">{formatVND(cost)}</span></span>
                    </div>
                )}
            </div>
        </div>
    )
}
