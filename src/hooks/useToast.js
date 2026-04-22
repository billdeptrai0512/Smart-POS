import { useState, useRef } from 'react'

export function useToast(duration = 3500) {
    const [toast, setToast] = useState(null)
    const timer = useRef(null)

    function showToast(message, type = 'info', action = null) {
        if (timer.current) clearTimeout(timer.current)
        setToast({ message, type, action })
        timer.current = setTimeout(() => setToast(null), duration)
    }

    function showError(err, actionLabel) {
        const errMsg = err?.message || String(err) || 'Lỗi không xác định'
        const errCode = err?.code ? `\nCode: ${err.code}` : ''
        const errDetails = err?.details ? `\nDetails: ${err.details}` : ''
        const copyText = [
            `[${new Date().toLocaleString('vi-VN')}]`,
            `Thao tác: ${actionLabel}`,
            `Lỗi: ${errMsg}${errCode}${errDetails}`,
            `Trang: ${window.location.pathname}`
        ].join('\n')

        console.error(`[${actionLabel}]`, err)
        showToast('Có lỗi xảy ra', 'error', {
            label: 'Sao chép lỗi',
            onClick: () => navigator.clipboard?.writeText(copyText).catch(() => {})
        })
    }

    return { toast, showToast, showError }
}
