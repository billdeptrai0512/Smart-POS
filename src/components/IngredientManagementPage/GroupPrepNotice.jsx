import { Boxes } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAddress } from '../../contexts/AddressContext'
import { useAuth } from '../../contexts/AuthContext'
import { useStats } from '../../contexts/StatsContext'
import NoticeBar from '../common/NoticeBar'

// Dải "Chia hàng cho chi nhánh" ở đỉnh /inventory → mở trang /inventory/group-prep (GroupPrepPage). Chỉ hiện ở KHO TỔNG của nhóm
// (hoặc nhóm chưa đặt kho tổng — hành vi cũ), và chỉ cho chủ/quản lý (số liệu đọc đơn của cả các chi nhánh).
export default function GroupPrepNotice() {
    const navigate = useNavigate()
    const { isGuest, isManager, isAdmin } = useAuth()
    const { selectedAddress, siblingsByAddress, warehouseRole } = useAddress()
    const { isOnline } = useStats()
    const siblings = selectedAddress ? siblingsByAddress[selectedAddress.id] : null
    const canDistribute = warehouseRole === 'hub' || warehouseRole === 'nohub'
    if (!((isManager || isAdmin) && !isGuest && isOnline && canDistribute && siblings?.length)) return null
    return (
        <NoticeBar
            icon={<Boxes size={15} className="text-primary shrink-0" />}
            label="Chia hàng cho chi nhánh"
            onClick={() => navigate('/inventory/group-prep')}
        />
    )
}
