import { useState } from 'react'
import { ingredientLabel } from '../../utils/ingredients'

const UNIT_PRESETS = ['g', 'ml', 'ly', 'gói', 'quả']

// Multi-select ingredient form with optional custom-ingredient input.
// Self-contained local state — parent only receives the final list via onConfirm.
//
// `availableIngredients`: array of ingredient keys
// `existingIngredients`: array of ingredient keys already in use (for dedupe check on custom)
// `label`: section title (e.g. "Thêm nguyên liệu" or "Thêm nguyên liệu / tác động")
// `onConfirm({ keys: string[], custom?: { key, unit } })`
// `onCancel()`
export default function IngredientPicker({
    availableIngredients, existingIngredients = [],
    label = 'Thêm nguyên liệu',
    onConfirm, onCancel,
}) {
    const [selected, setSelected] = useState(new Set())
    const [customName, setCustomName] = useState('')
    const [customUnit, setCustomUnit] = useState('')

    const toggle = (ing) => {
        setSelected(prev => {
            const next = new Set(prev)
            if (next.has(ing)) next.delete(ing)
            else next.add(ing)
            return next
        })
    }

    const trimmedCustom = customName.trim()
    const showCustomUnit = trimmedCustom && !existingIngredients.includes(trimmedCustom)
    const totalCount = selected.size + (trimmedCustom ? 1 : 0)
    const canSubmit = totalCount > 0

    const handleSubmit = () => {
        if (!canSubmit) return
        const keys = [...selected]
        const payload = { keys }
        if (trimmedCustom) {
            const key = trimmedCustom.toLowerCase().replace(/\s+/g, '_')
            if (!keys.includes(key)) {
                payload.custom = { key, unit: customUnit || 'đv' }
            }
        }
        onConfirm(payload)
    }

    return (
        <div className="flex flex-col gap-2 bg-bg/50 p-3 rounded-xl border border-border/60 mt-2">
            <div className="flex items-center justify-between">
                <span className="text-[11px] text-text-dim font-bold uppercase">{label}</span>
                {selected.size > 0 && (
                    <span className="text-[10px] text-primary font-bold bg-primary/10 px-1.5 py-0.5 rounded">
                        Đã chọn {selected.size}
                    </span>
                )}
            </div>

            <div className="flex flex-wrap gap-1.5">
                {availableIngredients.map(ing => {
                    const isSelected = selected.has(ing)
                    return (
                        <button
                            key={ing}
                            onClick={() => toggle(ing)}
                            className={`text-[11px] border px-2 py-1 rounded-lg transition-colors font-medium ${isSelected
                                ? 'bg-primary text-bg border-primary shadow-sm'
                                : 'bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 active:bg-primary/30'
                                }`}
                        >
                            {isSelected ? '✓ ' : '+ '}{ingredientLabel(ing)}
                        </button>
                    )
                })}
            </div>

            <div className="flex flex-col gap-1.5 mt-1 pt-2 border-t border-border/30">
                <span className="text-[10px] text-text-dim">Hoặc nhập nguyên liệu mới:</span>
                <div className="flex flex-wrap sm:flex-nowrap gap-1.5">
                    <input
                        type="text"
                        placeholder="Tên..."
                        className="flex-1 w-0 min-w-[80px] bg-bg border border-border/60 rounded-lg px-2 py-1.5 text-[12px] text-text focus:outline-none focus:border-primary"
                        value={customName}
                        onChange={e => setCustomName(e.target.value)}
                    />
                    {showCustomUnit && (
                        <div className="flex items-center gap-1">
                            {UNIT_PRESETS.map(u => (
                                <button
                                    key={u}
                                    onClick={() => setCustomUnit(u)}
                                    className={`text-[10px] px-1.5 py-1 rounded-lg border transition-colors font-medium ${customUnit === u
                                        ? 'bg-primary text-bg border-primary'
                                        : 'bg-bg text-text-secondary border-border/60 hover:border-primary/40'
                                        }`}
                                >
                                    {u}
                                </button>
                            ))}
                            <input
                                type="text"
                                placeholder="đv"
                                className="w-[40px] bg-bg border border-border/60 rounded-lg px-1.5 py-1 text-[10px] text-text text-center focus:outline-none focus:border-primary"
                                value={!UNIT_PRESETS.includes(customUnit) ? customUnit : ''}
                                onChange={e => setCustomUnit(e.target.value)}
                            />
                        </div>
                    )}
                </div>
            </div>

            <div className="flex gap-2 mt-1">
                <button
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                    className="flex-1 bg-primary text-bg px-3 py-1.5 rounded-lg text-[12px] font-bold disabled:opacity-50 transition-opacity"
                >
                    {selected.size > 0
                        ? `Thêm ${totalCount} nguyên liệu`
                        : 'Thêm'}
                </button>
                <button
                    onClick={onCancel}
                    className="shrink-0 bg-surface-light border border-border/60 text-text px-2 py-1.5 rounded-lg text-[12px] font-bold"
                >
                    Hủy
                </button>
            </div>
        </div>
    )
}
