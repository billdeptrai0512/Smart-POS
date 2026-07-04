# Error Tracking — theo dõi lỗi của user thật

## Vấn đề

Hiện tại lỗi chỉ `console.error` (xem [useToast.js](../src/hooks/useToast.js) → `showError`).
Mình **chỉ thấy được khi tự cắm máy hoặc mở tunnel**. User thật (iOS/Android ngoài quán)
gặp lỗi → mình mù hoàn toàn. Vụ `[Lưu giá tùy chọn] 401` vừa rồi là ví dụ: nếu không
mở tunnel thì không bao giờ biết.

Cần: lỗi ở máy user tự động bắn về 1 dashboard mình xem được.

---

## Đề xuất: Sentry (free tier)

Chuẩn công nghiệp cho web/React. Được cái mình cần mà tự làm thì tốn:
- **Stack trace + source map** → thấy đúng dòng code lỗi (không phải mã minified).
- **Breadcrumbs** → chuỗi thao tác dẫn tới lỗi (bấm gì, gọi API nào trước khi crash).
- **Gom nhóm** lỗi giống nhau + đếm số user dính, thay vì 500 dòng log rời rạc.
- **Ngữ cảnh**: máy gì, iOS/Android version, đường mạng, user nào.

### Free tier là gì?

"Free tier" = gói miễn phí vĩnh viễn (không phải bản dùng thử hết hạn), giới hạn theo
**hạn ngạch tháng**. Vượt hạn ngạch thì lỗi mới bị **bỏ (drop)**, không tính tiền, không
khoá tài khoản. Đủ xài cho quán nhỏ.

Gói **Developer (free)** của Sentry, ước lượng (số có thể đổi — check
https://sentry.io/pricing/ trước khi làm):
- ~**5.000 lỗi / tháng**
- **1 thành viên** (1 mình bạn)
- **30 ngày** lưu lịch sử
- **Không cần thẻ tín dụng**

Với lượng user hiện tại, 5.000 lỗi/tháng dư sức. Nếu 1 bug spam quá hạn ngạch → dùng
**rate-limit / filter** ngay trong SDK để chặn (xem phần dưới).

---

## Đã ráp xong (bản đang chạy)

DSN của Sentry **không phải secret** (nó nằm trong bundle client, ai cũng xem được), nên
hardcode thẳng, **không cần** set env var trên Vercel.

1. `npm i @sentry/react`
2. Init trong [main.jsx](../src/main.jsx) — **chỉ bật ở production** để dev/tunnel không
   bắn lỗi giả lên dashboard:
   ```js
   if (import.meta.env.PROD) {
     Sentry.init({
       dsn: '...',                   // hardcode, public-safe
       tracesSampleRate: 0,          // tắt performance — chỉ cần lỗi, tiết kiệm hạn ngạch
       release: __APP_UPDATE_LOG__,  // commit mới nhất, có sẵn trong vite.config.js
     })
   }
   ```
3. Móc vào chỗ lỗi đã tập trung sẵn — [useToast.js](../src/hooks/useToast.js) `showError`:
   ```js
   Sentry.captureException(err, { tags: { action: actionLabel } })
   ```
   → mọi lỗi thao tác (lưu giá, chốt ca, nhập kho...) tự có tag `action` để lọc.

### Việc BẠN cần làm

- **Không có gì thêm.** Chỉ cần merge + deploy. Sau khi deploy, gây thử 1 lỗi trên
  production → mở dashboard Sentry xem có nhảy về không.

### Có thể thêm sau (chưa làm, chưa cần)

- **Source map**: thêm `@sentry/vite-plugin` để stack trace hiện đúng dòng code gốc thay
  vì bản minified. Chưa có thì vẫn thấy lỗi, chỉ khó đọc hơn.
- **`Sentry.ErrorBoundary`** bọc `<App/>`: bắt crash React (màn hình trắng) + hiện
  fallback thay vì trắng bóc. Hiện `Sentry.init` đã tự bắt lỗi global + promise rớt,
  nên cái này chủ yếu để có UI dự phòng.

---

## Phương án lười hơn (nếu không muốn thêm vendor)

Mình **đã có Supabase** → log lỗi vào 1 bảng `error_logs` ngay trong `showError`
(insert `{ action, message, path, user_id, created_at }`). Zero dependency mới.

Đổi lại **mất**: source map, gom nhóm, breadcrumbs, cảnh báo — tự xây lại hết thì
không đáng. **Chỉ chọn cái này nếu** ngại phụ thuộc bên thứ 3 và chấp nhận xem lỗi
thô bằng SQL. Với nhu cầu "biết user gặp lỗi gì" thì **Sentry đáng hơn**.

---

## Chốt

| | Sentry free | Supabase table |
|---|---|---|
| Công sức | ~15 dòng + 1 dep | ~10 dòng, 1 migration |
| Chất lượng | stack/nhóm/breadcrumb/alert | log thô, tự query |
| Vendor mới | có | không |
| Hạn ngạch | ~5k lỗi/tháng | vô hạn (tốn DB) |

**Đã chọn: Sentry free.** Code đã ráp xong (mục "Đã ráp xong"). Việc còn lại chỉ là
merge + deploy rồi kiểm tra dashboard.
