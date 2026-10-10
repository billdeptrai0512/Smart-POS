// Tách khỏi DiscountTypePicker.tsx vì file component chỉ được export component
// (react-refresh/only-export-components) — DiscountProgramsPage cũng cần đọc nhãn kiểu
// giảm giá (tóm tắt trong danh sách) nên không thể khai cục bộ trong DiscountTypePicker.tsx.
export const DISCOUNT_TYPE_LABELS = { fixed: 'Đồng giá', percent: '% giảm', amount: 'Giảm số tiền' }
