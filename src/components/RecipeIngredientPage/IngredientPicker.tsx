import { useState } from 'react'

export interface NewIngredientInput { key: string; unit: string }

interface Props {
    existingIngredients?: string[]
    label?: string
    onConfirm: (ingredient: NewIngredientInput) => void
    onCancel: () => void
}

const UNIT_PRESETS = ['g', 'ml', 'ly', 'gói', 'quả']

// Form tạo nguyên liệu mới (tên + đơn vị). State cục bộ — cha chỉ nhận kết quả cuối qua onConfirm.
//
// `existingIngredients`: key đã có (tên trùng thì không hỏi đơn vị — dùng lại đơn vị đã có)
// `label`: tiêu đề khối
export default function IngredientPicker({ existingIngredients = [], label = 'Thêm nguyên liệu', onConfirm, onCancel }: Props) {
    const [name, setName] = useState('')
    const [unit, setUnit] = useState('')

    const trimmed = name.trim()
    const showUnit = trimmed && !existingIngredients.includes(trimmed)

    const submit = () => {
        if (!trimmed) return
        onConfirm({ key: trimmed.toLowerCase().replace(/\s+/g, '_'), unit: unit || 'đv' })
    }

    return (
        <div className="flex flex-col gap-2 bg-bg/50 p-3 rounded-xl border border-border/60 mt-2">
            <span className="text-[11px] text-text-dim font-bold uppercase">{label}</span>

            <div className="flex flex-col gap-1.5 pt-2 border-t border-border/30">
                <span className="text-[10px] text-text-dim">Nhập tên nguyên liệu mới:</span>
                <div className="flex flex-wrap sm:flex-nowrap gap-1.5">
                    <input
                        type="text"
                        placeholder="Tên..."
                        className="flex-1 w-0 min-w-[80px] bg-bg border border-border/60 rounded-lg px-2 py-1.5 text-[12px] text-text focus:outline-none focus:border-primary"
                        value={name}
                        onChange={e => setName(e.target.value)}
                    />
                    {showUnit && (
                        <div className="flex items-center gap-1">
                            {UNIT_PRESETS.map(u => (
                                <button
                                    key={u}
                                    onClick={() => setUnit(u)}
                                    className={`text-[10px] px-1.5 py-1 rounded-lg border transition-colors font-medium ${unit === u
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
                                value={!UNIT_PRESETS.includes(unit) ? unit : ''}
                                onChange={e => setUnit(e.target.value)}
                            />
                        </div>
                    )}
                </div>
            </div>

            <div className="flex gap-2 mt-1">
                <button
                    onClick={submit}
                    disabled={!trimmed}
                    className="flex-1 bg-primary text-bg px-3 py-1.5 rounded-lg text-[12px] font-bold disabled:opacity-50 transition-opacity"
                >
                    Thêm
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
