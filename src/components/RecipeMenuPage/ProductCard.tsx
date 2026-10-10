import type { ReactNode } from 'react'
import { formatVND } from '../../utils'
import type { Row } from '../../types/domain'
import type { RecipeRow } from '../../utils/inventory'
import { ingredientLabel, getIngredientUnit } from '../../utils/ingredients'
import { onboardingHintClass } from '../../utils/onboardingHint'
import { useAuth } from '../../contexts/AuthContext'

interface Props {
    product: Row
    prodRecipes: RecipeRow[]
    cost: number
    ingredientUnits: Record<string, string>
    onClick?: () => void
    dragHandle?: ReactNode
    sortMode?: boolean
    hint?: boolean
}

const SYMBOL_UNITS = new Set(['g', 'ml', 'l', 'kg', 'oz', 'mg'])

export default function ProductCard({ product, prodRecipes, cost, ingredientUnits, onClick, dragHandle, sortMode = false, hint = false }: Props) {
    const { isStaff } = useAuth()
    const isOrphan = prodRecipes.length === 0
    const notCup = product.count_as_cup === false

    return (
        <div
            onClick={onClick}
            className={`bg-surface border ${isOrphan && !sortMode ? 'border-danger/30 bg-danger/5' : 'border-border/60'} rounded-[1.5rem] transition-all shadow-sm ${sortMode ? 'px-4 py-3 min-h-16 flex items-center justify-between gap-2' : 'p-4 flex flex-col justify-between gap-2 cursor-pointer hover:border-text/30 hover:shadow-md active:scale-[0.98]'} ${onboardingHintClass(hint)}`}
        >
            <div className="flex flex-col gap-1.5 min-w-0">
                <h3 className="font-black text-[15px] leading-tight text-text break-words line-clamp-2">
                    {sortMode && isOrphan && <span title="Chưa có công thức" className="inline-block w-1.5 h-1.5 mr-1.5 align-middle rounded-full bg-danger" />}
                    {product.name}
                </h3>

                {!sortMode && (prodRecipes.length > 0 || notCup) && (
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
                            {notCup && (
                                <span title="Không tính vào tổng số ly bán/ngày" className="text-[12px] font-medium text-text-secondary">
                                    • Không tính ly
                                </span>
                            )}
                        </div>
                    </div>
                )}

                {!sortMode && (
                    <div className="flex flex-col gap-0.5 text-[12px] text-text-secondary mt-1 pt-2 border-t border-border/40">
                        {!isStaff && <span>Giá vốn: <span className="text-primary font-bold">{formatVND(cost)}</span></span>}
                        <span>Giá bán: <span className="text-success font-bold">{formatVND(product.price)}</span></span>
                    </div>
                )}
            </div>

            {dragHandle}
        </div>
    )
}
