// Cuộn chậm (~0,9s, easeOut) đưa `el` vào giữa/đầu khung cuộn gần nhất — scrollIntoView({behavior:'smooth'}) của
// trình duyệt chỉ ~0,25s, khách thấy như giật 1 cái. Bật giảm chuyển động của hệ điều hành → nhảy thẳng.
export function slowScrollTo(el: HTMLElement, block: 'center' | 'start' | 'end', ms = 900) {
    let sc: HTMLElement | null = el.parentElement
    while (sc && sc.scrollHeight <= sc.clientHeight) sc = sc.parentElement
    if (!sc) return
    const s = sc.getBoundingClientRect(), r = el.getBoundingClientRect()
    const from = sc.scrollTop
    const delta = block === 'center' ? r.top + r.height / 2 - (s.top + s.height / 2) : block === 'end' ? sc.scrollHeight - sc.clientHeight - from : r.top - s.top
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { sc.scrollTop = from + delta; return }
    const t0 = performance.now()
    const step = (now: number) => {
        const p = Math.min((now - t0) / ms, 1)
        sc.scrollTop = from + delta * (1 - (1 - p) ** 3)
        if (p < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
}
