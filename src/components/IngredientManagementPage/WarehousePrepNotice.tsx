import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Package } from 'lucide-react'
import { useAddress } from '../../contexts/AddressContext'
import { useAuth } from '../../contexts/AuthContext'
import { useStats } from '../../contexts/StatsContext'
import { useHistory } from '../../contexts/HistoryContext'
import { useProducts } from '../../contexts/ProductContext'
import { useGroupPrep } from '../../hooks/useGroupPrep'
import { fetchTodayExpenses } from '../../services/expenseService'
import type { UsageMap } from '../../utils/inventory'
import { buildHubBuyItems } from '../../utils/hubBuy'
import { buildTodayBoughtMap } from '../../utils/prepToday'
import { ingredientLabel } from '../../utils/ingredients'
import { writeOnboardingState } from '../../utils/onboardingStorage'
import { useOnboardingProgress } from '../../hooks/useOnboardingProgress'
import HubBuyNotice, { HubBuyBody } from './HubBuyNotice'
import NoticeBar from '../common/NoticeBar'
import NoticeSheet from '../common/NoticeSheet'
import { DebtList, useDebtPay, useIngredientDebts } from './DebtSection'

// Dải notice "Bổ sung tồn kho" ở đỉnh /inventory (Tồn kho): NVL/bao bì cần MUA thêm để đủ bán ngày
// mai (target = max(dự báo mai, tồn tối thiểu) − tổng tồn kho + quầy). Bấm → danh sách; nút "Mua N …"
// mở RestockModal (cùng form Nhập kho của trang chi tiết), bấm tên → trang chi tiết. Mua đủ thì món chuyển xuống đáy với viên "Đã mua N" (tiến độ x/y, vẫn hiện đến hết ngày).
// Chỉ chủ/quản lý (nhập kho là thao tác ghi chi phí + kho); offline ẩn như dải ở /pos.
// hint: bước cuối guide khách dùng thử (onboarding/steps.ts) — khách nhập kho mẫu 1 món, app nhập nốt phần còn lại, xong bước.
// Bấm tên nguyên liệu → sang trang chi tiết (trang cha unmount); cờ module này cho lần mount kế
// (back về /inventory) mở lại đúng bảng — cùng kiểu cache `saved` của IngredientManagementPage.
let reopenSheet = false
interface Props {
    onRestocked?: () => unknown
    onOpenIngredient?: (ingredient: string, tab?: 'history', sinceISO?: string) => void
    hint?: boolean
    // Chế độ "chỉ sheet" (chuông trên thanh điều hướng): không vẽ dải, mở sẵn, đóng thì báo cha unmount. Mọi vai trò đều mở được.
    onClose?: () => void
}

export default function WarehousePrepNotice({ onRestocked, onOpenIngredient, hint, onClose }: Props) {
    const { isGuest } = useAuth()
    const { addressId, warehouseRole } = useAddress()
    const { isOnline } = useStats()
    // Dải ở đỉnh trang chỉ còn cho khách dùng thử (guide bước 6 cần nó); người dùng thật vào qua chuông.
    // Nhóm đã có kho tổng: số "cần mua" của từng chi nhánh so riêng với CÙNG 1 kho chung nên sai → kho tổng tính gộp cả nhóm
    // (HubBuyNotice), chi nhánh thành viên không mua hàng nên ẩn.
    const blocked = !((onClose || isGuest) && isOnline && addressId) || warehouseRole === 'member' || warehouseRole === 'pending'
    // Chế độ chuông mà không vẽ được (offline, chi nhánh thành viên) → báo cha đóng, kẻo cờ mở còn đó rồi sheet bật ra khi có mạng lại.
    useEffect(() => { if (blocked) onClose?.() }, [blocked]) // eslint-disable-line react-hooks/exhaustive-deps
    if (blocked) return null
    return warehouseRole === 'hub'
        ? <HubBuyNotice onRestocked={onRestocked} onClose={onClose} />
        : <Notice key={addressId} addressId={addressId} onRestocked={onRestocked} onOpenIngredient={onOpenIngredient} hint={hint} onClose={onClose} />
}

function Notice({ addressId, onRestocked, onOpenIngredient, hint, onClose }: Props & { addressId: string }) {
    const { isGuest } = useAuth()
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
    const { debts, reload: loadDebts } = useIngredientDebts(addressId)
    const progress = total > 0 ? `${doneCount}/${total}` : debts.length || (prep.error ? '!' : 0)
    const show = total > 0 || debts.length > 0 || !!prep.error
    const [open, setOpen] = useState(reopenSheet || !!onClose)
    const [hinted, setHinted] = useState(false)
    const restockProgress = useOnboardingProgress('restockProgress', { isGuest, addressId })
    const openSheet = () => { setOpen(true); setHinted(true) }
    const navigate = useNavigate()
    // Guide bước cuối: nhập kho xong, bấm Đóng → đi thẳng tới Báo cáo xem Thực chi (không bắt khách lần theo ‹ từng trang).
    const closeSheet = () => { setOpen(false); onClose?.(); if (restockProgress.bought && !restockProgress.viewedNet) navigate('/report/cashflow', { state: { wizard: true } }) }
    useEffect(() => { reopenSheet = false }, [])
    const { pay, setPay, node: payNode, showToast } = useDebtPay(loadDebts)

    if (!show && !open) return null

    return (
        <>
            {/* Dải hiện sau khi tải xong số liệu: mở dần chiều cao (0fr→1fr) thay vì bật ra đẩy cả trang xuống giật một nhịp. */}
            {show && !onClose && (
                <div className="restock-slide-in grid">
                    <div className="min-h-0 overflow-hidden">
                        <NoticeBar
                            icon={isGuest ? undefined : <Package size={15} className="text-primary shrink-0" />} // khách demo: dải đọc như lời dẫn của guide
                            label={isGuest ? 'Cuối cùng, bổ sung tồn kho mới' : 'Bổ sung tồn kho'}
                            count={progress}
                            chevron={false}
                            onClick={openSheet} // chưa xong / lỗi: HubBuyBody tự hiện khung chờ / nút Thử lại
                            hint={hint && !hinted && !open}
                            typed={isGuest}
                        />
                    </div>
                </div>
            )}

            {open && !pay && (
                <NoticeSheet
                    icon={<span className="shrink-0 text-[16px] font-black text-primary tabular-nums">{progress}</span>}
                    title="Tồn kho cần bổ sung"
                    count=""
                    onClose={closeSheet}
                    hintClose={restockProgress.bought && !restockProgress.viewedNet} // guide: nhập kho xong → sáng nút Đóng
                >
                    {debts.length > 0 && (
                        <>
                            <SectionHeading first tone="warning">Công nợ</SectionHeading>
                            <DebtList debts={debts} onPay={invoice => setPay({ addressId, invoice })} onOpenIngredient={onOpenIngredient && ((ing, tab, since) => { reopenSheet = !onClose; onOpenIngredient(ing, tab, since) })} />
                            {total > 0 && <SectionHeading tone="neutral">Cần mua</SectionHeading>}
                        </>
                    )}
                    <HubBuyBody
                        addressId={addressId}
                        prep={prep}
                        bought={bought}
                        minAsFloor
                        onOpenIngredient={onOpenIngredient && (ingredient => { reopenSheet = !onClose; onOpenIngredient(ingredient) })}
                        onAfterRestock={(bought) => {
                            showToast(bought.length > 1 ? `Đã nhập kho ${bought.length} món` : `Đã nhập kho ${ingredientLabel(bought[0])}`, 'success')
                            if (hint) writeOnboardingState(addressId, { restockProgress: { bought: true, viewedNet: false } })
                            return Promise.all([refreshProducts?.(), refreshTodayExpenses?.(), onRestocked?.(), loadDebts(), loadBought()])
                        }}
                        demoAutoBuy={hint}
                    />
                </NoticeSheet>
            )}

            {payNode}

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
