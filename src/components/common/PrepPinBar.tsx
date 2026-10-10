import { useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useAddress } from '../../contexts/AddressContext'
import { useStats } from '../../contexts/StatsContext'
import { usePrepNotice } from '../../hooks/usePrepNotice'
import NoticeSheet from './NoticeSheet'
import NoticeBar from './NoticeBar'
import ShiftPrepCard from '../DailyReportPage/ShiftPrepCard'
import Toast from '../POSPage/Toast'

// Dải notice "Chuẩn bị hôm nay" trên /pos — nằm trong Header, dưới thẻ Địa chỉ + Nhật ký (POSPage truyền vào prop notice).
// BẮT BUỘC hiện khi còn NVL cần lấy từ kho dự trữ ra quầy (soạn sáng nay chưa xong, hoặc Lý thuyết ở
// quầy đã về 0 giữa ca). Bấm → modal checklist, nhân viên xác nhận đã lấy ngay tại chỗ.
// Guide ưu tiên: guest không thấy dải này (chỉ 1 dải ở đỉnh). Offline cũng ẩn — hook cần đọc kho.
export default function PrepPinBar() {
    const { isGuest } = useAuth()
    const { addressId } = useAddress()
    const { isOnline } = useStats()
    // Thân nằm ở component con chỉ mount cùng POSPage — rời trang thì state `open` + hook unmount theo,
    // quay lại không bị bật lại modal cũ.
    return !isGuest && isOnline && addressId ? <PinBar /> : null
}

function PinBar() {
    const { items, checked, skipped, pendingCount, ready, confirmPrep, toggleSkip, toast } = usePrepNotice()
    const [open, setOpen] = useState(false)

    if (!open && pendingCount === 0) return null

    const doneCount = items.length - pendingCount

    return (
        <>
            <NoticeBar
                icon={<CircleAlert size={15} className="text-primary shrink-0" />}
                label="Chuẩn bị hôm nay"
                count={`${doneCount}/${items.length}`}
                onClick={ready ? () => setOpen(true) : undefined} // số từ ảnh chụp: chờ tính xong mới cho thao tác
            />
            <Toast toast={toast} />

            {open && (
                <NoticeSheet
                    icon={<CircleAlert size={18} className="text-primary shrink-0" />}
                    title="Chuẩn bị hôm nay"
                    count={`${doneCount}/${items.length}`}
                    onClose={() => setOpen(false)}
                >
                    <ShiftPrepCard
                        packVerb="Lấy"
                        haveLabel="Tồn quầy đầu ca"
                        emptyTitle="Đủ hàng cho hôm nay!"
                        items={items}
                        checked={checked}
                        skipped={skipped}
                        onToggle={confirmPrep}
                        onSkip={toggleSkip}
                    />
                </NoticeSheet>
            )}
        </>
    )
}
