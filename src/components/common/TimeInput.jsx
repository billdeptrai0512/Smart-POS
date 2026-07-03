// Ô giờ 24h dạng text "HH:mm" — thay cho input[type=time] native vì native
// hiển thị AM/PM theo locale của máy, không ép 24h được.
export default function TimeInput({ value, onChange, className = '', ...rest }) {
    const format = (raw) => {
        let d = raw.replace(/\D/g, '')
        // Gõ "9" → "09" để "930" thành 09:30 thay vì giờ 93.
        if (d && d[0] > '2') d = '0' + d
        d = d.slice(0, 4)
        return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d
    }
    // Blur: clamp về giờ hợp lệ (23:59 max), pad đủ "HH:mm". Rỗng thì giữ rỗng.
    const clamp = (v) => {
        const d = String(v).replace(/\D/g, '')
        if (!d) return ''
        const h = Math.min(23, Number(d.slice(0, 2)))
        const m = Math.min(59, Number(d.slice(2, 4) || 0))
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    }
    return (
        <input
            type="text"
            inputMode="numeric"
            placeholder="HH:mm"
            maxLength={5}
            value={value}
            onChange={e => onChange(format(e.target.value))}
            onBlur={() => onChange(clamp(value))}
            className={className}
            {...rest}
        />
    )
}
