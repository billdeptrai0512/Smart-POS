import { FlaskConical, Trash2 } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useProducts } from '../../contexts/ProductContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { cancelProductionBatch } from '../../services/productionService'
import { dateStringVN, timeStringVN } from '../../utils/dateVN'
import { ingredientLabel } from '../../utils/ingredients'
import { r1 } from '../../utils/inventory'
import type { Row } from '../../types/domain'
import ProduceButton from '../common/ProduceButton'
import IngredientLogChip from '../common/IngredientLogChip'
import { ROUND_ICON_BTN } from '../common/ModalShell'

interface Props {
    /** Gọi sau khi ghi/hủy một mẻ — để tải lại tồn quầy (mẻ đổi tiêu hao). */
    onChanged: () => void
    onError: (err: unknown, action: string) => void
}

// Lối vào "Sản xuất mẻ" ở Kiểm kê (làm giữa ca) + nhật ký mẻ hôm nay, hủy được khi làm nhầm. Lối vào buổi sáng nằm ở "Chuẩn bị hôm nay".
// Mỗi mẻ liệt kê thành phẩm + nguyên liệu đã dùng; bấm vào từng cái mở Nhật ký của nó (ở đó cũng ghi dòng sản xuất này).
export default function TodayProduction({ onChanged, onError }: Props) {
    const { batchProducts, productionRows, ingredientUnits, refreshProduction } = useProducts()
    const confirm = useConfirm()
    const navigate = useNavigate()
    const location = useLocation()
    if (!batchProducts.length) return null

    const today = dateStringVN()
    const todayRows = productionRows.filter(p => dateStringVN(new Date(p.created_at)) === today)
    const unitOf = (k: string) => ingredientUnits?.[k] || ''
    // backTo: bấm Quay lại ở trang nguyên liệu thì về đúng Kiểm kê, không nhảy sang Lưu trữ.
    const openLog = (key: string) => navigate(`/inventory/stocking/${encodeURIComponent(key)}?tab=history&scope=month`, { state: { ...location.state, backTo: location.pathname + location.search } })

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
        <div className="bg-surface border border-border/60 rounded-[20px] px-4 py-3 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-[12px] font-black uppercase tracking-widest text-text-secondary">
                <FlaskConical size={14} className="text-primary" />
                Sản xuất thành phẩm
            </div>
            <div className="flex flex-wrap gap-2">
                {batchProducts.map(b => (
                    <ProduceButton
                        key={b.id}
                        product={b}
                        onDone={onChanged}
                        className="px-3 py-2 rounded-[12px] border border-primary/40 bg-primary/10 text-primary text-[13px] font-black active:scale-95 transition"
                    >
                        + {b.name}
                    </ProduceButton>
                ))}
            </div>
            {todayRows.length > 0 && (
                <div className="flex flex-col gap-3 border-t border-border/30 pt-3">
                    {todayRows.map(p => (
                        <div key={p.id} className="flex flex-col gap-1.5">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex flex-col">
                                    <span className="text-[14px] font-black text-text truncate">
                                        {ingredientLabel(p.output_ingredient)} <span className="text-primary tabular-nums">+{r1(p.output_qty)} {unitOf(p.output_ingredient)}</span>
                                    </span>
                                    <span className="text-[11px] text-text-secondary">
                                        {timeStringVN(new Date(p.created_at))} · {r1(p.batches)} mẻ{p.staff_name ? ` · ${p.staff_name}` : ''}
                                    </span>
                                </div>
                                <button type="button" onClick={() => cancel(p)} aria-label="Hủy mẻ" className={`${ROUND_ICON_BTN} text-text-dim hover:text-danger active:scale-95`}>
                                    <Trash2 size={13} />
                                </button>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                <IngredientLogChip text={`Nhật ký ${ingredientLabel(p.output_ingredient)}`} onOpen={() => openLog(p.output_ingredient)} />
                                {Object.entries(p.inputs || {}).map(([k, v]) => (
                                    <IngredientLogChip key={k} text={`${ingredientLabel(k)} −${r1(Number(v))} ${unitOf(k)}`.trim()} onOpen={() => openLog(k)} />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
