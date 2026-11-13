import { useState, useEffect, useCallback } from 'react'
import { Package, ChevronRight } from 'lucide-react'
import { useAddress } from '../../contexts/AddressContext'
import { useAuth } from '../../contexts/AuthContext'
import { useStats } from '../../contexts/StatsContext'
import { useHistory } from '../../contexts/HistoryContext'
import { useToast } from '../../hooks/useToast'
import { useSavingAction } from '../../hooks/useSavingAction'
import { useProducts } from '../../contexts/ProductContext'
import { useGroupPrep } from '../../hooks/useGroupPrep'
import { recordInvoicePayment } from '../../services/orderService'
import { fetchIngredientDebts, fetchTodayExpenses, type IngredientDebt } from '../../services/expenseService'
import type { UsageMap } from '../../utils/inventory'
import { buildHubBuyItems } from '../../utils/hubBuy'
import { buildTodayBoughtMap } from '../../utils/prepToday'
import { dateStringVN } from '../../utils/dateVN'
import { formatVND } from '../../utils/money'
import { ingredientLabel } from '../../utils/ingredients'
import { writeOnboardingState } from '../../utils/onboardingStorage'
import { useOnboardingProgress } from '../../hooks/useOnboardingProgress'
import HubBuyNotice, { HubBuyBody } from './HubBuyNotice'
import NoticeBar from '../common/NoticeBar'
import NoticeSheet from '../common/NoticeSheet'
import InvoicePaymentSheet, { type InvoicePayment } from './InvoicePaymentSheet'
import Toast from '../POSPage/Toast'
import type { Row } from '../../types/domain'

// Dải notice "Bổ sung tồn kho" ở đỉnh /inventory (Tồn kho): NVL/bao bì cần MUA thêm để đủ bán ngày
// mai (target = max(dự báo mai, tồn tối thiểu) − tổng tồn kho + quầy). Bấm → danh sách; nút "Mua N …"
// mở RestockModal (cùng form Nhập kho của trang chi tiết), bấm tên → trang chi tiết. Mua đủ thì món chuyển xuống đáy với viên "Đã mua N" (tiến độ x/y, vẫn hiện đến hết ngày).
// Chỉ chủ/quản lý (nhập kho là thao tác ghi chi phí + kho); offline ẩn như dải ở /pos.
// hint: bước cuối guide khách dùng thử (onboarding/steps.ts) — khách nhập kho mẫu 1 món, app nhập nốt phần còn lại, xong bước.
// Bấm tên nguyên liệu → sang trang chi tiết (trang cha unmount); cờ module này cho lần mount kế
// (back về /inventory) mở lại đúng bảng — cùng kiểu cache `saved` của IngredientManagementPage.
let reopenSheet = false
// Công nợ lần tải gần nhất theo địa chỉ: về lại từ trang chi tiết thì section Công nợ có NGAY (như ảnh chụp của useSnapshot
// bên danh sách Cần mua) thay vì hiện sau → khỏi đẩy danh sách xuống. Tải xong thì thay bằng số thật.
const debtSnapshots = new Map<string, IngredientDebt[]>()

interface Props {
    onRestocked?: () => unknown
    onOpenIngredient?: (ingredient: string, tab?: 'history', sinceISO?: string) => void
    hint?: boolean
}

export default function WarehousePrepNotice({ onRestocked, onOpenIngredient, hint }: Props) {
    const { isManager, isAdmin } = useAuth()
    const { addressId, warehouseRole } = useAddress()
    const { isOnline } = useStats()
    // Nhóm đã có kho tổng: số "cần mua" của từng chi nhánh so riêng với CÙNG 1 kho chung nên sai → kho tổng tính gộp cả nhóm
    // (HubBuyNotice), chi nhánh thành viên không mua hàng nên ẩn.
    if (!((isManager || isAdmin) && isOnline && addressId) || warehouseRole === 'member' || warehouseRole === 'pending') return null
    return warehouseRole === 'hub'
        ? <HubBuyNotice onRestocked={onRestocked} />
        : <Notice key={addressId} addressId={addressId} onRestocked={onRestocked} onOpenIngredient={onOpenIngredient} hint={hint} />
}

function Notice({ addressId, onRestocked, onOpenIngredient, hint }: Props & { addressId: string }) {
    const { profile, isGuest } = useAuth()
    const { refreshProducts } = useProducts()
    const { refreshTodayExpenses } = useHistory()
    // Cùng đường tính với dải "Việc cần làm" ở /addresses (useGroupPrep + buildHubBuyItems) → hai nơi luôn khớp.
    const prep = useGroupPrep([{ id: addressId, name: '' }], true)
    // "Đã mua hôm nay" đọc thẳng theo địa chỉ (context lịch sử chỉ có số liệu khi trang nào đó tải nó).
    const [bought, setBought] = useState<UsageMap>() // undefined = chưa đọc xong: chưa tính để số đếm khỏi nhảy (món đã mua đủ chỉ có sau khi đọc)
    const loadBought = useCallback(
        () => fetchTodayExpenses(addressId).then(e => setBought(buildTodayBoughtMap(e))).catch(err => { console.error('fetchTodayExpenses', err); setBought(b => b ?? {}) }),
        [addressId])
    useEffect(() => { loadBought() }, [loadBought])
    const ready = !!prep.plan && !!bought
    const items = ready ? buildHubBuyItems(prep, bought, true) : []
    // Món đã mua đủ (done) vẫn nằm trong danh sách → đếm tiến độ "đã mua / tổng", mẫu số đứng yên suốt ngày.
    const total = items.length
    const doneCount = items.filter(it => it.done).length
    const [debts, setDebts] = useState<IngredientDebt[]>(() => debtSnapshots.get(addressId) ?? [])
    // Chỉ còn nợ (không món cần mua) → đếm số NVL nợ; tính mua bị lỗi mà không có nợ → "!" để dải không biến mất im lặng (mở ra có nút Thử lại).
    const progress = total > 0 ? `${doneCount}/${total}` : debts.length || (prep.error ? '!' : 0)
    const show = total > 0 || debts.length > 0 || !!prep.error
    const [open, setOpen] = useState(reopenSheet)
    const [hinted, setHinted] = useState(false)
    const restockProgress = useOnboardingProgress('restockProgress', { isGuest, addressId })
    const openSheet = () => { setOpen(true); setHinted(true) }
    useEffect(() => { reopenSheet = false }, [])
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

    if (!show && !open) return null

    return (
        <>
            {/* Dải hiện sau khi tải xong số liệu: mở dần chiều cao (0fr→1fr) thay vì bật ra đẩy cả trang xuống giật một nhịp. */}
            {show && (
                <div className="restock-slide-in grid">
                    <div className="min-h-0 overflow-hidden">
                        <NoticeBar
                            icon={<Package size={15} className="text-primary shrink-0" />}
                            label="Tồn kho cần bổ sung"
                            count={progress}
                            onClick={openSheet} // chưa xong / lỗi: HubBuyBody tự hiện khung chờ / nút Thử lại
                            hint={hint && !hinted && !open}
                            typed={isGuest}
                        />
                    </div>
                </div>
            )}
            <Toast toast={payToast} />

            {open && !payInvoice && (
                <NoticeSheet
                    icon={<span className="shrink-0 text-[16px] font-black text-primary tabular-nums">{progress}</span>}
                    title="Tồn kho cần bổ sung"
                    count=""
                    onClose={() => setOpen(false)}
                    hintClose={restockProgress.bought && !restockProgress.viewedNet} // guide: nhập kho xong → sáng nút Đóng
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
                    <HubBuyBody
                        addressId={addressId}
                        prep={prep}
                        bought={bought}
                        minAsFloor
                        onOpenIngredient={onOpenIngredient && (ingredient => { reopenSheet = true; onOpenIngredient(ingredient) })}
                        onAfterRestock={(bought) => {
                            showToast(bought.length > 1 ? `Đã nhập kho ${bought.length} món` : `Đã nhập kho ${ingredientLabel(bought[0])}`, 'success')
                            if (hint) writeOnboardingState(addressId, { restockProgress: { bought: true, viewedNet: false } })
                            return Promise.all([refreshProducts?.(), refreshTodayExpenses?.(), onRestocked?.(), loadDebts(), loadBought()])
                        }}
                        demoAutoBuy={hint}
                    />
                </NoticeSheet>
            )}

            {payInvoice && (
                <InvoicePaymentSheet invoice={payInvoice} saving={saving} onClose={() => setPayInvoice(null)} onConfirm={handlePay} />
            )}

        </>
    )
}

// Dải full-bleed (bù px-5 + pt-1 của NoticeSheet) cùng kiểu "Cần lấy ngay / Soạn đầu ca" của ShiftPrepCard.
function SectionHeading({ children, tone, first }: { children: string; tone: 'warning' | 'neutral'; first?: boolean }) {
    return (
        <div className={`-mx-5 px-5 py-1.5 text-[12px] font-black uppercase tracking-wide ${first ? '-mt-1' : 'mb-3'} ${tone === 'warning' ? 'bg-warning/10 text-warning' : 'bg-surface-light text-text-secondary'}`}>
            {children}
        </div>
    )
}
