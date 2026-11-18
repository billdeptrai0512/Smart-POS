// ↑/↓% so với hôm qua cùng giờ; null hoặc 0 thì ẩn.
export default function Delta({ pct }: { pct: number | null }) {
    if (!pct) return null
    return (
        <span
            title="So với hôm qua cùng giờ"
            className={`text-[12px] font-bold tabular-nums ${pct > 0 ? 'text-success' : 'text-danger'}`}
        >
            {pct > 0 ? '↑' : '↓'}{Math.abs(pct)}%
        </span>
    )
}
