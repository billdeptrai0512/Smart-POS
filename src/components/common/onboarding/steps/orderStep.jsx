import ChecklistRow from '../ChecklistRow'

// v5: bước 1 không còn đợi đơn "đã submit" — POS là 1-tap model (mỗi tap submit NGAY item
// đang giữ trước đó, xem POSContext's handleAddItem), nên "vừa làm xong việc thứ 2" và "đã
// submit việc thứ 2" lệch nhau đúng 1 tap, đọc như bug (tick 2/2 rồi mà chưa qua bước). Giờ
// done qua ctx.orderProgress (ghi trong localStorage bởi MenuGrid.jsx khi user GIỮ/chọn đúng
// món — không đợi submit — và HistoryPage.jsx khi user ghé /history SAU KHI đã xong cả 2 món,
// xem onboardingStorage.js). Không có nút nav — user đã ở sẵn /pos khi thấy gợi ý này.
export default {
    name: 'Tạo đơn',
    done: (ctx) => ctx.orderProgress.cafeSuaLon && ctx.orderProgress.matcha && ctx.orderProgress.viewedHistory,
    Body: ({ ctx }) => (
        <>
            <ChecklistRow label="1 ly matcha cà phê" done={ctx.orderProgress.matcha} />
            <ChecklistRow label="1 ly cà phê sữa lớn" done={ctx.orderProgress.cafeSuaLon} />
            <ChecklistRow label="Xem nhật ký" done={ctx.orderProgress.viewedHistory} />
        </>
    ),
}
