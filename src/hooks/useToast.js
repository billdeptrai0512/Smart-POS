import { useState, useRef, useCallback } from 'react'
import * as Sentry from '@sentry/react'

// navigator.clipboard fails in non-secure contexts and inside iframes without
// `allow="clipboard-write"`. Falls back to the legacy execCommand path which
// works in both. Returns true on success.
async function copyText(text) {
    try {
        if (navigator.clipboard?.writeText && window.isSecureContext) {
            await navigator.clipboard.writeText(text)
            return true
        }
    } catch { /* fall through to legacy path */ }
    try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.setAttribute('readonly', '')
        ta.style.position = 'fixed'
        ta.style.top = '0'
        ta.style.left = '0'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        ta.setSelectionRange(0, text.length)
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        return ok
    } catch { return false }
}

export function useToast(duration = 3500) {
    const [toast, setToast] = useState(null)
    const timer = useRef(null)

    // Stable identity so consumers can safely list these in effect/callback deps
    // without refiring on every render (they used to be plain functions, recreated
    // every render, which made that unsafe).
    const showToast = useCallback((message, type = 'info', action = null) => {
        if (timer.current) clearTimeout(timer.current)
        setToast({ message, type, action })
        timer.current = setTimeout(() => setToast(null), duration)
    }, [duration])

    const showError = useCallback((err, actionLabel) => {
        const errMsg = err?.message || String(err) || 'Lỗi không xác định'
        const errCode = err?.code ? `\nCode: ${err.code}` : ''
        const errDetails = err?.details ? `\nDetails: ${err.details}` : ''
        const copy = [
            `[${new Date().toLocaleString('vi-VN')}]`,
            `Thao tác: ${actionLabel}`,
            `Lỗi: ${errMsg}${errCode}${errDetails}`,
            `Trang: ${window.location.pathname}`
        ].join('\n')

        console.error(`[${actionLabel}]`, err)
        // No-op khi Sentry chưa init (dev) — tag `action` để lọc lỗi theo thao tác.
        Sentry.captureException(err, { tags: { action: actionLabel } })
        showToast('Có lỗi xảy ra', 'error', {
            label: 'Sao chép lỗi',
            onClick: async () => {
                const ok = await copyText(copy)
                showToast(ok ? 'Đã sao chép lỗi' : 'Không sao chép được — copy thủ công từ console', ok ? 'success' : 'warning')
            }
        })
    }, [showToast])

    return { toast, showToast, showError }
}
