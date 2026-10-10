import { useState, useRef, useCallback } from 'react'

export interface ToastAction { label: string; onClick: () => void | Promise<void> }
export interface ToastState { message: string; type: string; action: ToastAction | null }

// Hình dạng lỗi hay gặp (Error, PostgrestError, lỗi tự ném có stage/expected) — chỉ đọc, không đoán.
interface ErrorLike { message?: string; code?: string; details?: string; stage?: string; expected?: boolean }

export function useToast(duration = 3500) {
    const [toast, setToast] = useState<ToastState | null>(null)
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Stable identity so consumers can safely list these in effect/callback deps
    // without refiring on every render (they used to be plain functions, recreated
    // every render, which made that unsafe).
    const showToast = useCallback((message: string, type = 'info', action: ToastAction | null = null) => {
        if (timer.current) clearTimeout(timer.current)
        setToast({ message, type, action })
        timer.current = setTimeout(() => setToast(null), duration)
    }, [duration])

    // Console + Sentry only, không toast — tách riêng để chỗ nào cần báo lỗi ngay sau
    // đó lại tự toast một thông báo khác (vd TableDetailModal: in lỗi rồi tính tiền
    // thành công) vẫn ghi nhận lỗi mà không bị toast tính tiền đè mất toast lỗi.
    const reportError = useCallback((errArg: unknown, actionLabel: string) => {
        const err = errArg as ErrorLike | null | undefined
        console.error(`[${actionLabel}]`, err)
        // err.expected = validation/guard-rail message, không phải lỗi thật (đã biết
        // trước có thể xảy ra) — không đáng báo Sentry, chỉ cần console + toast.
        if (!err?.expected) {
            // Dynamic import (thay vì static) — useToast được import ở gần như mọi
            // context/page, nên import tĩnh @sentry/react ở đây từng kéo cả SDK vào
            // bundle đầu tiên y hệt vấn đề bên main.tsx. No-op khi Sentry chưa init
            // (dev) — tag `action` để lọc lỗi theo thao tác, `stage` nếu có để lọc sâu hơn.
            import('@sentry/react')
                .then(Sentry => Sentry.captureException(err, { tags: { action: actionLabel, ...(err?.stage ? { stage: err.stage } : {}) } }))
                .catch(() => { })
        }
    }, [])

    const showError = useCallback((errArg: unknown, actionLabel: string) => {
        reportError(errArg, actionLabel)
        const err = errArg as ErrorLike | null | undefined
        const errMsg = err?.message || String(errArg) || 'Lỗi không xác định'
        const errCode = err?.code ? `\nCode: ${err.code}` : ''
        const errDetails = err?.details ? `\nDetails: ${err.details}` : ''
        // err.stage: vài nơi gọi (vd escposBitmap.ts) gắn thêm bước xảy ra lỗi (capture DOM
        // hay gửi mạng...) — debug từ xa không cần đoán mò từ 1 message chung chung.
        const errStage = err?.stage ? `\nStage: ${err.stage}` : ''
        const copy = [
            `[${new Date().toLocaleString('vi-VN')}]`,
            `Thao tác: ${actionLabel}`,
            `Lỗi: ${errMsg}${errCode}${errDetails}${errStage}`,
            `Trang: ${window.location.pathname}`
        ].join('\n')

        showToast('Có lỗi xảy ra', 'error', {
            label: 'Sao chép lỗi',
            onClick: async () => {
                // ponytail: không fallback execCommand — Capacitor (https://localhost) và PWA luôn là
                // secure context; chỉ dev qua http LAN mới thiếu clipboard → rơi vào toast warning.
                let ok = true
                try { await navigator.clipboard.writeText(copy) } catch { ok = false }
                showToast(ok ? 'Đã sao chép lỗi' : 'Không sao chép được — copy thủ công từ console', ok ? 'success' : 'warning')
            }
        })
    }, [showToast, reportError])

    return { toast, showToast, showError, reportError }
}
