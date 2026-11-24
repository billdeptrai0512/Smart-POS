import { useEffect, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'

// Guide khách dùng thử: làm tối + khoá cả trang trừ `target`. clip-path cắt lỗ trên lớp phủ — vùng bị cắt cũng không
// nhận chạm, nên target vẫn bấm được. Chờ `delay` ms (cho khách kịp nhìn màn hình) rồi tối dần trong delay/5.
// badge: target có huy hiệu số nhô ra góc trên-phải (chuông) → lỗ ôm cả huy hiệu; không thì lỗ là ô bo tròn bán kính `radius`.
// ponytail: chỉ đo 1 lần lúc hiện (target đứng yên); xoay màn hình giữa chừng thì lỗ lệch — thêm resize listener nếu gặp.
export default function FocusMask({ target, badge = false, radius = 14, delay = 2500 }: {
    target: RefObject<HTMLElement | null>; badge?: boolean; radius?: number; delay?: number
}) {
    const [clip, setClip] = useState('')
    useEffect(() => {
        const t = setTimeout(() => {
            const el = target.current
            if (!el) return
            const r = el.getBoundingClientRect()
            const [L, T, R, B, k] = [r.left - 3, r.top - 3, r.right + 3, r.bottom + 3, radius + 3] // đệm 3px
            let top = `H${R - k}` // cạnh trên chạy tới góc bo trên-phải
            let end = `${R} ${T + k}` // điểm bắt đầu cạnh phải
            if (badge) {
                // Góc trên-phải của ô nằm gọn trong hình tròn huy hiệu: cạnh trên → cung tròn lớn quanh huy hiệu → cạnh phải.
                const bd = el.querySelector('span')!.getBoundingClientRect()
                const [cx, cy, rr] = [bd.left + bd.width / 2, bd.top + bd.height / 2, bd.width / 2 + 2 + 2] // +2 viền ring-2, +2 đệm
                top = `H${cx - Math.sqrt(rr * rr - (cy - T) ** 2)}A${rr} ${rr} 0 1 1 `
                end = `${R} ${cy + Math.sqrt(rr * rr - (R - cx) ** 2)}`
            }
            const corner = `A${k} ${k} 0 0 1 ` // 3 góc bo còn lại + góc trên-phải khi không có huy hiệu
            setClip(`path(evenodd, 'M0 0H${innerWidth}V${innerHeight}H0Z M${L + k} ${T}${top}${badge ? '' : corner}${end}V${B - k}${corner}${R - k} ${B}H${L + k}${corner}${L} ${B - k}V${T + k}${corner}${L + k} ${T}Z')`)
        }, delay)
        return () => clearTimeout(t)
    }, [target, badge, radius, delay])
    return clip ? createPortal(<div className="fixed inset-0 z-[60] bg-black/60" style={{ clipPath: clip, animation: `fade-in ${delay / 5}ms ease-out` }} />, document.body) : null
}
