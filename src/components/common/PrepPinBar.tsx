import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useProducts } from '../../contexts/ProductContext'
import { useHistory } from '../../contexts/HistoryContext'
import { useCashClosedToday } from '../../hooks/useCashClosedToday'
import { processIngredientRestock } from '../../services/orderService'
import type { PrepItem } from '../../utils/prepToday'
import RestockModal from '../IngredientManagementPage/RestockModal'
import { useAuth } from '../../contexts/AuthContext'
import { useAddress } from '../../contexts/AddressContext'
import { useStats } from '../../contexts/StatsContext'
import { usePrepNotice } from '../../hooks/usePrepNotice'
import { useOnboardingProgress } from '../../hooks/useOnboardingProgress'
import { writeOnboardingState } from '../../utils/onboardingStorage'
import NoticeSheet, { SheetBody } from './NoticeSheet'
import ShiftPrepCard from '../DailyReportPage/ShiftPrepCard'
import Toast from '../POSPage/Toast'
import BatchPrepList from './BatchPrepList'

// Dải notice "Chuẩn bị hôm nay" trên /pos — nằm trong Header, dưới thẻ Địa chỉ + Nhật ký (POSPage truyền vào prop notice).
// Hết việc (0) thì ẩn pill — nút Mang đi bên cạnh tự giãn full width (nó thành :first-child ở Header). Số bên phải = số NVL đang chờ lấy từ kho dự trữ ra quầy (soạn sáng nay
// chưa xong, hoặc Lý thuyết ở quầy đã về 0 giữa ca). Bấm → modal checklist, nhân viên
// xác nhận đã lấy ngay tại chỗ. Offline ẩn — hook cần đọc kho.
// Guest: bước 1 "Chuẩn bị" của guide (onboarding/steps.ts) — quầy mẫu = 0, kho mẫu = 1 bịch/hộp/cây mỗi món.
// Người dùng thật: không vẽ dải — chuông trên TopNav điều khiển sheet (open/onClose) và nhận số việc (onCount). Khách dùng thử cũng vậy (chuông sáng nhịp guide ở bước 1).
interface BellProps { open: boolean; onClose: () => void; onCount: (n: number) => void }
export default function PrepPinBar({ bell }: { bell: BellProps }) {
    const { addressId } = useAddress()
    const { isOnline } = useStats()
    // Thân nằm ở component con chỉ mount cùng POSPage — rời trang thì state `open` + hook unmount theo,
    // quay lại không bị bật lại modal cũ.
    return isOnline && addressId ? <PinBar addressId={addressId} bell={bell} /> : null
}

function PinBar({ addressId, bell }: { addressId: string; bell: BellProps }) {
    const { isGuest, isManager, isAdmin, profile } = useAuth()
    const { refreshProducts } = useProducts()
    const { refreshTodayExpenses } = useHistory()
    const { items, batchItems, checked, skipped, pendingCount, ready, confirmPrep, toggleSkip, settle, toast, reloadStocks } = usePrepNotice()
    // Món kho = 0 → "Nhập kho" mở phiếu ngay tại đây (hết thật, hoặc đã mua bù chưa nhập sổ). Chỉ chủ/quản lý ghi được phiếu nhập; nhân viên thấy "Hết kho".
    const canRestock = isManager || isAdmin
    const [restock, setRestock] = useState<PrepItem | null>(null) // ảnh chụp món lúc mở phiếu — danh sách tải lại sau khi ghi cũng không làm phiếu biến mất
    const cashClosedToday = useCashClosedToday(addressId, !!restock)
    const { open, onClose, onCount } = bell
    useEffect(() => { onCount(pendingCount) }, [onCount, pendingCount])

    const total = items.length + batchItems.length
    const doneCount = total - pendingCount

    // Guide: ghi tiến độ lấy hàng; `done` chốt khi lấy đủ (danh sách còn đổi sau đó khi bán).
    const prep = useOnboardingProgress('prepProgress', { isGuest, addressId })
    const lastRef = useRef(prep)
    const allTaken = total > 0 && pendingCount === 0
    useEffect(() => {
        const last = lastRef.current
        if (!isGuest || !ready || last.done || !(open || last.opened)) return
        // done chỉ chốt khi đóng sheet → dải bước 2 ("Chạm vào món…") mới bắt đầu gõ sau khi khách bấm ✓ đóng.
        const next = { opened: true, taken: doneCount, total, done: allTaken && !open }
        lastRef.current = next
        writeOnboardingState(addressId, { prepProgress: next })
    }, [isGuest, ready, open, doneCount, total, allTaken, addressId])

    return (
        <>
            <Toast toast={toast} />

            {open && (
                <NoticeSheet
                    icon={<span className="shrink-0 text-[12px] font-black text-primary tabular-nums">{doneCount}/{total}</span>}
                    title="Bạn cần chuẩn bị"
                    onClose={() => { onClose(); settle() }}
                    hintClose={isGuest && allTaken} // không gate prep.done: hook sống, lấy đủ là done ngay → nút Đóng phải sáng đúng lúc đó
                >
                    {/* Chưa tính xong và chưa có ảnh chụp → skeleton, đừng hiện "Đủ hàng cho hôm nay!" giả (items còn rỗng). */}
                    <SheetBody error={null} loading={!ready && total === 0} onRetry={reloadStocks}>
                    <ShiftPrepCard
                        packVerb="Lấy"
                        haveLabel="Tồn quầy hiện có"
                        hintNext={isGuest && !prep.done}
                        emptyTitle="Đủ hàng cho hôm nay!"
                        items={items}
                        checked={checked}
                        skipped={skipped}
                        onToggle={confirmPrep}
                        onSkip={toggleSkip}
                        stockGate
                        onOpen={canRestock ? (ing) => setRestock(items.find(i => i.ingredient === ing) ?? null) : undefined} // kho = 0 → "Nhập kho" mở phiếu
                    />
                    <BatchPrepList items={batchItems} />
                    </SheetBody>
                </NoticeSheet>
            )}
            {/* Portal ra body: dải này nằm trong header POS (z-20 = stacking context riêng) nên phiếu z-[100] sẽ kẹt DƯỚI sheet (sheet đã portal ra body). */}
            {restock && createPortal(
                <RestockModal
                    ingredient={restock.ingredient}
                    unit={restock.unit || 'đv'}
                    packSize={restock.packSize}
                    packUnit={restock.packUnit}
                    pack2={restock.pack2}
                    initialQty={restock.needPacks || restock.need || null}
                    cashClosedToday={cashClosedToday}
                    onClose={() => setRestock(null)}
                    onConfirm={async ({ ingredient: ing, qty, subtotal, discount, extraCost, paid, paymentMethod, cashPhase, purchaseDate }) => {
                        const wh = restock.warehouse
                        const result = await processIngredientRestock(addressId, ing, qty, profile?.name ?? null, {
                            subtotal, discount, extraCost, paid, paymentMethod, cashPhase, purchaseDate,
                            ...(wh != null ? { beforeStock: wh } : {}),
                        })
                        // Kho đổi → tươi lại kho (viên tự về "Lấy"), giá vốn và chi phí hôm nay.
                        await Promise.all([reloadStocks(), refreshProducts?.(), refreshTodayExpenses?.()])
                        return result
                    }}
                />,
                document.body
            )}
        </>
    )
}
