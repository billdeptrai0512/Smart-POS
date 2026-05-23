import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    INGREDIENT_CATEGORIES,
    ingredientCategoryLabel,
    ingredientLabel,
    getIngredientUnit,
} from '../common/recipeUtils'

// Grouped read-only list by category for /ingredients > Báo cáo.
// Manager can reassign category inline via the per-row select.
//
// Sections render in this order:
//   1. Chưa phân loại (only if any) — surfaced first so they get attention
//   2. INGREDIENT_CATEGORIES in declared order
// Empty sections are skipped so the page stays compact.
export default function IngredientReportView({
    ingredients,
    ingredientCosts,
    ingredientUnits,
    configByIngredient,
    stockByIngredient,
    canEdit,
    onSaveCategory,
}) {
    const navigate = useNavigate()

    const grouped = useMemo(() => {
        const map = { null: [], main: [], packaging: [], tools: [] }
        for (const ing of ingredients) {
            const cat = configByIngredient.get(ing)?.category || null
            const bucket = map[cat] ?? map.null
            bucket.push(ing)
        }
        return map
    }, [ingredients, configByIngredient])

    const sections = []
    if (grouped.null.length > 0) sections.push({ key: null, label: ingredientCategoryLabel(null), items: grouped.null })
    for (const c of INGREDIENT_CATEGORIES) {
        if (grouped[c.key].length > 0) sections.push({ key: c.key, label: c.label, items: grouped[c.key] })
    }

    if (sections.length === 0) {
        return <p className="text-text-secondary text-[13px] text-center py-6">Chưa có nguyên liệu nào.</p>
    }

    return (
        <div className="flex flex-col gap-4">
            {sections.map(section => (
                <section key={section.key ?? 'uncategorized'} className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between px-1">
                        <span className={`text-[11px] font-black uppercase tracking-wider ${section.key === null ? 'text-warning' : 'text-text-secondary'}`}>
                            {section.label}
                        </span>
                        <span className="text-[10px] font-bold text-text-dim tabular-nums">{section.items.length}</span>
                    </div>
                    <div className="bg-surface border border-border/60 rounded-[14px] overflow-hidden divide-y divide-border/40">
                        {section.items.map(ing => {
                            const cfg = configByIngredient.get(ing)
                            const stock = stockByIngredient.get(ing)?.current_stock ?? null
                            const minStock = cfg?.min_stock || 0
                            const low = stock !== null && stock <= minStock
                            const unit = getIngredientUnit(ing, ingredientUnits[ing])
                            return (
                                <div
                                    key={ing}
                                    onClick={() => navigate(`/ingredients/${ing}`)}
                                    className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-surface-light/50 active:bg-surface-light transition-colors"
                                >
                                    <span className="flex-1 min-w-0 text-[13px] font-bold text-text truncate">
                                        {ingredientLabel(ing)}
                                    </span>
                                    <span className={`text-[13px] font-black tabular-nums shrink-0 ${low ? 'text-danger' : 'text-text-secondary'}`}>
                                        {stock !== null ? Math.round(stock * 10) / 10 : '—'}
                                        <span className="text-text-dim font-medium ml-1">{unit}</span>
                                    </span>
                                    {canEdit && onSaveCategory && (
                                        <select
                                            value={cfg?.category || ''}
                                            onClick={e => e.stopPropagation()}
                                            onChange={e => onSaveCategory(ing, e.target.value || null)}
                                            className="shrink-0 bg-transparent border-0 text-[11px] font-bold text-text-dim focus:outline-none cursor-pointer"
                                            title="Đổi nhóm"
                                        >
                                            <option value="">—</option>
                                            {INGREDIENT_CATEGORIES.map(c => (
                                                <option key={c.key} value={c.key}>{c.label}</option>
                                            ))}
                                        </select>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </section>
            ))}
        </div>
    )
}
