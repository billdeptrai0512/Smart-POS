import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
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
import NoticeSheet from '../common/NoticeSheet'
import { DebtList } from './DebtSection'
import { useDebtPay, useIngredientDebts } from '../../hooks/useIngredientDebts'

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
    // Chỉ còn chế độ chuông (onClose): người dùng thật và khách dùng thử (guide bước cuối) đều vào qua chuông trên TopNav.
    // Nhóm đã có kho tổng: số "cần mua" của từng chi nhánh so riêng với CÙNG 1 kho chung nên sai → kho tổng tính gộp cả nhóm
    // (HubBuyNotice), chi nhánh thành viên không mua hàng nên ẩn.
    const blocked = !(onClose && isOnline && addressId) || warehouseRole === 'member' || warehouseRole === 'pending'
    // Chế độ chuông mà không vẽ được (offline, chi nhánh thành viên) → báo cha đóng, kẻo cờ mở còn đó rồi sheet bật ra khi có mạng lại.
    useEffect(() => { if (blocked) onClose?.() }, [blocked]) // eslint-disable-line react-hooks/exhaustive-deps
    if (blocked) return null
    return warehouseRole === 'hub'
        ? <HubBuyNotice onRestocked={onRestocked} onClose={onClose} />
        : <Notice key={addressId} addressId={addressId} onRestocked={onRestocked} onOpenIngredient={onOpenIngredient} hint={hint} onClose={onClose} />
}

// Danh sách cần mua của 1 địa chỉ: cùng đường tính với dải "Việc cần làm" ở /addresses (useGroupPrep + buildHubBuyItems) → hai nơi luôn khớp.
// "Đã mua hôm nay" đọc thẳng theo địa chỉ (context lịch sử chỉ có số liệu khi trang nào đó tải nó).
function useBuyList(addressId: string) {
    const prep = useGroupPrep([{ id: addressId, name: '' }], true)
    const [bought, setBought] = useState<UsageMap>() // undefined = chưa đọc xong: chưa tính để số đếm khỏi nhảy (món đã mua đủ chỉ có sau khi đọc)
    const loadBought = useCallback(
        () => fetchTodayExpenses(addressId).then(e => setBought(buildTodayBoughtMap(e))).catch(err => { console.error('fetchTodayExpenses', err); setBought(b => b ?? {}) }),
        [addressId])
    useEffect(() => { loadBought() }, [loadBought])
    const items = prep.plan && bought ? buildHubBuyItems(prep, bought, true) : []
    return { prep, bought, loadBought, items, doneCount: items.filter(it => it.done).length }
}

// Chỉ để đếm cho huy hiệu chuông (khách dùng thử, bước cuối): mount khi cần, không vẽ gì — như PinBar của chuông ở /pos.
export function RestockCount({ addressId, onCount }: { addressId: string; onCount: (n: number) => void }) {
    const { items, doneCount } = useBuyList(addressId)
    useEffect(() => { onCount(items.length - doneCount) }, [onCount, items.length, doneCount])
    return null
}

function Notice({ addressId, onRestocked, onOpenIngredient, hint, onClose }: Props & { addressId: string }) {
    const { isGuest } = useAuth()
    const { refreshProducts } = useProducts()
    const { refreshTodayExpenses } = useHistory()
    const { prep, bought, loadBought, items, doneCount } = useBuyList(addressId)
    // Món đã mua đủ (done) vẫn nằm trong danh sách → đếm tiến độ "đã mua / tổng", mẫu số đứng yên suốt ngày.
    const total = items.length
    const { debts, reload: loadDebts } = useIngredientDebts(addressId)
    const progress = total > 0 ? `${doneCount}/${total}` : debts.length || (prep.error ? '!' : 0)
    const [open, setOpen] = useState(reopenSheet || !!onClose)
    const restockProgress = useOnboardingProgress('restockProgress', { isGuest, addressId })
    const navigate = useNavigate()
    // Guide bước cuối: nhập kho xong, bấm Đóng → đi thẳng tới Báo cáo xem Thực chi (không bắt khách lần theo ‹ từng trang).
    const closeSheet = () => { setOpen(false); onClose?.(); if (restockProgress.bought && !restockProgress.viewedNet) navigate('/report/cashflow', { state: { wizard: true } }) }
    useEffect(() => { reopenSheet = false }, [])
    const { pay, setPay, node: payNode, showToast } = useDebtPay(loadDebts)

    return (
        <>
            {open && !pay && (
                <NoticeSheet
                    icon={<span className="shrink-0 text-[12px] font-black text-primary tabular-nums">{progress}</span>}
                    title="Tồn kho cần bổ sung"
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

// Dải full-bleed (bù px-5 + pt-1 của NoticeSheet) cùng kiểu "Cần lấy thêm / Soạn đầu ca" của ShiftPrepCard.
function SectionHeading({ children, tone, first }: { children: string; tone: 'warning' | 'neutral'; first?: boolean }) {
    return (
        <div className={`-mx-5 px-5 py-1.5 text-[12px] font-black uppercase tracking-wide ${first ? '-mt-1' : 'mb-3'} ${tone === 'warning' ? 'bg-warning/10 text-warning' : 'bg-surface-light text-text-secondary'}`}>
            {children}
        </div>
    )
}
