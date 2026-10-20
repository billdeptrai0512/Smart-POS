import { useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { useProducts } from '../../contexts/ProductContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { cancelProductionBatch } from '../../services/productionService'
import { dateStringVN, timeStringVN } from '../../utils/dateVN'
import { ingredientLabel } from '../../utils/ingredients'
import { r1 } from '../../utils/inventory'
import type { Row } from '../../types/domain'
import ProduceBatchSheet from '../common/ProduceBatchSheet'

interface Props {
    /** Gọi sau khi ghi/hủy một mẻ — để tải lại tồn quầy (mẻ đổi tiêu hao). */
    onChanged: () => void
    onError: (err: unknown, action: string) => void
}

// Lối vào "Sản xuất mẻ" ở Kiểm kê (làm giữa ca) + nhật ký mẻ hôm nay, hủy được khi làm nhầm. Lối vào buổi sáng nằm ở "Chuẩn bị hôm nay".
export default function TodayProduction({ onChanged, onError }: Props) {
    const { batchProducts, productionRows, ingredientUnits, refreshProduction } = useProducts()
    const confirm = useConfirm()
    const [producing, setProducing] = useState<Row | null>(null)
    if (!batchProducts.length) return null

    const today = dateStringVN()
    const todayRows = productionRows.filter(p => dateStringVN(new Date(p.created_at)) === today)

    async function cancel(row: Row) {
        if (!await confirm({ title: 'Hủy mẻ này?', detail: 'Nguyên liệu và thành phẩm sẽ được hoàn lại như chưa làm.', danger: true, confirmLabel: 'Hủy mẻ' })) return
        try {
            await cancelProductionBatch(row.id)
            await refreshProduction()
            onChanged()
        } catch (e) {
            onError(e, 'Hủy mẻ sản xuất')
        }
    }

    return (
        <div className="bg-surface border border-border/60 rounded-[20px] px-4 py-3 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-[12px] font-black uppercase tracking-widest text-text-secondary">
                <FlaskConical size={14} className="text-primary" />
                Sản xuất thành phẩm
            </div>
            <div className="flex flex-wrap gap-2">
                {batchProducts.map(b => (
                    <button
                        key={b.id}
                        type="button"
                        onClick={() => setProducing(b)}
                        className="px-3 py-2 rounded-[12px] border border-primary/40 bg-primary/10 text-primary text-[13px] font-black active:scale-95 transition"
                    >
                        + {b.name}
                    </button>
                ))}
            </div>
            {todayRows.map(p => {
                const unit = ingredientUnits?.[p.output_ingredient] || ''
                return (
                    <div key={p.id} className="flex items-center justify-between gap-2 text-[12px] text-text-secondary border-t border-border/30 pt-2">
                        <span className="min-w-0 truncate">
                            {timeStringVN(new Date(p.created_at))} · {r1(p.batches)} mẻ · +{r1(p.output_qty)} {unit} {ingredientLabel(p.output_ingredient)}
                            {p.staff_name ? ` · ${p.staff_name}` : ''}
                        </span>
                        <button type="button" onClick={() => cancel(p)} className="shrink-0 text-danger font-bold px-2 py-1">Hủy</button>
                    </div>
                )
            })}
            {producing && <ProduceBatchSheet product={producing} onClose={() => setProducing(null)} onDone={onChanged} />}
        </div>
    )
}
