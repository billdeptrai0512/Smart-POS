import { useState, useEffect, useCallback } from 'react'
import { Package, ChevronRight } from 'lucide-react'
import { useAddress } from '../../contexts/AddressContext'
import { useAuth } from '../../contexts/AuthContext'
import { useStats } from '../../contexts/StatsContext'
import { useHistory } from '../../contexts/HistoryContext'
import { useToast } from '../../hooks/useToast'
import { useSavingAction } from '../../hooks/useSavingAction'
import { useProducts } from '../../contexts/ProductContext'
import { useWarehousePrep } from '../../hooks/usePrepNotice'
import { processIngredientRestock, recordInvoicePayment } from '../../services/orderService'
import { useCashClosedToday } from '../../hooks/useCashClosedToday'
import { fetchIngredientDebts, type IngredientDebt } from '../../services/expenseService'
import { dateStringVN } from '../../utils/dateVN'
import { formatVND } from '../../utils/money'
import { getIngredientUnit, ingredientLabel } from '../../utils/ingredients'
import { pack2Of } from '../../utils/inventory'
import HubBuyNotice from './HubBuyNotice'
import NoticeBar from '../common/NoticeBar'
import NoticeSheet from '../common/NoticeSheet'
import ShiftPrepCard from '../DailyReportPage/ShiftPrepCard'
import RestockModal, { type RestockPayload } from './RestockModal'
import InvoicePaymentSheet, { type InvoicePayment } from './InvoicePaymentSheet'
import Toast from '../POSPage/Toast'
import type { Row } from '../../types/domain'

// Dải notice "Bổ sung tồn kho" ở đỉnh /inventory (Tồn kho): NVL/bao bì cần MUA thêm để đủ bán ngày
// mai (target = max(dự báo mai, tồn tối thiểu) − tổng tồn kho + quầy). Bấm → danh sách; nút "Mua N …"
// mở RestockModal (cùng form Nhập kho của trang chi tiết), bấm tên → trang chi tiết. Mua đủ thì món chuyển xuống đáy với viên "Đã mua N" (tiến độ x/y, vẫn hiện đến hết ngày).
// Chỉ chủ/quản lý (nhập kho là thao tác ghi chi phí + kho); guest/offline ẩn như dải ở /pos.
// Bấm tên nguyên liệu → sang trang chi tiết (trang cha unmount); cờ module này cho lần mount kế
// (back về /inventory) mở lại đúng bảng — cùng kiểu cache `saved` của IngredientManagementPage.
let reopenSheet = false
// Công nợ lần tải gần nhất theo địa chỉ: về lại từ trang chi tiết thì section Công nợ có NGAY (như ảnh chụp của useSnapshot
// bên danh sách Cần mua) thay vì hiện sau → khỏi đẩy danh sách xuống. Tải xong thì thay bằng số thật.
const debtSnapshots = new Map<string, IngredientDebt[]>()

interface Props {
    onRestocked?: () => unknown
    onOpenIngredient?: (ingredient: string, tab?: 'history', sinceISO?: string) => void
}

export default function WarehousePrepNotice({ onRestocked, onOpenIngredient }: Props) {
    const { isGuest, isManager, isAdmin } = useAuth()
    const { addressId, warehouseRole } = useAddress()
    const { isOnline } = useStats()
    // Nhóm đã có kho tổng: số "cần mua" của từng chi nhánh so riêng với CÙNG 1 kho chung nên sai → kho tổng tính gộp cả nhóm
    // (HubBuyNotice), chi nhánh thành viên không mua hàng nên ẩn.
    if (!((isManager || isAdmin) && !isGuest && isOnline && addressId) || warehouseRole === 'member' || warehouseRole === 'pending') return null
    return warehouseRole === 'hub'
        ? <HubBuyNotice onRestocked={onRestocked} />
        : <Notice addressId={addressId} onRestocked={onRestocked} onOpenIngredient={onOpenIngredient} />
}

function Notice({ addressId, onRestocked, onOpenIngredient }: Props & { addressId: string }) {
    const { profile } = useAuth()
    const { ingredientUnits, refreshProducts } = useProducts()
    const { refreshTodayExpenses } = useHistory()
    const { items, ready, ingredientsList, warehouseStocks, reload, toast } = useWarehousePrep()
    // Món đã mua đủ (done) vẫn nằm trong danh sách → đếm tiến độ "đã mua / tổng", mẫu số đứng yên suốt ngày.
    const total = items.length
    const doneCount = items.filter(it => it.done).length
    const [debts, setDebts] = useState<IngredientDebt[]>(() => debtSnapshots.get(addressId) ?? [])
    const progress = total > 0 ? `${doneCount}/${total}` : debts.length // chỉ còn nợ (không món cần mua) → đếm số NVL nợ
    const [open, setOpen] = useState(reopenSheet)
    useEffect(() => { reopenSheet = false }, [])
    const [restock, setRestock] = useState<{ ingredient: string; qty: number | null } | null>(null)
    const loadDebts = useCallback(
        () => fetchIngredientDebts(addressId).then(d => { debtSnapshots.set(addressId, d); setDebts(d) }).catch(err => console.error('fetchIngredientDebts', err)),
        [addressId])
    useEffect(() => { loadDebts() }, [loadDebts])
    // Nợ chỉ 1 phiếu → mở thẳng form trả nợ; nhiều phiếu thì vào Nhật ký của nguyên liệu để chọn phiếu cần trả.
    const [payInvoice, setPayInvoice] = useState<Row | null>(null)
    const { toast: payToast, showToast, showError } = useToast()
    const { saving, withSaving } = useSavingAction(showError)
    const handlePay = ({ amount, paymentMethod, paidAt, cashPhase }: InvoicePayment) => withSaving('Ghi nhận thanh toán', async () => {
        await recordInvoicePayment(payInvoice!.address_id || addressId, payInvoice!.id, amount, paymentMethod, profile?.name, paidAt, cashPhase)
        await Promise.all([loadDebts(), refreshTodayExpenses?.()])
        setPayInvoice(null)
        showToast('Đã ghi nhận thanh toán', 'success')
    })

    // Phân loại dòng tiền đúng (trước/sau chốt két) — refetch mỗi lần mở form nhập kho.
    const cashClosedToday = useCashClosedToday(addressId, !!restock)

    if (total === 0 && debts.length === 0 && !open && !restock) return null
    const cfg = restock && (ingredientsList || []).find(i => i.ingredient === restock.ingredient)

    return (
        <>
            {(total > 0 || debts.length > 0) && (
                <NoticeBar
                    icon={<Package size={15} className="text-primary shrink-0" />}
                    label="Bổ sung tồn kho"
                    count={progress}
                    onClick={ready ? () => setOpen(true) : undefined} // số từ ảnh chụp: chờ tính xong mới mở form nhập kho
                />
            )}
            <Toast toast={toast} />
            <Toast toast={payToast} />

            {open && !restock && !payInvoice && (ready || total > 0) && (
                <NoticeSheet
                    icon={<Package size={18} className="text-primary shrink-0" />}
                    title="Bổ sung tồn kho"
                    count={progress}
                    onClose={() => setOpen(false)}
                >
                    {debts.length > 0 && (
                        <>
                            <SectionHeading first tone="warning">Công nợ</SectionHeading>
                            {debts.map(d => (
                                <button
                                    key={d.ingredient}
                                    type="button"
                                    onClick={d.invoices.length === 1 ? () => setPayInvoice(d.invoices[0]) : onOpenIngredient && (() => { reopenSheet = true; onOpenIngredient(d.ingredient, 'history', dateStringVN(new Date(d.invoices[0].created_at))) })}
                                    className="w-full flex items-center gap-3 py-2.5 border-b border-border/20 last:border-b-0 text-left active:scale-[0.99] transition"
                                >
                                    <span className="flex-1 min-w-0">
                                        <span className="block text-[14px] font-bold leading-tight text-text">{ingredientLabel(d.ingredient)}</span>
                                        <span className="block mt-0.5 text-[11px] text-text-dim">{d.invoices.length} phiếu chưa trả đủ</span>
                                    </span>
                                    <span className="shrink-0 text-[15px] font-black text-warning tabular-nums">{formatVND(d.owing)}</span>
                                    <ChevronRight size={15} className="shrink-0 text-text-dim -ml-1" />
                                </button>
                            ))}
                            {total > 0 && <SectionHeading tone="neutral">Cần mua</SectionHeading>}
                        </>
                    )}
                    <ShiftPrepCard
                        packVerb="Mua"
                        haveLabel="Tồn quầy cuối ca"
                        emptyTitle="Kho tổng đủ cho mai!"
                        emptyHint="Không cần đi chợ đắp thêm cho ngày mai."
                        items={items}
                        onOpen={onOpenIngredient && (ingredient => { reopenSheet = true; onOpenIngredient(ingredient) })}
                        onRestock={(ingredient, qty) => setRestock({ ingredient, qty: qty > 0 ? qty : null })}
                    />
                </NoticeSheet>
            )}

            {payInvoice && (
                <InvoicePaymentSheet invoice={payInvoice} saving={saving} onClose={() => setPayInvoice(null)} onConfirm={handlePay} />
            )}

            {restock && (
                <RestockModal
                    ingredient={restock.ingredient}
                    unit={getIngredientUnit(restock.ingredient, ingredientUnits[restock.ingredient])}
                    packSize={cfg?.pack_size}
                    packUnit={cfg?.pack_unit}
                    pack2={pack2Of(cfg)}
                    initialQty={restock.qty}
                    cashClosedToday={cashClosedToday}
                    onClose={() => setRestock(null)}
                    onConfirm={async ({ ingredient: ing, qty, subtotal, discount, extraCost, paid, paymentMethod, cashPhase, purchaseDate }: RestockPayload) => {
                        const wh = (warehouseStocks || {})[ing]
                        const result = await processIngredientRestock(addressId, ing, qty, profile?.name ?? null, {
                            subtotal, discount, extraCost, paid, paymentMethod, cashPhase, purchaseDate,
                            ...(wh != null ? { beforeStock: wh } : {}),
                        })
                        // Kho đổi → tươi lại: danh sách của hook, context sản phẩm/chi phí, và list tồn của trang cha.
                        await Promise.all([reload(), refreshProducts?.(), refreshTodayExpenses?.(), onRestocked?.(), loadDebts()])
                        return result
                    }}
                />
            )}
        </>
    )
}

// Dải full-bleed (bù px-5 + pt-1 của NoticeSheet) cùng kiểu "Cần lấy ngay / Soạn đầu ca" của ShiftPrepCard.
function SectionHeading({ children, tone, first }: { children: string; tone: 'warning' | 'neutral'; first?: boolean }) {
    return (
        <div className={`-mx-5 px-5 py-1.5 text-[12px] font-black uppercase tracking-wide ${first ? '-mt-1' : ''} ${tone === 'warning' ? 'bg-warning/10 text-warning' : 'bg-surface-light text-text-secondary'}`}>
            {children}
        </div>
    )
}
