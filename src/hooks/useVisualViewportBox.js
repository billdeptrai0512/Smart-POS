import { useState, useEffect } from 'react'

// Bàn phím ảo chỉ co visualViewport, không co `position: fixed` → trả top/height của vùng
// đang nhìn thấy để phần tử fixed bám theo (Dialog, FAB "Lưu thực thu" ở DailyReportPage).
export function useVisualViewportBox() {
    const [box, setBox] = useState()
    useEffect(() => {
        const vv = window.visualViewport
        const update = () => setBox({ top: vv.offsetTop, height: vv.height })
        update()
        const ac = new AbortController()
        vv.addEventListener('resize', update, { signal: ac.signal })
        vv.addEventListener('scroll', update, { signal: ac.signal })
        return () => ac.abort()
    }, [])
    return box
}
