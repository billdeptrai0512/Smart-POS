# Kế hoạch phát triển: Hỗ trợ nhiều ca chốt kho/chuyển tiền trong ngày

## 1. Thiết kế Database & API
- [ ] Loại bỏ ràng buộc duy nhất 1 ca mỗi ngày kinh doanh trên Supabase (`shift_closings` table/triggers).
- [ ] Chuyển các câu lệnh cập nhật và tạo ca từ logic gom ngày (`vn_business_date`) sang tạo mới (`INSERT`) mỗi khi chốt ca.
- [ ] Bổ sung trường định danh ca (ví dụ: `shift_name` - Ca Sáng, Ca Chiều, Ca Tối... hoặc `shift_number` để phân biệt thứ tự ca trong ngày).

## 2. Thay đổi Logic xác định ca trước (lấy Đầu kỳ)
- [ ] Thay đổi câu lệnh query lấy "yesterday's shift closing" thành tìm dòng chốt ca gần nhất overall, ngoại trừ chính ca đang thao tác:
  ```javascript
  const query = supabase
      .from('shift_closings')
      .select('id, closed_at, inventory_report')
      .eq('address_id', addressId)
      .order('closed_at', { ascending: false });

  if (currentShiftClosingId) {
      query.neq('id', currentShiftClosingId);
  }
  const { data: previousShift } = await query.limit(1).maybeSingle();
  ```
- [ ] Cập nhật hàm local fallback (Guest Mode) tương đương trong `localRepository.js` (`fetchLocalYesterdayShiftClosing` đổi thành `fetchLocalPreviousShiftClosing`).

## 3. Quản lý trạng thái Ca đang mở (Active Shift)
- [ ] Thao tác **"Mở ca mới"** trên UI: Tạo nút mở ca, sinh ra dòng chốt ca trạng thái "Đang hoạt động" (`cash_closed_at IS NULL`).
- [ ] Cập nhật `DailyReportPage.jsx` để tìm kiếm và bind UI với ca đang hoạt động gần nhất, thay vì bind tự động theo ngày `todayISO`.

## 4. Đồng bộ Realtime theo Ca
- [ ] Thay đổi kênh đăng ký Realtime trong `useShiftInventoryState.js` lắng nghe theo ID của ca: `shift-closing-db-${shiftId}` thay vì theo địa chỉ `addressId` để tránh xung đột dữ liệu giữa các ca khác nhau hoạt động cùng thời điểm.
