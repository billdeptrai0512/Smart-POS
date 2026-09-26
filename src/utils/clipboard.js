// Copy text an toàn: clipboard API có thể bị chặn trong iframe / webview Zalo-FB
// (reject NotAllowedError). Bắt lỗi + fallback execCommand qua textarea ẩn.
export async function copyText(text) {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text)
            return true
        }
    } catch { /* fall through */ }
    try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        return ok
    } catch {
        return false
    }
}
