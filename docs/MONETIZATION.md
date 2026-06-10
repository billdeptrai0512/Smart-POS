# Monetization — System Design

Source of truth cho cách tính phí, gate feature, và xử lý thanh toán.
Mọi feature mới phải follow doc này thay vì nghĩ lại từ đầu.

---

## 1. Mô hình tính phí

> **🔄 ĐỔI MÔ HÌNH 2026-06-09: gộp về 1 gói all-access duy nhất.** Bỏ bán lẻ từng báo cáo,
> bỏ chu kỳ tháng/năm. Phần "2 module" bên dưới là lịch sử, KHÔNG còn áp dụng.

**Trục tính phí**: theo `address_id`. Một owner có nhiều xe (address) → mỗi xe 1 gói riêng.

### 1 gói all-access

**1 sản phẩm duy nhất.** Mua = mở khoá CẢ 3 view báo cáo:

| Tier (DB) | Tên hiển thị | Mở khoá |
|-----------|--------------|---------|
| `all`     | Trọn bộ báo cáo | Dòng tiền (`cashflow`) + Lợi nhuận (`profit`) + Tồn kho (`inventory`, gồm hao hụt) |

- **1 row `tier='all'`/address** = mở cả 3 view. Gate chỉ hỏi "address có sub active?" (`hasModule(activeModules, 'all')`), không phân biệt view.
- POS/chốt ca/kho/công thức luôn **free** (không gate); chỉ 3 view báo cáo bị gate.

### Bảng giá

| SKU | Giá | Chu kỳ |
|-----|----:|--------|
| 1 gói / 1 chi nhánh | **888,888đ** | **6 tháng** (`months=6`) |
| Nhiều chi nhánh | × số chi nhánh | 1 lần trả → 1 row/address |

- **Chỉ 1 mức giá, 1 chu kỳ 6 tháng.** Không tháng/năm, không bundle/chiết khấu, không bán lẻ module.
- **Multi-branch chỉ là tiện ích checkout**: 1 lần trả → tạo nhiều `address_subscriptions` row (1 row `'all'`/address). Entitlement check **per-address**.

**Không có "Free tier" vĩnh viễn cho báo cáo.** Sub hết hạn → cả 3 view khoá; POS/chốt ca/kho/công thức vẫn chạy.

### Trial

- **Trial tự động 7 ngày** (đổi 3→7 ngày 2026-06-09: cho chủ quán thấy đủ dữ liệu trước khi cam kết 6 tháng) — 1 row `'all'` ngay khi tạo địa chỉ đầu tiên.
- Không bind vào phone (Phase 1); sẽ bind phone ở Phase 2.
- Hết trial: 3 view rớt về khoá cho tới khi thanh toán.
- Chống abuse: phone OTP bắt buộc lúc signup (xem §3).

---

## 2. Feature Matrix

| Feature                                  | free | `cashflow` | `inventory` |
|------------------------------------------|:----:|:----------:|:-----------:|
| Tạo đơn, menu, recipe, nguyên liệu       |  ✓   |     ✓      |     ✓       |
| Chốt ca (shift closing)                  |  ✓   |     ✓      |     ✓       |
| Lịch sử đơn (HistoryPage)                |  ✓   |     ✓      |     ✓       |
| View **Dòng tiền** — CashFlowCard + SalesCard |  |     ✓      |             |
| View **Dòng tiền** — Day Performance Chart |    |     ✓      |             |
| View **Lợi nhuận** — FinanceCards / P&L / COGS |  |   ✓      |             |
| View **Tồn kho** — InventoryReportCard / Refill |  |          |     ✓       |
| View **Tồn kho** — Gợi ý đi chợ (Refill tab) |  |            |     ✓       |
| View **Tồn kho** — Audit tab + RangeLossCard (hao hụt) | |        |     ✓       |

Khi quyết định feature mới — xếp vào view nào thì thuộc module đó:
- Liên quan tiền mặt/thu chi/số ly bán **hoặc** lãi/lỗ/COGS/P&L → **`cashflow`** (Dòng tiền gộp luôn tài chính).
- Liên quan tồn/nhập/hao hụt/đi chợ → **`inventory`**.
- Tác vụ vận hành thiết yếu (không xem được dữ liệu sẽ không bán được hàng) → **free** (không gate).

---

## 3. Phone OTP (chống trial abuse)

**Bắt buộc** verify phone qua OTP khi signup. Bind trial vào phone — owner tạo
account mới hoặc address mới đều không nhận trial nếu phone đã từng nhận.

### Provider

| Phase | Provider | Cost / SMS | Khi nào dùng |
|---|---|---:|---|
| Khởi đầu | Twilio (native Supabase Auth) | ~1,200đ | Volume < 100 OTP/tháng |
| Khi scale | eSMS / Stringee qua Edge Function | ~600-800đ | Khi OTP volume > 100/tháng — saving ~50% |

Native Twilio dùng được ngay với `supabase.auth.signInWithOtp({ phone })`.
Khi cần migrate: viết Edge Function gửi OTP qua VN provider, generate token thủ công, lưu
vào bảng `phone_otp_codes` với TTL 5 phút.

### Schema

```sql
CREATE TABLE trial_grants (
    phone        TEXT PRIMARY KEY,           -- E.164 normalized: +84xxxxxxxxx
    address_id   UUID NOT NULL REFERENCES addresses(id),
    granted_at   TIMESTAMPTZ DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL        -- granted_at + 7 days
);

-- Mở rộng addresses: cần biết owner để check trial khi tạo address mới
ALTER TABLE addresses ADD COLUMN owner_phone TEXT;
CREATE INDEX idx_addresses_owner_phone ON addresses(owner_phone);
```

### Trial grant flow

```
User signup → verify OTP → INSERT auth.users với phone confirmed
  ↓
User tạo address đầu tiên
  ↓
RPC create_address():
    INSERT trial_grants(address_id, expires_at = now() + interval '3 days');
    INSERT address_subscriptions(tier='basic', valid_from=today, valid_to=today+3, amount_paid=0);
    INSERT address_subscriptions(tier='pro', valid_from=today, valid_to=today+3, amount_paid=0);
```

**Edge case**: user xoá address rồi tạo lại — `trial_grants.phone` đã tồn tại, không trial lại.

---

## 4. Schema

### Table: `address_subscriptions`

Mỗi record = 1 lần thanh toán → 1 khoảng hiệu lực.
Nhiều record / address để giữ history (audit, refund, gia hạn nối tiếp).

```sql
CREATE TABLE address_subscriptions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    address_id      UUID NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
    tier            TEXT NOT NULL CHECK (tier IN ('cashflow', 'inventory', 'finance')),
    valid_from      DATE NOT NULL,
    valid_to        DATE NOT NULL,
    months          INT  NOT NULL CHECK (months >= 1),
    amount_paid     INT  NOT NULL,
    payment_intent_id UUID REFERENCES payment_intents(id),
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_addr_sub_lookup ON address_subscriptions(address_id, valid_to DESC);
```

**Quy tắc gia hạn**: `valid_from = max(CURRENT_DATE, COALESCE(latest.valid_to, CURRENT_DATE - 1) + 1)`.
- Nếu trả trước khi hết hạn → nối tiếp ngay sau ngày hết hạn cũ (không mất ngày).
- Nếu trả sau khi hết hạn → tính từ hôm nay (không backfill quãng gap).

### Table: `payment_intents`

Generate ref code khi user click "Gia hạn"; webhook match bằng ref này.

```sql
CREATE TABLE payment_intents (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    address_id   UUID NOT NULL REFERENCES addresses(id),
    tier         TEXT NOT NULL CHECK (tier IN ('cashflow', 'inventory', 'finance')),
    months       INT  NOT NULL,
    amount       INT  NOT NULL,
    reference    TEXT NOT NULL UNIQUE,   -- vd: KP3F9A2C1
    status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','paid','expired','cancelled')),
    expires_at   TIMESTAMPTZ NOT NULL,   -- pending intent hết hạn sau 30 phút
    paid_at      TIMESTAMPTZ,
    sepay_tx_id  TEXT,
    created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_intent_ref ON payment_intents(reference) WHERE status = 'pending';
```

**Reference format**: `KP` + 8 ký tự base58 từ `id` của intent.
Ngắn (~10 ký tự), gõ tay được, không trùng lẫn 0/O, l/I.

---

## 5. Entitlement check

### RPC

```sql
CREATE OR REPLACE FUNCTION get_address_entitlement(p_address_id UUID)
RETURNS TABLE(tier TEXT, valid_to DATE)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
    SELECT tier, MAX(valid_to) as valid_to
    FROM address_subscriptions
    WHERE address_id = p_address_id
      AND valid_from <= CURRENT_DATE
      AND valid_to   >= CURRENT_DATE
    GROUP BY tier;
$$;
```

Trả NULL row khi không có sub active.

### Frontend hook

```js
// src/hooks/useEntitlement.js
export function useEntitlement() {
    const { selectedAddress } = useAddress();
    const [state, setState] = useState({ activeModules: [], validToByModule: {}, loading: true });

    useEffect(() => {
        if (!selectedAddress?.id) return;
        supabase.rpc('get_address_entitlement', { p_address_id: selectedAddress.id })
            .then(({ data }) => {
                const rows = Array.isArray(data) ? data : (data ? [data] : []);
                setState({
                    activeModules: rows.map(r => r.tier),
                    validToByModule: rows.reduce((acc, r) => ({ ...acc, [r.tier]: r.valid_to }), {}),
                    loading: false
                });
            });
    }, [selectedAddress?.id]);

    return state;
}

// activeModules giờ chính là danh sách module: ['cashflow','inventory','finance']
export function hasModule(activeModules, module) {
    return Array.isArray(activeModules) && activeModules.includes(module);
}
```

Component sử dụng — gate theo từng view:
```jsx
const { activeModules } = useEntitlement();
// view Dòng tiền
if (!hasModule(activeModules, 'cashflow')) return <UpsellGate required="cashflow" />;
// view Tồn kho (đã gồm hao hụt)
if (!hasModule(activeModules, 'inventory')) return <UpsellGate required="inventory" />;
// view Báo cáo
if (!hasModule(activeModules, 'finance')) return <UpsellGate required="finance" />;
```

---

## 6. UX khi bị gate

Hai entry point dẫn về **1 trang đăng ký gói duy nhất** (`/subscription`) — không sheet/modal rải rác:

### A. View lock (1 view trong trang báo cáo bị gate)
Trang báo cáo có 3 view (Dòng tiền / Tồn kho / Báo cáo) chọn qua `ReportViewFilter` ở footer.
Trang **luôn render** (footer + header navigation vẫn hoạt động) — chỉ phần thân của view chưa mua bị khoá:
- Khi view hiện tại chưa mua → DailyReportPage **early-return nguyên `<SubscriptionScreen>`** (full-screen, header back riêng, KHÔNG render header/footer báo cáo) → trải nghiệm subscription đồng nhất với route /subscription.
- `SubscriptionScreen` = chrome (back + tiêu đề "Đăng ký gói") + `<SubscriptionPanel>`. Preselect module bị khoá + chi nhánh đang xem.
- **Nút back theo ngữ cảnh vào**: từ badge (/addresses) → back `/addresses`; từ trong báo cáo → back `/pos`.
- Khoá **cả view kể cả hôm nay** (quyết định 2026-06-03: trial 3 ngày + guest đủ để xem thử). KHÔNG render dữ liệu thật → không leak preview.
- View đã mua render bình thường (đầy đủ chrome báo cáo + footer chuyển view).

### B. Status banner trên address card (AddressSelectPage)
`SubscriptionBadge` (render bằng `<span>`, KHÔNG `<button>` — tránh button lồng button trong card):

| Trạng thái | Hiển thị | Visual |
|---|---|---|
| Đủ 3 module, còn > 3 ngày | `Trọn bộ · còn 23 ngày` | text-dim |
| 1–2 module, còn > 3 ngày | `2/3 gói · còn 23 ngày` | text-dim |
| Có module ≤ 3 ngày | `2/3 gói · còn 2 ngày — Gia hạn` | text-warning |
| Không còn gói nào | `Mở khoá báo cáo` | text-primary, mời chào |

Click badge → `navigate('/subscription', { state: { preselectAddressId } })`.

### Trang `/subscription` (đích chung)
`src/pages/SubscriptionPage.jsx` — owner tự lắp gói:
1. **Chọn chi nhánh**: list address quản lý, multi-select + "Chọn tất cả" (→ all-branches).
2. **Chọn báo cáo**: 3 toggle module, chọn 1/2/3.
3. **Chu kỳ**: tháng / năm.
4. **Tính tiền**: 3 module → giá bundle; 1–2 → cộng lẻ; × số chi nhánh đã chọn.
5. **QR placeholder** (Phase 3 sẽ gắn QR + poll).

**Không** dùng: blur preview, pop-up nag, modal toàn màn hình lúc khởi động — gây nhiễu mà không clear.

---

## 7. Payment flow (SePay)

### Sequence

```
User click "Gia hạn"
  ↓
Frontend: supabase.rpc('create_payment_intent', { modules, months, scope })
  // modules: ['cashflow'] | ['cashflow','inventory','finance'] (bundle)
  // months: 1 | 12 ; scope: 'address' | 'all_branches'
  // server tính amount theo §1 (bundle/year/branch-count), trả 1 reference gộp
  ↓ INSERT payment_intents (+ child rows mỗi module/address) → return { reference, amount, qr_url, expires_at }
Frontend: show QR with content = reference + amount preset
  ↓
User scan QR via banking app → chuyển khoản
  ↓
Bank push notification → SePay
  ↓ POST /sepay-webhook (Edge Function)
Backend:
  1. Verify SePay signature
  2. Parse reference + amount khỏi nội dung CK
  3. SELECT payment_intent WHERE reference = ? AND status = 'pending'
  4. Validate amount = intent.amount (±1000đ tolerance)
  5. INSERT address_subscriptions với valid_from/to tính theo quy tắc gia hạn
  6. UPDATE payment_intents SET status='paid', sepay_tx_id, paid_at
  ↓
Frontend (POLL-WHILE-PENDING — xem §7.1): poll payment_intents 3–5s/lần
  CHỈ trong lúc có intent pending → thấy status='paid' → reload entitlement → unlock UI
```

### Webhook handler (Supabase Edge Function)

```ts
// supabase/functions/sepay-webhook/index.ts
serve(async (req) => {
    const sig = req.headers.get('Authorization');
    if (sig !== `Apikey ${Deno.env.get('SEPAY_API_KEY')}`) {
        return new Response('unauthorized', { status: 401 });
    }
    const { content, transferAmount, id: txId } = await req.json();
    const ref = extractReference(content);  // regex /KP[A-Za-z0-9]{8}/
    if (!ref) return new Response('no ref', { status: 200 });

    const { error } = await supabase.rpc('confirm_payment', {
        p_reference: ref,
        p_amount: transferAmount,
        p_sepay_tx_id: txId.toString()
    });
    return new Response(error ? error.message : 'ok',
                         { status: error ? 400 : 200 });
});
```

`confirm_payment` là 1 RPC atomic (function plpgsql) — kiểm intent, insert sub, update intent status trong cùng transaction để tránh double-credit.

### Edge cases

- **Webhook duplicate** (SePay retry): UNIQUE constraint trên `sepay_tx_id` → idempotent.
- **Amount sai** (user gõ thiếu/thừa): tolerance ±1000đ. Lệch lớn hơn → status='manual_review', không tự cộng sub.
- **Reference không match**: log + email admin. User có thể gửi screenshot CK.
- **Intent expired** (>30 phút) trước khi user CK: status = 'expired' bằng cron job. Webhook gặp expired ref → từ chối, gợi ý user tạo intent mới.
- **Webhook mất / mạng rớt giữa chừng** ⚠️ rủi ro nặng nhất (mất tiền thật): client không nhận được tín hiệu → kẹt. → bắt buộc có **poll-while-pending** (tự bắt kịp ở lần poll sau) + **admin reconciliation** (đối soát thủ công).
- **Race gia hạn** (2 webhook cùng address): tính `valid_from = max(today, latest.valid_to + 1)` phải nằm trong RPC với `SELECT … FOR UPDATE`.
- **Bundle/all-branches**: 1 lần CK ghi nhiều row (module × chi nhánh) phải **atomic** theo 1 intent — `confirm_payment` insert tất cả trong cùng transaction.

### 7.1 — Cơ chế chờ xác nhận: chọn **c + a** (quyết định 2026-06-06)

Khi bật payment (Phase 3) làm **c (backend) + a (poll-while-pending)**, KHÔNG dùng realtime cho payment.

- **c — Backend (bắt buộc, là phần "sản xuất" dữ liệu):** Edge Function `sepay-webhook` + RPC `confirm_payment` (atomic, idempotent) + RPC `create_payment_intent` + sinh QR VietQR. Listener/poll chỉ là phần "tiêu thụ" → vô nghĩa nếu thiếu c.
- **a — Frontend (poll-while-pending):** khi có `payment_intents.status='pending'` → poll 3–5s/lần, dừng khi `paid`/`expired`.

**Vì sao poll-while-pending, không phải realtime:**

| | Poll-while-pending (chọn) | Realtime (`postgres_changes`) |
|---|---|---|
| Mạnh | Đơn giản · scale ngang vô hạn (stateless) · **sống sót khi mất mạng** · không đụng quota realtime · qua mọi proxy | Tức thì <1s |
| Yếu | Trễ ≤5s (vô nghĩa vì CK ngân hàng đã mất 5–30s mới tới) | Quota ~500 conn (Pro) · RLS auth-check mỗi event × mỗi client · **mất event khi rớt** · bottleneck ở ~10k đồng thời |

Payment là sự kiện **tần suất thấp, thời lượng giới hạn** → 5s trễ không đáng; realtime mua lấy ~4s nhưng kéo theo mọi rủi ro scale + mất-event. Giữ realtime cho thứ cần tức thì thật (orders), không phải "đợi 1 cú chuyển khoản".

**Về 10.000 manager đồng thời:** logic DB/RPC chịu được (payment rời rạc, write nhẹ, idempotent). Nút thắt là **tầng chờ**: realtime KHÔNG đạt 10k (quota + per-event auth); poll-while-pending đạt vì stateless. Edge Function cần **transaction-mode pooler** để khỏi cạn connection khi burst.

**⚠️ Trạng thái hiện tại:** `src/hooks/usePaymentListener.js` (realtime) đang là **PLACEHOLDER** — sẽ **thay bằng poll-while-pending** khi làm c. Đừng coi realtime listener là bản production.

### 7.2 — Quyết định HIỆN TẠI: chưa build c (2026-06-06)

**Chưa làm c bây giờ.** Lý do:
1. **Timing (§9 rollout gate):** payment chỉ bật ở Phase 2–3, sau core ổn ≥6 tuần + ≥1 tín hiệu validation. Build webhook bây giờ = hạ tầng nằm chờ hàng tháng.
2. **Không test/deploy được:** SePay cần tài khoản + API key + đăng ký webhook URL + deploy Edge Function — phụ thuộc creds & thao tác của owner; viết "mù" dễ lệch khi SePay đổi format.
3. **Tránh tối ưu non:** soft-launch (vài chục → vài trăm quán) thì cơ chế hiện tại dư sức; chưa cần đụng 10k.

**Việc rẻ-mà-cứu-rủi-ro nên làm TRƯỚC public (không phải c):**
- **Server-side kill switch** đọc `app_config` (flip không cần redeploy) — hiện kill switch là build-time env client.
- **Admin reconciliation** (đối soát thủ công) — cứu edge case webhook mất = mất tiền thật.

→ Tóm lại: commit nền tảng đã có; để **c + a** lại đúng thời điểm Phase 3.

---

## 8. Decisions

| # | Quyết định | Note |
|---|---|---|
| 1 | **2 module** (`cashflow`/`inventory`), không còn tier basic/pro. Gộp 2026-06-06: Báo cáo/Lợi nhuận vào `cashflow` | Hao hụt ở `inventory`; `cashflow` mở cả view Dòng tiền + Lợi nhuận |
| 2 | **Trial 3 ngày full 2 module** (Phase 1 bind user; Phase 2 bind phone — 1 phone = 1 trial) | Owner tạo address #2 không nhận lại trial (sau khi có phone) |
| 3 | **Năm = 888,888đ/module (~10 tháng)**; **Trọn bộ 2** = 166,888đ/th · 1,666,888đ/năm | Chiết khấu trọn bộ; năm tặng ~2 tháng |
| 4 | **All-branches = nhân theo số chi nhánh**, không giảm theo số lượng | Tạo row cho mọi address trong 1 lần trả |
| 5 | **Không refund, không prorating** | Đơn giản v1 |
| 6 | **Gia hạn nối tiếp** theo module (§4); module độc lập, không có quan hệ upgrade/downgrade | Mỗi module có valid_to riêng |
| 7 | **Status banner ở address card** (xem §6.B) — không banner header trên main app | KH thấy ngay từ Address Select |
| 8 | **Admin override**: RPC `admin_set_subscription(address_id, module, valid_to)` + UI admin | v1 cần cho support thủ công |
| 9 | **Mặc định OFF** — global flag (§9). Build infra trước, bật khi đủ signal | Tránh charge user khi chưa đủ ổn |
| 10 | **Chờ xác nhận thanh toán = poll-while-pending**, KHÔNG realtime (§7.1) | Scale tới 10k, sống sót mất mạng; realtime listener hiện tại chỉ là placeholder |
| 11 | **Chưa build payment backend (c) lúc này** (§7.2) | Để Phase 3; trước public chỉ cần server-side kill switch + admin reconciliation |

---

## 9. Feature flag (rollout control)

Monetization được wrap trong 1 **global kill switch**. Mặc định **OFF** trong toàn bộ
giai đoạn build + soft testing. Khi ON, toàn bộ logic gate/trial/payment kích hoạt.

### Behavior

| Flag | `useEntitlement()` trả về | UI behavior |
|---|---|---|
| **OFF** (mặc định) | `activeModules: ['cashflow','inventory','finance']` cho mọi address | Mọi view mở; không render UpsellGate/Sheet/banner; payment flow ẩn |
| **ON** | Query DB như bình thường | Đầy đủ gate + trial + payment |

Mục tiêu: dev/test feature trong môi trường giả lập "ai cũng Pro" — không cần CK,
không cần OTP signup mỗi lần test. Khi flip ON, **chỉ thay đổi entitlement source**,
không đụng feature code.

### Implementation

> ✅ **Đã implement (2026-06-09):** `useMonetizationEnabled()` trong `src/hooks/useEntitlement.js` —
> hiệu lực = client(build `VITE_MONETIZATION_ENABLED`) **AND** server(`app_config.monetization_enabled`,
> đọc runtime, cache module-level 1 request). Mọi consumer (DailyReportPage gate, SubscriptionBadge,
> SubscriptionPage route, usePaymentListener) dùng `enabled` runtime → flip `app_config` là đổi cả UI,
> **không cần redeploy**. Lỗi đọc config → fail-open OFF (không gate nhầm khách đã trả).
> Còn lại cho Phase 3: RPC `confirm_payment` cũng phải check `app_config` đầu function.

**Client** — env var build-time:
```sh
# .env.production / .env.local
VITE_MONETIZATION_ENABLED=false
```

```js
// src/hooks/useEntitlement.js
const ENABLED = import.meta.env.VITE_MONETIZATION_ENABLED === 'true';

export function useEntitlement() {
    if (!ENABLED) {
        return { activeModules: ['cashflow','inventory','finance'], loading: false };
    }
    // ... real query get_address_entitlement → activeModules = các module còn hạn
}
```

**Server** — DB config row (để admin flip không cần redeploy):
```sql
CREATE TABLE app_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
INSERT INTO app_config(key, value) VALUES ('monetization_enabled', 'false');
```

RPC `confirm_payment` check `app_config` đầu function — nếu OFF, từ chối với
message "Monetization chưa được kích hoạt". Tránh data rác từ test webhook lẫn vào prod.

### Rollout phases

| Phase | Client flag | Server flag | Whitelist | Mô tả |
|---|---|---|---|---|
| **0 — Dev** (giờ) | OFF | OFF | — | Build infra, không charge ai |
| **1 — Internal test** | ON | OFF | Owner's addresses | Owner test full flow với CK giả/admin override; webhook tắt |
| **2 — Soft launch** | ON | ON | 3-5 trusted quán (admin grant Pro manual) | Thu phí thực, hỗ trợ thủ công, payment webhook live |
| **3 — Public** | ON | ON | Toàn bộ | Mở tự đăng ký, marketing |

Flip phase = đổi 1 env var (client) + 1 row trong `app_config` (server). Rollback nếu cần.

### Signals để flip

Phase 0 → 1: Implementation step 1-11 xong, owner test sub flow OK end-to-end.

Phase 1 → 2: hit các signal ở "Khi nào charge" — core stable ≥ 6 tuần + 1 trong 3 validation signals (retention / WOM / demand pull).

Phase 2 → 3: soft launch ≥ 1 tháng, conversion ≥ 50% trial→paid, churn < 20%/tháng.

---

## 10. Implementation order & Tracker

Hoàn toàn khả thi để bắt đầu làm Feature Flag, Schema, Trial grant và UI Gate trước. Lúc này, do chưa có Phone OTP, việc cấp trial có thể tạm móc vào user ID hiện tại (sẽ refactor ở Phase 2). Hướng tiếp cận này giúp hoàn thiện được UX/UI và ra mắt nội bộ sớm.

**Quy tắc cho Agent:** Đánh dấu `[x]` vào các task đã hoàn thành và commit cập nhật tài liệu này để các agent sau có thể tiếp nối dễ dàng.

### Phase 1: Core Foundation & UI Gates
*Mục tiêu: Xây dựng nền tảng DB, cấp quyền (dùng auth hiện tại tạm thời) và hoàn thiện các UI blocks.*

- [x] **Bước 1 (Feature flag):** Thiết lập env var `VITE_MONETIZATION_ENABLED`, tạo table `app_config`, và thêm bypass logic mặc định OFF cho toàn app.
  - `.env` → `VITE_MONETIZATION_ENABLED=false`
  - `src/hooks/useEntitlement.js` → bypass: khi OFF trả `{ tier: 'pro', validTo: '2099-12-31', loading: false, enabled: false }`
  - Migration: `supabase/migrations/20260511_monetization_phase1.sql`

- [x] **Bước 2 (Schema DB):** Tạo bảng `trial_grants`, `address_subscriptions`, `payment_intents` và RPC `get_address_entitlement`.
  - File: `supabase/migrations/20260511_monetization_phase1.sql`
  - RLS đã setup cho cả 4 bảng mới

- [x] **Bước 3 (Trial grant & Hook):** Custom hook `useEntitlement` + helper `hasFeature` đã hoàn thiện.
  - File: `src/hooks/useEntitlement.js`
  - ⚠️ Trial grant RPC `create_address` chưa implement (cần Phase 2 — Phone OTP) — sẽ cấp trial thủ công qua `admin_set_subscription` ở Phase 3

- [x] **Bước 4 (Gate Components):** Xây dựng component dùng chung: `<UpsellPage>` (full-screen) và `<UpsellSheet>` (bottom sheet).
  - `src/components/common/UpsellPage.jsx` — full-screen gate, hỗ trợ `required='basic'|'pro'`
  - `src/components/common/UpsellSheet.jsx` — bottom sheet gate, animate slide-up
  - CTA thanh toán là placeholder; sẽ connect Phase 3 (QR + SePay)

- [x] **Bước 5 (Gate Pages & Cards):**
  - `DailyReportPage` → gate toàn trang bằng `<UpsellPage required="basic">` khi `tier=null`
  - `RangeReportPage` → gate toàn trang tương tự; `RangeLossCard` bị ẩn/khóa khi `tier=basic` (Pro-only card placeholder)
  - `InventoryRefillCard` → audit tab bị khóa khi `tier=basic`; click → `<UpsellSheet required="pro">`
  - Prop `canAccessAudit` truyền từ DailyReportPage xuống InventoryRefillCard

- [x] **Bước 6 (Status Banner):** Hiển thị Banner trạng thái gói cước ở AddressSelectPage.
  - `src/components/AddressSelectPage/SubscriptionBadge.jsx` — badge per-address
  - Tích hợp vào `BranchGrid.jsx`; click → `<UpsellSheet>` mở tại AddressSelectPage
  - Khi `MONETIZATION_ENABLED=false` → badge hoàn toàn ẩn (zero render)

**⚠️ Phase 1 đã build theo mô hình CŨ (basic/pro).** Mô hình đổi sang **3 module độc lập** (2026-06-03) — cần rework. Code cũ vẫn chạy (flag OFF), nhưng giá trị `tier`, FEATURE_MATRIX, gate UI phải đổi.

### Phase 1b: Rework sang 3-module (2026-06-03)
*Mục tiêu: chuyển basic/pro → cashflow/inventory/finance. Flag vẫn OFF, không charge ai.*

- [x] **Bước R1 (Hook):** `useEntitlement` → export `MODULES` + `hasModule(activeModules, module)`; OFF **hoặc guest mode** trả đủ `['cashflow','inventory','finance']`. `hasFeature` giữ làm shim deprecated cho tới R3. (`src/hooks/useEntitlement.js`)
- [x] **Bước R2 (Migration):** `supabase/migrations/20260603_monetization_three_modules.sql` — drop CHECK basic/pro, convert legacy (pro→inventory, basic→split 3 row), add CHECK `tier IN ('cashflow','inventory','finance')` cho cả 2 bảng, refresh `get_address_entitlement`. Cột vẫn tên `tier` (lưu giá trị module).
- [x] **Bước R3 (Gate per-view):** `DailyReportPage` — bỏ gate toàn trang; gate từng view (cashflow/inventory/finance) bằng `<UpsellGate>`. Trang + footer luôn render. Chốt: **khoá cả view kể cả hôm nay** (trial 3–7 ngày + guest cho xem full). Khi loading entitlement → coi như có quyền (tránh nháy gate).
- [x] **Bước R4 (UI mở khoá thống nhất):** `SubscriptionScreen.jsx` (chrome full-screen, **header style /history**: back bo góc + chip "Đăng ký gói" + thanh tab = **chu kỳ Theo tháng/Theo năm**; giữ `period` state, truyền xuống panel controlled) + `SubscriptionPanel.jsx` (thân: chi nhánh multi-select + 3 toggle module + QR + tính tiền bundle/lẻ × số CN + admin mock). Route `/subscription` và tab báo cáo bị khoá đều render `SubscriptionScreen` → một UI duy nhất. Giá ở `src/constants/monetization.js`. 🗑️ Bỏ hẳn `UpsellGate.jsx` + `UpsellSheet.jsx` + `UpsellPage.jsx`.
- [x] **Bước R5 (Hao hụt → inventory):** Bỏ `canAccessAudit`/`required="pro"`; audit + RangeLossCard mở khoá cùng quyền `inventory` (view inventory đã gate sẵn → tới được card là đã có quyền).
- [x] **Bước R6 (Trang đăng ký gói duy nhất + Banner):** Gom mọi luồng mở khoá về **1 trang `/subscription`** (`src/pages/SubscriptionPage.jsx`) thay vì bottom-sheet rải rác.
  - Trang: danh sách chi nhánh user quản lý (multi-select + "Chọn tất cả") · 3 toggle module (chọn 1/2/3) · toggle tháng/năm · QR placeholder · tính tiền (3 module = giá bundle, <3 = cộng lẻ) × số chi nhánh · admin mock insert.
  - `SubscriptionBadge`: rework sang module (`Trọn bộ` / `N/3 gói` / `Mở khoá báo cáo`), **sửa bug `<button>` lồng `<button>`** → đổi sang `<span role=button>`. Click → `/subscription`.
  - Badge → `navigate('/subscription', { state })`; tab Báo cáo bị khoá → nhúng thẳng `<SubscriptionPanel>` (không điều hướng, cùng UI).
  - 🗑️ Xoá `UpsellGate.jsx` + `UpsellSheet.jsx` + `UpsellPage.jsx` (dead). Gỡ audit-upsell trong `InventoryRefillCard`.

**⚡ Trạng thái Phase 1b: HOÀN THÀNH** — gate per-view + trang đăng ký gói thống nhất, verify OK trên main:5173 (flag ON). Thanh toán QR/SePay vẫn placeholder (Phase 3).

### Phase 1c: Gộp 3 → 2 module (2026-06-06)
*Gộp Báo cáo/Lợi nhuận (finance) vào Dòng tiền (cashflow). Còn 2 sản phẩm bán.*

- [x] **Migration** `supabase/migrations/20260606_monetization_two_modules.sql` — trigger trial cấp 2 module, gộp `finance→cashflow`, CHECK còn `('cashflow','inventory')` cho cả 2 bảng.
- [x] `constants/monetization.js` — `MODULE_KEYS=['cashflow','inventory']`; `cashflow` meta gộp tài chính; `PRICE.bundle = 166,888đ/th · 1,666,888đ/năm`.
- [x] `useEntitlement.MODULES` → 2 module. `DailyReportPage` — view Lợi nhuận (profit) gate bằng quyền `cashflow`.
- [x] `SubscriptionPanel` — lưới **2 cột**, bundle khi chọn đủ 2 (`moduleCount===MODULE_KEYS.length`). `SubscriptionBadge` → `Trọn bộ`/`1/2 gói`.
- [x] Realtime listener (`usePaymentListener`) + migration `20260603_realtime_address_subscriptions.sql` (Phase 3 / Bước 10 — frontend phần). ⚠️ là **placeholder**, sẽ thay bằng poll-while-pending (xem §7.1).

### Phase 2: Phone OTP (chống trial abuse)


- [ ] **Bước 7 (Phone OTP):** Setup Twilio + Supabase Phone Auth. Chuyển đổi signup sang xác thực SĐT.
- [ ] **Bước 8 (Bind Trial to Phone):** Cập nhật lại logic `create_address` ở Bước 3 để bind trial chặt vào `phone` thay vì account (đảm bảo 1 SĐT = 1 trial duy nhất).

### Phase 3: Payment Automation (SePay) & Admin
*Mục tiêu: Tự động hóa thanh toán, gia hạn, và công cụ quản trị tay.*

- [ ] **Bước 9 (Webhook):** Setup SePay Edge Function webhook + RPC `confirm_payment` atomic (nhớ logic check `app_config` để an toàn test).
- [~] **Bước 10 (QR & Realtime):**
  - [x] **Frontend listener** xong: `src/hooks/usePaymentListener.js` — Realtime sub `address_subscriptions` INSERT cho các chi nhánh của owner; nhúng vào `SubscriptionPanel` khi render (trạng thái "đang chờ" + "đã nhận → mở khoá").
  - [x] Migration `20260603_realtime_address_subscriptions.sql` — bật Realtime publication + REPLICA IDENTITY FULL cho bảng.
  - [ ] Sinh **QR động** (VietQR) encode `reference` + amount sau khi tạo `payment_intent`.
  - [ ] (Tuỳ chọn) fallback polling nếu Realtime rớt.
- [~] **Bước 11 (Admin Control):** RPC `admin_set_subscription` + mở khoá thủ công.
  - [x] RPC `admin_set_subscription(p_address_ids[], p_modules[], p_months, p_amount_paid, p_note)` — SECURITY DEFINER, guard `is_admin_auth`, quy tắc gia hạn nối tiếp (§4), all-or-nothing. Migration `20260608_admin_set_subscription.sql`.
  - [x] RPC `admin_reset_subscription(p_address_ids[], p_modules[]=NULL)` — xoá sub để dev/test lại flow gate (cùng migration). `p_modules=NULL` → xoá hết module.
  - [x] `SubscriptionPanel` (chỉ admin): nút "Mock mở khoá" gọi `admin_set_subscription` (thay client insert vào bảng chỉ có RLS SELECT) + nút "Reset gói" gọi `admin_reset_subscription`.
  - [ ] Trang dashboard đối soát (list `payment_intents` pending vs sao kê) — hoãn tới Phase 3 vì chưa có webhook thì bảng intent luôn rỗng.

### Phase 4: Optimization
*Mục tiêu: Tối ưu chi phí khi có lượng người dùng lớn.*

- [ ] **Bước 12 (Migrate OTP Provider):** Chuyển từ Twilio sang eSMS/Stringee qua Edge Function khi OTP volume vượt mốc cần tối ưu.

---

*Cập nhật lần đầu: 2026-05-10. Sửa lớn 2026-06-03: tier basic/pro → 3 module độc lập (cashflow/inventory/finance) + giá năm + bundle + all-branches. Sửa khi mô hình thay đổi — KHÔNG để doc này lệch với code.*
