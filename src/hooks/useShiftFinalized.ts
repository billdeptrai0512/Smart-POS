import { useEffect, useMemo } from 'react'
import { shiftFinalizedKey } from '../constants/storageKeys'
import type { Row } from '../types/domain'

// Ca hôm nay "hoàn tất" = phiếu chốt có thực thu (tiền mặt + chuyển khoản) VÀ mọi NVL đã đếm
// Cuối kỳ. Dùng chung /report (nhập thực thu) và /inventory tab Kiểm kê (đếm tồn):
// hoàn tất ở trang nào thì trang đó ghi cờ.
//
// Latch: một khi ca đã hoàn tất trong ngày thì KHÓA lại — forecast nhích lên do đơn muộn (hoặc
// thêm NVL mới) sẽ không "mở lại" ca nữa. Cờ lưu localStorage theo địa chỉ+ngày (đúng key
// HistoryPage đọc để phân loại "Sau ca"). Sang ngày mới → key mới → tự reset. Chỉ ghi LẦN ĐẦU
// đạt điều kiện, KHÔNG tự gỡ.
export function useShiftFinalized({ shiftClosing, isTodaysClosing, ingredientsList, isTodayScope, addressId, todayISO }: {
    shiftClosing?: Row | null; isTodaysClosing: boolean; ingredientsList?: Row[] | null; isTodayScope: boolean; addressId?: string | null; todayISO: string
}) {
    const actualCash = shiftClosing?.actual_cash, actualTransfer = shiftClosing?.actual_transfer, report = shiftClosing?.inventory_report
    const cashAndCountDone = useMemo(() => {
        if (!isTodaysClosing) return false
        if (actualCash == null || actualTransfer == null) return false
        if (!Array.isArray(report) || report.length === 0) return false
        const list = ingredientsList || []
        if (list.length === 0) return false
        const remainingByIng: Record<string, number | null> = {}
        for (const row of report) remainingByIng[row.ingredient] = row.remaining
        return list.every(ing => remainingByIng[ing.ingredient] != null)
    }, [isTodaysClosing, actualCash, actualTransfer, report, ingredientsList])

    const finalizedKey = isTodayScope && addressId ? shiftFinalizedKey(addressId, todayISO) : null
    // Đọc cờ mỗi render (rẻ) thay vì giữ state: effect chỉ ghi, lần render kế đã thấy cờ.
    const latched = !!(finalizedKey && localStorage.getItem(finalizedKey))

    useEffect(() => {
        if (!finalizedKey || !cashAndCountDone || localStorage.getItem(finalizedKey)) return
        localStorage.setItem(finalizedKey, Date.now().toString())
    }, [cashAndCountDone, finalizedKey])

    return cashAndCountDone || latched
}
