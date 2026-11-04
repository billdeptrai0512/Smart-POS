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
import BatchPrepList from './BatchPrepList'

// Dải notice "Chuẩn bị hôm nay" trên /pos — nằm trong Header, dưới thẻ Địa chỉ + Nhật ký (POSPage truyền vào prop notice).
// Luôn hiện (kể cả khi hết việc), số bên phải = số NVL đang chờ lấy từ kho dự trữ ra quầy (soạn sáng nay
// chưa xong, hoặc Lý thuyết ở quầy đã về 0 giữa ca); 0 thì không hiện số. Bấm → modal checklist, nhân viên
// xác nhận đã lấy ngay tại chỗ.
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
    const { items, batchItems, checked, skipped, pendingCount, ready, confirmPrep, toggleSkip, settle, toast } = usePrepNotice()
    const [open, setOpen] = useState(false)

    const total = items.length + batchItems.length
    const doneCount = total - pendingCount

    return (
        <>
            <NoticeBar
                icon={<CircleAlert size={15} className="text-primary shrink-0" />}
                label="Cần chuẩn bị"
                count={pendingCount} // số việc đang chờ lấy ra quầy; 0 → NoticeBar ẩn số, pill vẫn hiện
                onClick={ready ? () => setOpen(true) : undefined} // số từ ảnh chụp: chờ tính xong mới cho thao tác
            />
            <Toast toast={toast} />

            {open && (
                <NoticeSheet
                    icon={<CircleAlert size={18} className="text-primary shrink-0" />}
                    title="Cần chuẩn bị"
                    count={`${doneCount}/${total}`}
                    onClose={() => { setOpen(false); settle() }}
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
                    <BatchPrepList items={batchItems} />
                </NoticeSheet>
            )}
        </>
    )
}
