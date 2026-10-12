import { useEffect, useState } from 'react'
import { fetchCashClosedToday } from '../services/reportService'

/** Đã chốt ca tiền hôm nay chưa — refetch mỗi lần `active` bật (vd. mở form Nhập kho) để luôn tươi:
 *  user có thể vừa chốt ở /report. Dùng để default phân loại dòng tiền (trước/sau chốt két). */
export function useCashClosedToday(addressId: Parameters<typeof fetchCashClosedToday>[0], active: boolean) {
    const [closed, setClosed] = useState(false)
    useEffect(() => {
        if (!active) return
        let alive = true
        fetchCashClosedToday(addressId).then(v => { if (alive) setClosed(!!v) })
        return () => { alive = false }
    }, [active, addressId])
    return closed
}
