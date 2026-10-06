import { useEffect, useMemo } from 'react'
import { shiftFinalizedKey } from '../constants/storageKeys'

// Ca hôm nay "hoàn tất" = phiếu chốt có thực thu (tiền mặt + chuyển khoản) VÀ mọi NVL đã đếm
// Cuối kỳ. Dùng chung /daily-report (nhập thực thu) và /ingredients tab Kiểm kê (đếm tồn):
// hoàn tất ở trang nào thì trang đó ghi cờ.
//
// Latch: một khi ca đã hoàn tất trong ngày thì KHÓA lại — forecast nhích lên do đơn muộn (hoặc
// thêm NVL mới) sẽ không "mở lại" ca nữa. Cờ lưu localStorage theo địa chỉ+ngày (đúng key
// HistoryPage đọc để phân loại "Sau ca"). Sang ngày mới → key mới → tự reset. Chỉ ghi LẦN ĐẦU
// đạt điều kiện, KHÔNG tự gỡ.
export function useShiftFinalized({ shiftClosing, isTodaysClosing, ingredientsList, isTodayScope, addressId, todayISO }) {
    const cashAndCountDone = useMemo(() => {
        if (!isTodaysClosing) return false
        if (shiftClosing.actual_cash == null || shiftClosing.actual_transfer == null) return false
        const report = shiftClosing.inventory_report
        if (!Array.isArray(report) || report.length === 0) return false
        const list = ingredientsList || []
        if (list.length === 0) return false
        const remainingByIng = {}
        for (const row of report) remainingByIng[row.ingredient] = row.remaining
        return list.every(ing => remainingByIng[ing.ingredient] != null)
    }, [isTodaysClosing, shiftClosing?.actual_cash, shiftClosing?.actual_transfer, shiftClosing?.inventory_report, ingredientsList])

    const finalizedKey = isTodayScope && addressId ? shiftFinalizedKey(addressId, todayISO) : null
    // Đọc cờ mỗi render (rẻ) thay vì giữ state: effect chỉ ghi, lần render kế đã thấy cờ.
    const latched = !!(finalizedKey && localStorage.getItem(finalizedKey))

    useEffect(() => {
        if (!finalizedKey || !cashAndCountDone || localStorage.getItem(finalizedKey)) return
        localStorage.setItem(finalizedKey, Date.now().toString())
    }, [cashAndCountDone, finalizedKey])

    return cashAndCountDone || latched
}
