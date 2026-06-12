# Phone Auth — Verify SĐT thật (Giai đoạn B của Phase 2)

> Nguồn chân lý cho việc xác thực số điện thoại. Bối cảnh & tracker tổng: `task.md` (Phase 2).
> Nghiên cứu 2026-06-11. Hướng chính: **Zalo Mini App** (0đ/lần verify). Fallback: Twilio OTP.

## Vấn đề

Giai đoạn A (đã xong) thu SĐT + bind trial 1-SĐT-1-lần, nhưng **không chứng minh được số là thật**
— user cố tình có thể bịa số đúng định dạng để lấy trial mới mỗi lần tạo tài khoản. Cần một
**bằng chứng sở hữu số từ bên đáng tin** trước khi mở đăng ký tự do (Phase 2 → public).

Hai cách có bằng chứng đó:
1. **Tự gửi OTP SMS** (Twilio/eSMS) — tốn tiền mỗi tin.
2. **Mượn kết quả verify của Zalo** — Zalo đã bắt user verify số bằng SMS nhà mạng từ lúc
   đăng ký tài khoản Zalo; mình chỉ xin lại số đó qua API. **0đ, không giới hạn volume.**

## Phát hiện quan trọng (đã verify bằng research 2026-06-11)

- **"Đăng nhập Zalo" trên web (Social API OAuth v4) KHÔNG trả SĐT** — chỉ `id / name / picture`.
  Không có scope phone cho web OAuth. → Làm nút "Login with Zalo" trên web KHÔNG giải được bài này.
- Đường duy nhất lấy SĐT verified: **Zalo Mini App** (app chạy trong Zalo) gọi API `getPhoneNumber`
  → user bấm "Cho phép" trong popup → mini app nhận `token` → server đổi token lấy số thật:
  `GET https://graph.zalo.me/v4.0/me/info` với headers `access_token`, `code` (=token), `secret_key`.
- `getPhoneNumber` không tốn phí per-call. Mini App có **môi trường Testing** (danh sách tester)
  chạy được TRƯỚC khi được duyệt → dev/test nội bộ không bị chặn bởi giấy tờ.

## Kiến trúc: Mini App "vệ tinh" chỉ để verify

Web app (React + Supabase) vẫn là app chính. Mini App chỉ làm đúng 1 việc: chứng thực SĐT.

```
Web (AccountCard, tab Staff) bấm "Xác thực qua Zalo"
  → RPC tạo phone_verify_sessions (code 1 lần, hết hạn 10 phút)
  → hiện QR / deeplink https://zalo.me/s/<MINI_APP_ID>/?session=CODE
User mở trong Zalo → mini app gọi getAccessToken() + getPhoneNumber() (popup đồng ý)
  → POST {session, access_token, token} → Edge Function zalo-phone-verify
Edge Function:
  1. Đổi token lấy SĐT thật qua graph.zalo.me/v4.0/me/info (secret_key từ env)
  2. Chuẩn hoá +84 (cùng quy tắc set_my_phone)
  3. Tìm user của session → ghi users.phone + phone_verified_at + chạy logic trial
     (RPC confirm_verified_phone — tái dùng ruột set_my_phone)
  4. Đánh dấu session = 'verified'
Web poll-while-pending session (tái dùng pattern usePaymentPoll) → verified
  → refreshProfile → hiện "Đã xác thực ✓"
```

Tái dùng được: Edge Function infra (đã có sepay-webhook), chuẩn hoá SĐT trong `set_my_phone`,
poll-while-pending, card Tài khoản (`AccountCard.jsx`).

## Checklist

### Việc của owner (giấy tờ + console Zalo — không code)
- [ ] eKYC tài khoản Zalo cá nhân (xác thực CCCD trong app Zalo).
- [ ] Tạo OA — Official Account (miễn phí).
- [ ] Xác thực OA: cần **GPKD hoặc đăng ký hộ kinh doanh + CCCD người đại diện** (duyệt ~3–5 ngày).
      ⚠️ Đây là điểm nghẽn duy nhất — chưa có hộ KD thì kẹt ở đây (xem Fallback).
- [ ] Tạo Mini App trên developers.zalo.me → liên kết + xác thực qua OA → xin quyền `getPhoneNumber`.
- [ ] Thêm số Zalo của mình + tester vào danh sách Testing.
- [ ] Đưa `ZALO_MINI_APP_ID` + `ZALO_APP_SECRET` vào Supabase secrets.
- [ ] (Khi public) Submit review mini app.

### Việc của Claude (code)
- [ ] Migration: bảng `phone_verify_sessions(code PK, user_id, status, phone, created_at, expires_at)`
      + cột `users.phone_verified_at` + RPC `confirm_verified_phone` (service_role; tái dùng
      chuẩn hoá + trial logic của `set_my_phone`).
- [ ] Edge Function `zalo-phone-verify`: nhận `{session, access_token, token}` → gọi
      graph.zalo.me đổi lấy SĐT → bind vào user của session → update session status.
- [ ] Mini App (zmp-sdk, React, ~1 màn hình): đọc `session` param → getPhoneNumber →
      POST Edge Function → màn hình "Thành công, quay lại app".
- [ ] Web UI trong `AccountCard`: nút "Xác thực qua Zalo" + QR/deeplink + poll session →
      badge "Đã xác thực ✓". Nhập tay giữ làm fallback.
- [ ] (Khi bật strict mode) Trigger trial chỉ cấp khi `phone_verified_at IS NOT NULL`.

## Fallback — Twilio OTP (nếu Zalo kẹt pháp nhân)

Không cần pháp nhân, bật được ngay:
- [ ] Supabase Dashboard → Authentication → Providers → Phone → điền Twilio Account SID +
      Auth Token + Messaging Service SID (đăng ký Twilio free, trial credit ~15 USD).
- [ ] Trial mode Twilio: chỉ gửi được tới số đã verify tay trong console → đủ cho nội bộ +
      3–5 quán quen (verify hộ số của họ). Public thì upgrade, ~1.200đ/SMS.
- [ ] Code: verify số đã nhập bằng `supabase.auth.updateUser({ phone })` + `verifyOtp`
      (type `phone_change`) → phone verified nằm trong `auth.users`, không đổi cách đăng nhập.
- [ ] Phase 4 (volume >100 OTP/tháng): migrate sang eSMS/Stringee (~600–800đ/tin) qua Edge Function.

## Quyết định & trạng thái

| Ngày | Quyết định |
|---|---|
| 2026-06-11 | Chọn hướng Zalo Mini App làm chính (0đ, UX tốt, mọi chủ quán có Zalo); Twilio làm fallback |
| 2026-06-11 | Web OAuth Zalo bị loại — không trả SĐT |
| — | ⏳ Chờ owner: xác nhận có hộ KD/GPKD chưa → quyết Zalo hay Twilio trước |

## Sources

- [getPhoneNumber docs](https://miniapp.zaloplatforms.com/docs/api/getPhoneNumber/)
- [Hướng dẫn xin quyền getPhoneNumber](https://miniapp.zaloplatforms.com/community/4820613498844301642/huong-dan-xin-cap-quyen-getphonenumber)
- [Xác thực Mini App qua OA](https://cnv.vn/xac-thuc-zalo-mini-app/)
- [Khởi tạo & xác thực Zalo Mini App](https://pandaloyalty.com/huong-dan-khoi-tao-va-xac-thuc-tren-zalo-mini-app/)
- [Social API v4](https://developers.zalo.me/docs/api/social-api-4)
- [Mini App như Identity Provider](https://mini.zalo.me/community/2227626431772432710/su-dung-zalo-mini-app-nhu-mot-identity-provider)
