// ============================================================
// request-password-reset — gửi MÃ XÁC NHẬN đặt lại mật khẩu về EMAIL THẬT của user.
//
// Vì sao cần Edge Function: đăng nhập bằng username → email trong auth.users là
// email giả `<username>@coffee.local`, nên `resetPasswordForEmail` của Supabase
// gửi vào hư không. Email thật nằm ở bảng profile `users.email`. Hàm này:
//   1. tra user theo username (service_role, bỏ qua RLS)
//   2. generateLink('recovery') trên email giả — KHÔNG gửi mail, chỉ để đúc token;
//      lấy `properties.email_otp` (mã số của chính token đó — độ dài do Supabase
//      cấu hình: Auth → Emails → Email OTP Length, đang là 8)
//   3. tự gửi mã đó tới users.email qua SMTP của Gmail
// Client đổi mã lấy session bằng verifyOtp(type:'recovery') — xem authService.js.
//
// Mã thay vì link vì app là PWA cài trên điện thoại: bấm link trong Gmail sẽ mở
// trình duyệt khác (không phải PWA) → user đổi xong mật khẩu ở đó rồi lạc đường.
// Nhập mã thì không phải rời app.
//
// Gửi qua SMTP của Gmail (không phải ESP bên thứ ba) vì chưa có domain riêng:
// domain miễn phí như @gmail.com không xác thực được ở Brevo/Resend, mail sẽ bị
// chặn hoặc vào spam. Đi thẳng smtp.gmail.com thì Google chính là người gửi nên
// SPF/DKIM/DMARC pass. Trần: ~500 mail/ngày. Có domain rồi thì thay đúng khối
// client.send() bên dưới bằng API của ESP, phần còn lại giữ nguyên.
//
// Endpoint CÔNG KHAI (người quên mật khẩu thì chưa có session):
//   supabase functions deploy request-password-reset --no-verify-jwt
//
// Secrets cần set (App Password 16 ký tự, KHÔNG phải mật khẩu Google thường —
// tạo ở myaccount.google.com/apppasswords, cần bật 2FA trước):
//   supabase secrets set GMAIL_USER=ban@gmail.com
//   supabase secrets set GMAIL_APP_PASSWORD=abcdefghijklmnop
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const cors = {
    'Access-Control-Allow-Origin': '*',
    // apikey + x-client-info: supabase-js LUÔN gắn 2 header này khi invoke →
    // thiếu trong danh sách là preflight rớt, client báo "Mất kết nối".
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: Record<string, unknown>, status: number): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json' },
    })
}

// ponytail: chặn spam bằng Map trong RAM của instance — trần: Supabase chạy
// nhiều instance nên kẻ tấn công kiên trì vẫn lách được. Đủ để chặn vòng lặp
// ngây thơ; nếu thật sự bị dội mail thì nâng lên cột `last_reset_at` trong DB.
const lastSent = new Map<string, number>()
const THROTTLE_MS = 60_000

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

    let payload: Record<string, unknown>
    try { payload = await req.json() } catch { return json({ error: 'bad json' }, 400) }

    // Charset của sanitizeUsername (authService.js) — chặn luôn injection vào filter dưới.
    const username = String(payload.username ?? '').trim().toLowerCase()
    if (!username || !/^[a-z0-9_.-]+$/.test(username)) {
        return json({ error: 'Tài khoản không hợp lệ' }, 400)
    }
    const now = Date.now()
    if (now - (lastSent.get(username) ?? 0) < THROTTLE_MS) {
        return json({ ok: true }, 200)  // im lặng như trường hợp không tìm thấy
    }
    // Dọn bản ghi đã quá hạn chặn — Map này sống theo instance, không dọn thì cứ
    // phình mãi. Chỉ quét khi đã đủ nhiều để khỏi tốn công mỗi request.
    if (lastSent.size > 500) {
        for (const [k, t] of lastSent) if (now - t > THROTTLE_MS) lastSent.delete(k)
    }
    lastSent.set(username, now)

    const service = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: row } = await service
        .from('users')
        .select('auth_id, name, email')
        .eq('username', username)
        .maybeSingle()

    // Không có user / chưa khai email / tài khoản không có login → trả ok y hệt
    // trường hợp thành công, không để dò xem username nào tồn tại.
    if (!row?.auth_id || !row.email) return json({ ok: true }, 200)

    const { data: authUser } = await service.auth.admin.getUserById(row.auth_id)
    const authEmail = authUser?.user?.email
    if (!authEmail) return json({ ok: true }, 200)

    // Client verify mã bằng email GIẢ tự dựng (`<username>@coffee.local`), còn
    // đây đúc mã theo auth email THẬT. Hai bên lệch nhau thì mail vẫn gửi đúng
    // nhưng verifyOtp fail vĩnh viễn — user chỉ thấy "Mã không đúng", không ai
    // đoán ra. Log lại để bug câm đó thành 1 dòng tìm được.
    if (authEmail !== `${username}@coffee.local`) {
        console.warn(`auth email lệch quy ước: username=${username} authEmail=${authEmail} → client sẽ verify fail`)
    }

    const { data: link, error: linkErr } = await service.auth.admin.generateLink({
        type: 'recovery',
        email: authEmail,
    })
    const code = link?.properties?.email_otp
    if (linkErr || !code) {
        console.error('generateLink failed:', linkErr)
        return json({ error: 'Không tạo được mã, thử lại' }, 500)
    }

    const gmailUser = Deno.env.get('GMAIL_USER')!
    const client = new SMTPClient({
        connection: {
            hostname: 'smtp.gmail.com',
            port: 465,
            tls: true,
            auth: { username: gmailUser, password: Deno.env.get('GMAIL_APP_PASSWORD')! },
        },
    })
    // Gửi ở nền: bắt tay SMTP với Gmail tốn 3–5s, không có lý do bắt user ngồi
    // nhìn spinner — màn nhập mã hiện ngay, mail tới sau vài giây.
    // Đánh đổi: lỗi gửi không báo được về client nữa, chỉ nằm ở log function.
    const sending = (async () => {
        // Text thuần + subject KHÔNG dấu, cố ý: denomailer gấp dòng sai khi
        // subject có ký tự UTF-8 dài → header hỏng, client bó tay và đổ nguyên
        // MIME thô ra màn hình. 1 phần text/plain thì không có gì để hỏng.
        await client.send({
            from: `KOPOS <${gmailUser}>`,
            to: row.email,
            subject: `KOPOS - Ma dat lai mat khau: ${code}`,
            content: [
                `Chào ${row.name ?? 'bạn'},`,
                ``,
                `Mã đặt lại mật khẩu KOPOS của bạn:`,
                ``,
                `    ${code}`,
                ``,

                `Mã hết hạn sau 15 phút và chỉ dùng được 1 lần.`,
                ``,
                `Không phải bạn yêu cầu? Bỏ qua email này, mật khẩu hiện tại vẫn giữ nguyên.`,
            ].join('\n'),
        })
    })().catch((e) => {
        console.error('smtp send failed:', e)
    }).finally(async () => {
        await client.close()
    })

    // @ts-ignore EdgeRuntime là global của Supabase Edge Runtime — giữ instance
    // sống tới khi gửi xong dù response đã trả về.
    EdgeRuntime.waitUntil(sending)

    return json({ ok: true }, 200)
})
