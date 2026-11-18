// ↑/↓% so với hôm qua cùng giờ; null hoặc 0 thì ẩn.
export default function Delta({ pct, title = 'So với hôm qua cùng giờ' }: { pct: number | null; title?: string }) {
    if (!pct) return null
    return (
        <span
            title={title}
            className={`text-[12px] font-bold tabular-nums ${pct > 0 ? 'text-success' : 'text-danger'}`}
        >
            {pct > 0 ? '↑' : '↓'}{Math.abs(pct)}%
        </span>
    )
}
