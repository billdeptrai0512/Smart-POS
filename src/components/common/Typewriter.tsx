import { useState, useEffect } from 'react'

// Types text out left→right. Dùng cho dòng Nhật ký ở POS (chỉ chạy khi "Tạo đơn" được bấm — bấm món
// không ghi vào nhật ký nên không bị nhầm là đã gửi) và dải onboarding guide (gõ lại mỗi khi đổi việc).
// Text đổi giữa chừng: giữ phần đã gõ nếu vẫn là tiền tố của text mới, không thì gõ lại từ đầu.
export default function Typewriter({ text }: { text: string }) {
    const [n, setN] = useState(0)
    const [prevText, setPrevText] = useState(text)
    if (text !== prevText) {
        setPrevText(text)
        if (!text.startsWith(prevText.slice(0, n))) setN(0)
    }
    useEffect(() => {
        if (n >= text.length) return
        const id = setTimeout(() => setN(n + 1), 25)
        return () => clearTimeout(id)
    }, [n, text.length])
    return <>{text.slice(0, n)}{n < text.length && <span className="opacity-50">▌</span>}</>
}
