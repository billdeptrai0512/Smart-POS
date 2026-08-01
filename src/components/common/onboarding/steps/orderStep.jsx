import ChecklistRow from '../ChecklistRow'

// v5: bước 1 không còn đợi đơn "đã submit" — POS là 1-tap model (mỗi tap submit NGAY item
// đang giữ trước đó, xem POSContext's handleAddItem), nên "vừa làm xong việc thứ 2" và "đã
// submit việc thứ 2" lệch nhau đúng 1 tap, đọc như bug (tick 2/2 rồi mà chưa qua bước). Giờ
// done qua ctx.orderProgress (ghi trong localStorage bởi MenuGrid.jsx khi user GIỮ/chọn đúng
// món — xem onboardingStorage.js). Không có nút nav — user đã ở sẵn /pos khi thấy gợi ý này.
// Không đòi viewedHistory nữa — "xem nhật ký" là việc của journalStep kế tiếp, gộp vào đây
// chỉ khiến bước này kẹt ở 2/2 mà không rõ vì sao.
export default {
    name: 'Bấm tạo đơn',
    done: (ctx) => ctx.orderProgress.cafeSua && ctx.orderProgress.cacaoCaPheLon && ctx.orderProgress.matcha,
    Body: ({ ctx }) => (
        <>
            <ChecklistRow label="1 ly cà phê sữa" done={ctx.orderProgress.cafeSua} />
            <ChecklistRow label="1 ly cacao cà phê lớn" done={ctx.orderProgress.cacaoCaPheLon} />
            <ChecklistRow label="1 ly matcha cà phê" done={ctx.orderProgress.matcha} />
        </>
    ),
}
