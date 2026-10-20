import { useState } from 'react'
import { BottomSheet, SheetHeader, SHEET_PANEL } from './ModalShell'
import { useProducts } from '../../contexts/ProductContext'
import { useAddress } from '../../contexts/AddressContext'
import { useAuth } from '../../contexts/AuthContext'
import { produceBatch } from '../../services/productionService'
import { ingredientLabel, getIngredientUnit, normalizeIngredientKey } from '../../utils/ingredients'
import { r1 } from '../../utils/inventory'
import type { Row } from '../../types/domain'

const QUICK = [0.5, 1, 1.5, 2]
const fmt = (n: number, unit: string) => `${r1(n)} ${unit}`

interface Props {
    product: Row
    /** Lượng thành phẩm cần làm (đơn vị thành phẩm) → mớm sẵn số mẻ, làm tròn lên 0.5. */
    suggestedQty?: number
    onClose: () => void
    onDone?: () => void
}

// "Sản xuất mẻ": nhân viên chọn số mẻ tùy ý (0.5, 1, 1.5…) — nguyên liệu gốc trừ theo mẻ × công thức mẻ, thành phẩm cộng
// theo sản lượng mẻ. Ghi qua RPC produce_batch; tiêu hao cộng vào tồn quầy ở client (utils/production).
export default function ProduceBatchSheet({ product, suggestedQty, onClose, onDone }: Props) {
    const { recipes, ingredientUnits, refreshProduction } = useProducts()
    const { addressId } = useAddress()
    const { profile } = useAuth()
    const yieldQty = Number(product.batch_yield) || 0
    const outUnit = ingredientUnits?.[normalizeIngredientKey(product.name)] || ''
    const [batches, setBatches] = useState(() =>
        String(suggestedQty && yieldQty > 0 ? Math.max(0.5, Math.ceil((suggestedQty / yieldQty) * 2) / 2) : 1))
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const n = Number(batches)
    const lines = recipes.filter(r => r.product_id === product.id && r.amount > 0)
    const out = r1(n * yieldQty)
    const canSubmit = n > 0 && out > 0 && lines.length > 0 && !saving

    async function submit() {
        if (!canSubmit || !addressId) return
        setSaving(true); setError(null)
        try {
            await produceBatch(addressId, product.id, normalizeIngredientKey(product.name), n, profile?.name ?? null)
            await refreshProduction()
            onDone?.()
            onClose()
        } catch (e) {
            console.error('produceBatch', e)
            setError('Không ghi được, thử lại')
            setSaving(false)
        }
    }

    return (
        <BottomSheet onClose={() => !saving && onClose()} panelClassName={SHEET_PANEL}>
            <SheetHeader title={`Sản xuất: ${product.name}`} onClose={onClose} closeDisabled={saving} />
            {yieldQty <= 0 || lines.length === 0 ? (
                <p className="text-[13px] text-danger">Thành phẩm chưa có sản lượng mẻ hoặc công thức mẻ. Vào Danh mục → Công thức để thiết lập.</p>
            ) : (
                <>
                    <div className="flex items-center gap-2">
                        {QUICK.map(q => (
                            <button
                                key={q}
                                type="button"
                                onClick={() => setBatches(String(q))}
                                aria-pressed={n === q}
                                className={`flex-1 py-2.5 rounded-[12px] border text-[14px] font-black transition-colors ${n === q ? 'bg-primary/15 border-primary/40 text-primary' : 'bg-surface-light border-border/60 text-text-secondary'}`}
                            >
                                {q}
                            </button>
                        ))}
                        <input
                            type="number"
                            inputMode="decimal"
                            value={batches}
                            onChange={e => setBatches(e.target.value)}
                            aria-label="Số mẻ"
                            className="w-20 shrink-0 bg-surface-light border border-border/60 rounded-[12px] px-2 py-2.5 text-center text-[14px] font-black text-text focus:outline-none focus:border-primary/40"
                        />
                        <span className="text-[12px] font-bold text-text-secondary shrink-0">mẻ</span>
                    </div>

                    <div className="rounded-[12px] bg-surface-light border border-border/60 px-3 py-2.5 flex flex-col gap-1 text-[13px]">
                        <span className="font-black text-success">+ {fmt(out, outUnit)} {product.name}</span>
                        {lines.map(r => (
                            <span key={r.ingredient} className="text-text-secondary">
                                − {fmt(r.amount * (n || 0), getIngredientUnit(r.ingredient, r.unit, ingredientUnits))} {ingredientLabel(r.ingredient)}
                            </span>
                        ))}
                    </div>
                </>
            )}
            {error && <p className="text-[13px] text-danger">{error}</p>}
            <button
                onClick={submit}
                disabled={!canSubmit}
                className="w-full py-3 rounded-[12px] bg-primary text-bg text-[14px] font-black hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed uppercase"
            >
                {saving ? 'Đang ghi...' : 'Xác nhận sản xuất'}
            </button>
        </BottomSheet>
    )
}
