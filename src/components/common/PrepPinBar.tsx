import { useState, useEffect, useRef } from 'react'
import { Hand } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useAddress } from '../../contexts/AddressContext'
import { useStats } from '../../contexts/StatsContext'
import { usePrepNotice } from '../../hooks/usePrepNotice'
import { useOnboardingProgress } from '../../hooks/useOnboardingProgress'
import { writeOnboardingState } from '../../utils/onboardingStorage'
import NoticeSheet from './NoticeSheet'
import NoticeBar from './NoticeBar'
import ShiftPrepCard from '../DailyReportPage/ShiftPrepCard'
import Toast from '../POSPage/Toast'
import BatchPrepList from './BatchPrepList'

// Dải notice "Chuẩn bị hôm nay" trên /pos — nằm trong Header, dưới thẻ Địa chỉ + Nhật ký (POSPage truyền vào prop notice).
// Hết việc (0) thì ẩn pill — nút Mang đi bên cạnh tự giãn full width (nó thành :first-child ở Header). Số bên phải = số NVL đang chờ lấy từ kho dự trữ ra quầy (soạn sáng nay
// chưa xong, hoặc Lý thuyết ở quầy đã về 0 giữa ca). Bấm → modal checklist, nhân viên
// xác nhận đã lấy ngay tại chỗ. Offline ẩn — hook cần đọc kho.
// Guest: bước 1 "Chuẩn bị" của guide (onboarding/steps.ts) — quầy mẫu = 0, kho mẫu = 1 bịch/hộp/cây mỗi món.
export default function PrepPinBar() {
    const { addressId } = useAddress()
    const { isOnline } = useStats()
    // Thân nằm ở component con chỉ mount cùng POSPage — rời trang thì state `open` + hook unmount theo,
    // quay lại không bị bật lại modal cũ.
    return isOnline && addressId ? <PinBar addressId={addressId} /> : null
}

function PinBar({ addressId }: { addressId: string }) {
    const { isGuest } = useAuth()
    const { items, batchItems, checked, skipped, pendingCount, ready, confirmPrep, toggleSkip, settle, toast } = usePrepNotice()
    const [open, setOpen] = useState(false)

    const total = items.length + batchItems.length
    const doneCount = total - pendingCount

    // Guide: ghi tiến độ lấy hàng; `done` chốt khi lấy đủ (danh sách còn đổi sau đó khi bán).
    const prep = useOnboardingProgress('prepProgress', { isGuest, addressId })
    const lastRef = useRef(prep)
    const allTaken = total > 0 && pendingCount === 0
    const intro = isGuest && !prep.done // lời chào đầu guide: icon vẫy tay + "Đầu tiên, …"
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
            {pendingCount > 0 && <NoticeBar // không icon: pill đã nổi nhờ nền/viền
                icon={intro ? <Hand size={18} className="shrink-0 text-primary wave-hand" /> : undefined}
                label={intro ? 'Đầu tiên, bạn cần chuẩn bị' : 'Bạn cần chuẩn bị'}
                count={pendingCount} // số việc đang chờ lấy ra quầy
                chevron={false}
                onClick={ready ? () => setOpen(true) : undefined} // số từ ảnh chụp: chờ tính xong mới cho thao tác
                hint={isGuest && ready && !open && !prep.done && !allTaken}
            />}
            <Toast toast={toast} />

            {open && (
                <NoticeSheet
                    icon={<span className="shrink-0 text-[16px] font-black text-primary tabular-nums">{doneCount}/{total}</span>}
                    title="Bạn cần chuẩn bị"
                    count=""
                    onClose={() => { setOpen(false); settle() }}
                    hintClose={isGuest && allTaken} // không gate prep.done: hook sống, lấy đủ là done ngay → nút Đóng phải sáng đúng lúc đó
                >
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
                    />
                    <BatchPrepList items={batchItems} />
                </NoticeSheet>
            )}
        </>
    )
}
