import { useState } from 'react'
import { formatVND } from '../../utils'
import { ingredientLabel, getIngredientUnit } from '../../utils/ingredients'
import InlineEditor from './InlineEditor'
import IngredientPicker from './IngredientPicker'

export default function BaseRecipeSection({
    prodRecipes, ingredientCosts, ingredientUnits,
    availableBaseIngredients, dbIngredients,
    canEdit,
    onSaveAmount, onDeleteIngredient, onAddIngredients,
    ingredientStocks,
}) {
    const [adding, setAdding] = useState(false)

    return (
        <div className="space-y-2">
            {prodRecipes.length === 0 && (
                <p className="text-text-secondary text-[13px] text-center py-6">Chưa có nguyên liệu nào.</p>
            )}

            {prodRecipes.map(recipe => (
                <RecipeRow
                    key={recipe.ingredient}
                    recipe={recipe}
                    unitCost={ingredientCosts[recipe.ingredient] || 0}
                    unit={getIngredientUnit(recipe.ingredient, recipe.unit, ingredientUnits)}
                    currentStock={ingredientStocks?.[recipe.ingredient]}
                    canEdit={canEdit}
                    onSaveAmount={(amount) => onSaveAmount(recipe.ingredient, amount)}
                    onDelete={() => onDeleteIngredient(recipe.ingredient)}
                />
            ))}

            {canEdit && (adding ? (
                <IngredientPicker
                    availableIngredients={availableBaseIngredients}
                    existingIngredients={dbIngredients}
                    label="Thêm nguyên liệu"
                    onConfirm={(payload) => {
                        onAddIngredients(payload)
                        setAdding(false)
                    }}
                    onCancel={() => setAdding(false)}
                />
            ) : (
                <button
                    onClick={() => setAdding(true)}
                    className="w-full text-[12px] text-primary/70 hover:text-primary font-medium mt-1 transition-colors bg-surface border border-border/60 rounded-[14px] px-4 py-3 text-center"
                >
                    + Thêm nguyên liệu
                </button>
            ))}
        </div>
    )
}

function RecipeRow({ recipe, unitCost, unit, currentStock, canEdit, onSaveAmount, onDelete }) {
    const lineCost = recipe.amount * unitCost
    return (
        <div className="bg-surface border border-border/60 rounded-[14px] px-4 py-3 flex items-center gap-2 group">
            <div className="flex flex-col flex-1 min-w-0">
                <span className="text-[13px] text-text truncate">
                    {ingredientLabel(recipe.ingredient)}
                </span>
                <span className="text-[11px] font-medium text-text-secondary mt-0.5">
                    Tồn: {currentStock != null ? `${Math.round(currentStock * 10) / 10} ${unit}` : '—'}
                </span>
            </div>

            <InlineEditor
                value={recipe.amount}
                canEdit={canEdit}
                onSave={onSaveAmount}
                type="number"
                step="any"
                suffix={unit}
                displayClassName="text-[13px] font-bold text-primary tabular-nums min-w-[56px] text-right"
                renderDisplay={(v) => (
                    <>{v} <span className="text-[11px] font-normal text-primary/70">{unit}</span></>
                )}
            />

            <span className="text-[11px] text-text-dim tabular-nums w-[64px] text-right shrink-0">
                {formatVND(lineCost)}
            </span>

            {canEdit && (
                <button
                    onClick={onDelete}
                    className="opacity-0 group-hover:opacity-100 text-danger/60 hover:text-danger text-[14px] shrink-0 w-6 h-6 flex items-center justify-center transition-opacity"
                    title="Xóa nguyên liệu khỏi công thức"
                >
                    ✕
                </button>
            )}
        </div>
    )
}
