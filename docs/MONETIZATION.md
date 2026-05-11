# Monetization — System Design

Source of truth cho cách tính phí, gate feature, và xử lý thanh toán.
Mọi feature mới phải follow doc này thay vì nghĩ lại từ đầu.

---

## 1. Mô hình tính phí

**Trục tính phí**: theo `address_id` × tháng × tier.
Một owner có nhiều xe (address) → mỗi xe trả phí riêng biệt.

### Tiers

| Tier   | Giá / address / tháng | Bao gồm                                                          |
|--------|----------------------:|------------------------------------------------------------------|
| `null` | 0đ                    | POS + Shift closing (luôn hoạt động — kể cả khi quá hạn)         |
| basic  | 88,888đ               | + Báo cáo: dòng tiền, tài chính, P&L, biểu đồ — KHÔNG có thất thoát |
| pro    | 177,776đ              | + Module thất thoát (daily/range)                                |

**Pro = Basic + Addon thất thoát.** Không thể mua Addon mà không có Basic.
Trong DB lưu duy nhất `tier ∈ ('basic','pro')` cho gọn — Pro implies Basic.

**Không có "Free tier" vĩnh viễn.** Khi sub hết hạn, app rớt về `tier = null` —
mọi báo cáo bị khoá nhưng POS/chốt ca vẫn chạy (đảm bảo không gián đoạn vận hành).

### Trial

- **Mỗi phone (verified OTP) = 1 trial lifetime** = 7 ngày Pro miễn phí.
- Trial gắn vào address ĐẦU TIÊN owner tạo. Address thứ 2 trở đi của cùng owner: full price ngay.
- Hết trial: app rớt về `tier = null` cho tới khi user thanh toán.
- Chống abuse: phone OTP bắt buộc lúc signup (xem §3).

---

## 2. Feature Matrix

| Feature                                  | null | basic | pro |
|------------------------------------------|:----:|:-----:|:---:|
| Tạo đơn, menu, recipe, nguyên liệu       |  ✓   |   ✓   |  ✓  |
| Chốt ca (shift closing)                  |  ✓   |   ✓   |  ✓  |
| Lịch sử đơn (HistoryPage)                |  ✓   |   ✓   |  ✓  |
| Daily Report — Cash Flow card            |      |   ✓   |  ✓  |
| Daily Report — Financial cards / P&L     |      |   ✓   |  ✓  |
| Daily Report — Performance chart         |      |   ✓   |  ✓  |
| Range Report — Cash Flow / Finance       |      |   ✓   |  ✓  |
| Range Report — Day Performance Chart     |      |   ✓   |  ✓  |
| Gợi ý đi chợ (Refill tab)                |      |   ✓   |  ✓  |
| **InventoryRefillCard — Audit tab**      |      |       |  ✓  |
| **RangeLossCard**                        |      |       |  ✓  |

Khi quyết định feature mới:
- Liên quan đối soát/thất thoát/dự đoán mua → **Pro**.
- Báo cáo tài chính / vận hành cơ bản → **Basic**.
- Tác vụ vận hành thiết yếu (không xem được dữ liệu sẽ không bán được hàng) → **null** (không gate).

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
    IF NOT EXISTS (SELECT 1 FROM trial_grants WHERE phone = user.phone) THEN
        INSERT trial_grants(phone, address_id, expires_at = now() + interval '7 days');
        INSERT address_subscriptions(tier='pro', valid_from=today, valid_to=today+7,
                                      amount_paid=0, payment_intent_id=NULL);
    END IF;
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
    tier            TEXT NOT NULL CHECK (tier IN ('basic', 'pro')),
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
    tier         TEXT NOT NULL CHECK (tier IN ('basic', 'pro')),
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
    SELECT tier, valid_to
    FROM address_subscriptions
    WHERE address_id = p_address_id
      AND valid_from <= CURRENT_DATE
      AND valid_to   >= CURRENT_DATE
    ORDER BY (CASE tier WHEN 'pro' THEN 2 WHEN 'basic' THEN 1 END) DESC,
             valid_to DESC
    LIMIT 1;
$$;
```

Trả NULL row khi không có sub active.

### Frontend hook

```js
// src/hooks/useEntitlement.js
export function useEntitlement() {
    const { selectedAddress } = useAddress();
    const [state, setState] = useState({ tier: null, validTo: null, loading: true });

    useEffect(() => {
        if (!selectedAddress?.id) return;
        supabase.rpc('get_address_entitlement', { p_address_id: selectedAddress.id })
            .then(({ data }) => setState({
                tier: data?.[0]?.tier || null,
                validTo: data?.[0]?.valid_to || null,
                loading: false
            }));
    }, [selectedAddress?.id]);

    return state;
}

export function hasFeature(tier, feature) {
    const matrix = {
        reports:    ['basic', 'pro'],
        lossAudit:  ['pro'],
    };
    return matrix[feature]?.includes(tier) || false;
}
```

Component sử dụng:
```jsx
const { tier } = useEntitlement();
if (!hasFeature(tier, 'reports')) return <UpsellPage required="basic" />;
{hasFeature(tier, 'lossAudit') && <RangeLossCard ... />}
```

---

## 6. UX khi bị gate

Ba pattern duy nhất — không tự sáng tạo cái thứ tư:

### A. Page lock (toàn page bị gate)
DailyReportPage, RangeReportPage khi `tier === null`:
- Render full-screen `<UpsellPage required="basic">`
- Hiện QR thanh toán + nút "Đã chuyển khoản" (poll status)
- KHÔNG render nội dung page → không leak preview data
- Header navigation (back) vẫn hoạt động

### B. Section placeholder (1 card bị gate trong page có truy cập)
RangeLossCard / InventoryRefillCard audit tab khi `tier === 'basic'`:
- Render placeholder card cùng size, title bình thường
- Nội dung: 🔒 icon + "Tính năng Pro" + 1 câu giá trị + nút "Nâng cấp Pro"
- Click nút → mở `<UpsellSheet required="pro">` (bottom sheet, không rời page)

### C. Status banner trên address card (AddressSelectPage)
Mỗi address card hiển thị trạng thái sub:

| Trạng thái | Hiển thị | Visual |
|---|---|---|
| `tier=pro/basic`, còn > 3 ngày | `Pro · còn 23 ngày` (text-dim, nhỏ) | text-secondary |
| Còn ≤ 3 ngày | `Pro · còn 2 ngày — Gia hạn` | text-warning + click → UpsellSheet |
| Hết hạn (`tier=null`) | `Hết hạn — Gia hạn ngay` | text-danger + button-style, nổi bật |
| Trial active | `Dùng thử · còn 4 ngày` | text-primary |

Click banner → mở `<UpsellSheet>` ngay tại page address (không cần vào report mới biết hết hạn).

**Không** dùng: blur preview, pop-up nag, modal toàn màn hình lúc khởi động — gây nhiễu mà không clear.

---

## 7. Payment flow (SePay)

### Sequence

```
User click "Gia hạn"
  ↓
Frontend: supabase.rpc('create_payment_intent', { tier, months })
  ↓ INSERT payment_intents → return { reference, amount, qr_url, expires_at }
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
Frontend (đang poll mỗi 5s, hoặc realtime sub trên payment_intents):
  Thấy status='paid' → reload entitlement → unlock UI
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

---

## 8. Decisions

| # | Quyết định | Note |
|---|---|---|
| 1 | **Trial 7 ngày Pro**, bind vào phone (1 phone = 1 trial lifetime) | Owner tạo address #2 không nhận trial |
| 2 | **Không multi-month discount** | Flat price |
| 3 | **Không refund, không prorating** | Đơn giản v1 |
| 4 | **Chỉ cho upgrade** (`null` → `basic` → `pro`), không downgrade giữa kỳ | Pro mid-period: pro-rate phần addon theo ngày còn lại của Basic |
| 5 | **Status banner ở address card** (xem §6.C) — không banner header trên main app | KH thấy ngay từ Address Select |
| 6 | **Admin override**: RPC `admin_set_subscription(address_id, tier, valid_to)` + UI riêng cho admin role | v1 cũng cần cho support thủ công |
| 7 | **Mặc định OFF** — monetization controlled bằng global flag (xem §9). Build infra trước, bật khi đủ signal | Tránh charge user khi chưa đủ ổn |

---

## 9. Feature flag (rollout control)

Monetization được wrap trong 1 **global kill switch**. Mặc định **OFF** trong toàn bộ
giai đoạn build + soft testing. Khi ON, toàn bộ logic gate/trial/payment kích hoạt.

### Behavior

| Flag | `useEntitlement()` trả về | UI behavior |
|---|---|---|
| **OFF** (mặc định) | `{ tier: 'pro', validTo: '2099-12-31' }` cho mọi address | Mọi feature mở; không render UpsellPage/Sheet/banner; payment flow ẩn |
| **ON** | Query DB như bình thường | Đầy đủ gate + trial + payment |

Mục tiêu: dev/test feature trong môi trường giả lập "ai cũng Pro" — không cần CK,
không cần OTP signup mỗi lần test. Khi flip ON, **chỉ thay đổi entitlement source**,
không đụng feature code.

### Implementation

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
        return { tier: 'pro', validTo: '2099-12-31', loading: false };
    }
    // ... real query
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

## 10. Implementation order

Tất cả thuộc cùng 1 đợt monetization rollout. Phone OTP và subscription đi cùng nhau —
không có OTP thì không chống được trial abuse.

**Build với flag OFF** (xem §9) — không user nào bị charge cho tới khi explicitly flip.

| Bước | Nội dung | Phụ thuộc |
|---|---|---|
| **1** | Feature flag infra: env var `VITE_MONETIZATION_ENABLED` + `app_config` table + bypass logic trong `useEntitlement` | — |
| **2** | Setup Twilio + Supabase Phone Auth, đổi signup flow sang phone OTP | — |
| **3** | Schema: `trial_grants`, `address_subscriptions`, `payment_intents` + RPC tương ứng | 2 |
| **4** | RPC `create_address` mở rộng: insert trial sub nếu phone chưa có trial_grant | 3 |
| **5** | `useEntitlement` hook (đã có bypass từ bước 1) + `hasFeature` helper | 1, 3 |
| **6** | Component `<UpsellPage>` (full-screen) + `<UpsellSheet>` (bottom sheet) | 5 |
| **7** | Status banner ở mỗi address card (AddressSelectPage) | 5 |
| **8** | Gate Daily/Range report pages bằng `<UpsellPage>` cho `tier=null` | 6 |
| **9** | Gate RangeLossCard + InventoryRefillCard audit tab bằng `<UpsellSheet>` cho `tier=basic` | 6 |
| **10** | SePay Edge Function webhook + RPC `confirm_payment` atomic (check `app_config`) | 3 |
| **11** | QR generation client-side + polling/realtime trên `payment_intents` | 10 |
| **12** | Admin RPC + UI cho `admin_set_subscription` | 3 |
| **13** | Migrate Twilio → eSMS/Stringee qua Edge Function (khi OTP volume > 100/tháng) | 2 |

Mỗi bước commit độc lập, có thể rollback nếu cần.

**Bước 1 đầu tiên** — đảm bảo mọi bước sau có bypass sẵn, không break dev experience.
**Bước 2-4 là nền móng** — entitlement + trial đều phụ thuộc auth phone.
**Bước 13** là optimization sau scale.

---

*Cập nhật lần đầu: 2026-05-10. Sửa khi mô hình thay đổi — KHÔNG để doc này lệch với code.*
