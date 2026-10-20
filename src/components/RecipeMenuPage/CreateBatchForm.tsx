import { useState } from 'react'
import { capitalizeWords } from '../../utils'

interface Props {
    saving?: boolean
    onSubmit: (name: string, unit: string, batchYield: number) => void
}

const UNITS = ['g', 'ml', 'cái']

// Thành phẩm = công thức tổng hợp nguyên liệu thành 1 thứ dùng tiếp (topping, nước cốt…): tên, đơn vị, sản lượng 1 mẻ.
export default function CreateBatchForm({ saving, onSubmit }: Props) {
    const [name, setName] = useState('')
    const [unit, setUnit] = useState(UNITS[0])
    const [batchYield, setBatchYield] = useState('')
    const yieldNum = Number(batchYield)
    const canSubmit = name.trim() && yieldNum > 0 && !saving

    return (
        <div className="flex flex-col gap-3">
            <input
                type="text"
                autoCapitalize="words"
                placeholder="Tên thành phẩm (vd: Trân châu nấu)"
                value={name}
                onChange={e => setName(capitalizeWords(e.target.value))}
                className="w-full bg-surface-light border border-border/60 rounded-[12px] px-3 py-2.5 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-primary/40 transition-colors"
            />
            <div className="flex gap-2 items-center">
                <input
                    type="number"
                    inputMode="decimal"
                    placeholder="Sản lượng 1 mẻ"
                    value={batchYield}
                    onChange={e => setBatchYield(e.target.value)}
                    className="flex-1 min-w-0 bg-surface-light border border-border/60 rounded-[12px] px-3 py-2.5 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-primary/40 transition-colors"
                />
                <div className="flex gap-1 shrink-0">
                    {UNITS.map(u => (
                        <button
                            key={u}
                            type="button"
                            onClick={() => setUnit(u)}
                            aria-pressed={unit === u}
                            className={`px-3 py-2.5 rounded-[12px] border text-[13px] font-bold transition-colors ${unit === u ? 'bg-primary/15 border-primary/40 text-primary' : 'bg-surface-light border-border/60 text-text-secondary'}`}
                        >
                            {u}
                        </button>
                    ))}
                </div>
            </div>
            <button
                onClick={() => canSubmit && onSubmit(name.trim(), unit, yieldNum)}
                disabled={!canSubmit}
                className="w-full py-3 rounded-[12px] bg-primary text-bg text-[14px] font-black hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed uppercase"
            >
                {saving ? 'Đang...' : 'Tạo'}
            </button>
        </div>
    )
}
