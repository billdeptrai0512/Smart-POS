# 🛠 Lộ trình triển khai Guest Mode (Local Sandbox)

### 1. Cấu trúc nền tảng (Foundation) — DONE
- [x] **AuthContext**: Hỗ trợ trạng thái `isGuest` + `initGuestMode()`.
- [x] **LocalRepository**: Helper CRUD trên `localStorage`.
- [x] **AddressContext**: Demo Address ảo cho guest, chặn write.
- [x] **LoginPage**: Nút "✨ Dùng thử miễn phí" opt-in guest mode.
- [x] **ProtectedRoute**: Cho phép `user || isGuest` đi qua.
- [x] **Cleanup**: `clearGuestData()` sau khi sign-up thành công.

### 2. Seeding từ Default Address — DONE
- [x] **Fix bug seeding rỗng**: Fetch Supabase TRƯỚC, seed localStorage, rồi mới flip `isGuest=true`. Đồng thời restore guest profile khi F5. — DONE
- [x] Fix bug /history không hiển thị chi tiết đơn hàng.
- [x] Fix bug guest mode không chốt ca được.
- [x] Fix bug guest mode không tương tác đổi giá nguyên liệu, nhập kho được
- [x] Fix tiền mặt và chuyển khoản và tồn kho của /shift-closing không đồng bộ với /daily-report trong guest mode.
- [x] redirect guest user về login page nếu họ bấm vào header tab bên trái địa chỉ thay vì redirect về /addresses

### 3. Guest UX
- [x] **GuestBanner**: Hiển thị sau đơn đầu tiên, CTA mời đăng ký.
- [x] **Ẩn tính năng mời nhân viên** khi `isGuest === true`.

---
# Kiến trúc Guest Mode (đã chốt)
- isGuest tương tác **100% với localStorage** — không write vào Supabase.
- Khi click "Dùng thử": fetch toàn bộ data từ **default address** (Supabase, `address_id IS NULL`) rồi copy vào `localStorage`.
- Cron job reset default address hàng ngày → mỗi guest session mới luôn có data sạch từ template.
- Sau khi đăng ký thành công → `clearGuestData()` xóa sạch sandbox.
