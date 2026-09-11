import { useState } from 'react'
import { ChefHat, Loader } from 'lucide-react'
import { useCart } from '../../contexts/CartContext'
import { useAddress } from '../../contexts/AddressContext'
import { nativePrinterIp } from '../../lib/escposBitmap'
import { printKitchenTicket } from '../common/KitchenTicket'
import { CHIP_IDLE } from '../common/ModalShell'

// In lại phiếu bếp cho 1 đợt/đơn (TableDetailModal, TakeawayListModal) — khi lần in tự động
// lúc tạo đơn bị lỗi (máy bếp tắt, rớt mạng) hoặc bếp làm mất phiếu. Phiếu mang tiêu đề
// "IN LẠI" để bếp không làm trùng món. Ẩn trên web / địa chỉ chưa cấu hình IP máy bếp.
export default function KitchenReprintButton({ round, tableName }) {
    const { showError } = useCart()
    const { selectedAddress } = useAddress()
    const [printing, setPrinting] = useState(false)
    const ip = nativePrinterIp(selectedAddress?.kitchen_printer_ip)
    if (!ip) return null

    async function reprint() {
        setPrinting(true)
        try {
            await printKitchenTicket(ip, { orderNo: round.orderNo, tableName, lines: round.lines, tag: 'IN LẠI' })
        } catch (err) {
            showError(err, 'In phiếu bếp')
        } finally {
            setPrinting(false)
        }
    }

    return (
        <button
            onClick={reprint}
            disabled={printing}
            aria-label="In lại phiếu bếp"
            className={`${CHIP_IDLE} shrink-0 w-[26px] flex items-center justify-center hover:text-primary disabled:opacity-50`}
        >
            {printing ? <Loader size={13} className="animate-spin" /> : <ChefHat size={13} strokeWidth={2.25} />}
        </button>
    )
}
