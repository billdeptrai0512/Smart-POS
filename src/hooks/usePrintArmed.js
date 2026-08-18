import { useEffect, useRef, useState } from 'react'

// Chỉ 1 thẻ được mang id="print-bill" tại 1 thời điểm (CSS @media print chọn theo id) —
// bấm in mới gắn id cho ĐÚNG thẻ này (mount PrintBill), in xong gỡ luôn để thẻ kế bấm sau
// không bị dính id cũ. Dùng ở mọi nơi có NHIỀU PrintBill tiềm năng cùng lúc trên 1 màn
// (danh sách đơn trong Nhật ký, danh sách đơn mang đi) — mount thường trực ở mọi thẻ thì
// nhiều #print-bill cùng tồn tại, CSS in sẽ hiện chồng lên nhau.
export function usePrintArmed() {
    const billRef = useRef(null)
    const [printArmed, setPrintArmed] = useState(false)

    // setState ở đây là chủ đích: đây LÀ đích đến của effect (gỡ mount sau khi đã đồng bộ
    // với window.print(), một external API), không phải suy ra state từ props/state khác.
    useEffect(() => {
        if (!printArmed) return
        billRef.current?.print()
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPrintArmed(false)
    }, [printArmed])

    return { billRef, printArmed, arm: () => setPrintArmed(true) }
}
