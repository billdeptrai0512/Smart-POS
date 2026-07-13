// ============================================================
// SePay webhook — nhận chuyển khoản, mở khoá gói tự động.
//
// SePay POST → verify HMAC-SHA256 → parse 'SP<số>' khỏi nội dung CK →
// confirm_payment RPC (service_role) → INSERT address_subscriptions →
// realtime đẩy về client (usePaymentListener).
//
// Xác thực (theo mẫu SePay):
//   x-sepay-signature = 'sha256=' + HMAC_SHA256( timestamp + '.' + rawBody , SECRET )
//   x-sepay-timestamp = timestamp gửi kèm
//   SECRET = env SEPAY_WEBHOOK_SECRET (giá trị ngẫu nhiên mạnh, set qua Supabase secrets — không hardcode)
//
// HMAC tính trên RAW body (không parse rồi stringify lại — tránh lệch format).
//
// Deploy:  supabase functions deploy sepay-webhook --no-verify-jwt
// Secret:  supabase secrets set SEPAY_WEBHOOK_SECRET=<giá-trị-ngẫu-nhiên-mạnh>
// URL:     https://<project-ref>.supabase.co/functions/v1/sepay-webhook
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const encoder = new TextEncoder()

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    )
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
    return Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
}

// So sánh constant-time để không lộ thông tin qua timing.
function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    let result = 0
    for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return result === 0
}

// Response chuẩn SePay: body JSON {"success": true/false} để SePay biết delivery OK.
function json(success: boolean, message: string, status: number): Response {
    return new Response(JSON.stringify({ success, message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
    })
}

Deno.serve(async (req) => {
    if (req.method !== 'POST') {
        return json(false, 'method not allowed', 405)
    }

    const secret = Deno.env.get('SEPAY_WEBHOOK_SECRET')
    if (!secret) return json(false, 'webhook secret not configured', 500)

    const rawBody = await req.text()
    const signature = req.headers.get('x-sepay-signature') ?? ''
    const timestamp = req.headers.get('x-sepay-timestamp') ?? ''

    const expected = 'sha256=' + (await hmacSha256Hex(secret, timestamp + '.' + rawBody))
    if (!timingSafeEqual(signature, expected)) {
        // DIAGNOSTIC: dump header gửi đến (giá trị cắt ngắn) để xác định scheme thật của SePay.
        const headers: Record<string, string> = {}
        req.headers.forEach((v, k) => { headers[k] = v.length > 40 ? v.slice(0, 40) + '…' : v })
        console.warn('[sepay] ✗ invalid signature', JSON.stringify({
            gotSignature: signature, gotTimestamp: timestamp,
            expectedPrefix: expected.slice(0, 20) + '…',
            headers, body: rawBody.slice(0, 300),
        }))
        return json(false, 'invalid signature', 401)
    }
    console.log('[sepay] ✓ signature verified')

    let body: Record<string, unknown>
    try {
        body = JSON.parse(rawBody)
    } catch {
        return json(false, 'bad json', 400)
    }

    // Chỉ xử lý giao dịch TIỀN VÀO (bỏ qua tiền ra nếu có gửi).
    const transferType = String(body.transferType ?? 'in')
    if (transferType !== 'in') return json(true, 'ignored (not incoming)', 200)

    // Nội dung CK: bắt 'SP' + 3..30 chữ số. success=true (ack) nếu không khớp để SePay khỏi retry.
    const content = String(body.content ?? body.description ?? '')
    const match = content.match(/SP(\d{3,30})/i)
    if (!match) {
        console.warn('[sepay] ⚠ no SP reference in content:', content)
        return json(true, 'no reference', 200)
    }

    const reference = match[1]
    const amount = Math.round(Number(body.transferAmount ?? body.amount ?? 0))
    // null (không phải '') khi thiếu id: sepay_tx_id='' sẽ làm MỌI giao dịch sau bị
    // từ chối nhầm là 'duplicate' (UNIQUE + check EXISTS khớp chuỗi rỗng).
    const txIdRaw = body.id ?? body.referenceCode
    const txId = txIdRaw != null && String(txIdRaw) !== '' ? String(txIdRaw) : null
    console.log('[sepay] → confirm_payment', { reference, amount, txId })

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data, error } = await supabase.rpc('confirm_payment', {
        p_reference: reference,
        p_amount: amount,
        p_sepay_tx_id: txId,
    })

    // 500 → SePay sẽ retry (lỗi tạm thời). Các kết quả nghiệp vụ trả 200 (đã xử lý).
    if (error) {
        console.error('[sepay] ✗ rpc error:', error.message)
        return json(false, 'rpc error: ' + error.message, 500)
    }
    console.log('[sepay] ✓ result:', data)
    return json(true, String(data ?? 'ok'), 200)
})
