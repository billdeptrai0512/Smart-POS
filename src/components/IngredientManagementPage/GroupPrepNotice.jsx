import { Boxes } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAddress } from '../../contexts/AddressContext'
import { useAuth } from '../../contexts/AuthContext'
import { useStats } from '../../contexts/StatsContext'
import NoticeBar from '../common/NoticeBar'

// Dải "Soạn kho nhóm" ở đỉnh /inventory → mở trang /inventory/group-prep (GroupPrepPage). Chỉ hiện khi địa chỉ đang
// chọn dùng chung kho tổng với địa chỉ khác, và chỉ cho chủ/quản lý (số liệu đọc đơn của cả các chi nhánh).
export default function GroupPrepNotice() {
    const navigate = useNavigate()
    const { isGuest, isManager, isAdmin } = useAuth()
    const { selectedAddress, siblingsByAddress } = useAddress()
    const { isOnline } = useStats()
    const siblings = selectedAddress ? siblingsByAddress[selectedAddress.id] : null
    if (!((isManager || isAdmin) && !isGuest && isOnline && siblings?.length)) return null
    return (
        <NoticeBar
            icon={<Boxes size={15} className="text-primary shrink-0" />}
            label="Soạn kho nhóm"
            onClick={() => navigate('/inventory/group-prep')}
        />
    )
}
