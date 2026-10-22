import { useState } from 'react'
import { ChevronDown, ChevronUp, FlaskConical, Trash2 } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useProducts } from '../../contexts/ProductContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { cancelProductionBatch } from '../../services/productionService'
import { dateStringVN, timeStringVN } from '../../utils/dateVN'
import { ingredientLabel } from '../../utils/ingredients'
import { r1 } from '../../utils/inventory'
import type { Row } from '../../types/domain'
import ProduceButton from '../common/ProduceButton'
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
    const [open, setOpen] = useState(true)
    const [openId, setOpenId] = useState<string | null>(null)   // mẻ đang mở chi tiết (mặc định mỗi mẻ 1 dòng)
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
            <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex items-center gap-2 text-[12px] font-black uppercase tracking-widest text-text-secondary text-left">
                <FlaskConical size={14} className="text-primary" />
                <span className="flex-1">Sản xuất thành phẩm</span>
                {!open && todayRows.length > 0 && <span className="text-[10px] px-2 py-0.5 rounded-full border border-border/60 bg-surface-light tabular-nums">{todayRows.length} mẻ hôm nay</span>}
                {open ? <ChevronUp size={14} className="text-text-dim" /> : <ChevronDown size={14} className="text-text-dim" />}
            </button>
            {open && <>
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
                <div className="flex flex-col border-t border-border/30">
                    {todayRows.map(p => {
                        const isOpen = openId === p.id
                        return (
                            <div key={p.id} className="py-2 border-b border-border/20 last:border-b-0 last:pb-0">
                                <div className="flex items-center gap-2">
                                    <button type="button" onClick={() => setOpenId(isOpen ? null : p.id)} aria-expanded={isOpen} className="flex-1 min-w-0 flex items-center gap-2 text-left active:opacity-70">
                                        <span className="shrink-0 text-[11px] tabular-nums text-text-secondary">{timeStringVN(new Date(p.created_at))}</span>
                                        <span className="truncate text-[14px] font-black text-text">
                                            {ingredientLabel(p.output_ingredient)} <span className="text-primary tabular-nums">+{r1(p.output_qty)} {unitOf(p.output_ingredient)}</span>
                                        </span>
                                        {isOpen ? <ChevronUp size={14} className="shrink-0 text-text-dim" /> : <ChevronDown size={14} className="shrink-0 text-text-dim" />}
                                    </button>
                                    <button type="button" onClick={() => cancel(p)} aria-label="Hủy mẻ" className={`${ROUND_ICON_BTN} text-text-dim hover:text-danger active:scale-95`}>
                                        <Trash2 size={13} />
                                    </button>
                                </div>
                                {isOpen && (
                                    <div className="mt-2 flex flex-col rounded-[12px] bg-surface-light border border-border/40 divide-y divide-border/30 overflow-hidden">
                                        {Object.entries(p.inputs || {}).map(([k, v]) => (
                                            <button key={k} type="button" onClick={() => openLog(k)} className="flex items-center justify-between gap-3 px-3 py-2 text-[12px] text-left active:bg-border/20">
                                                <span className="truncate text-text">{ingredientLabel(k)}</span>
                                                <span className="shrink-0 tabular-nums text-text-secondary">−{r1(Number(v))} {unitOf(k)} <span className="text-text-dim">›</span></span>
                                            </button>
                                        ))}
                                        <div className="flex items-center justify-between gap-3 px-3 py-2 text-[11px] text-text-secondary">
                                            <span className="truncate">{r1(p.batches)} mẻ{p.staff_name ? ` · ${p.staff_name}` : ''}</span>
                                            <button type="button" onClick={() => openLog(p.output_ingredient)} className="shrink-0 font-bold text-primary">Xem nhật ký ›</button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
            </>}
        </div>
    )
}
