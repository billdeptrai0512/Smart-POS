import { useState, useEffect } from 'react'
import { formatVND, formatVNDInput, parseVNDInput } from '../../utils'

const PERCENT_PRESETS = [25, 50, 100]
const AMOUNT_PRESETS = [10000, 20000, 50000]

// Input + preset cho MỘT giảm giá (% hoặc đ) — không phải modal, chỉ là khối form.
// Dùng lại ở CartListModal (giỏ chưa gửi) và OrdersList (đơn đã chốt, sửa giảm giá
// theo dòng) — cả hai đọc `onPreview` để cập nhật giá NGAY trên dòng món tương ứng,
// nên không cần khối kết quả nào ở đây. Luôn mount/unmount theo điều kiện ở nơi gọi
// (không giữ mount rồi đổi `open`) nên state seed lại đúng mỗi lần mở — khỏi cần
// effect đồng bộ riêng cho việc đó.
export default function DiscountEditor({ discount, onApply, onSecondary, onPreview, secondaryLabel = 'Đóng' }) {
    const [type, setType] = useState(discount.value ? discount.type : 'percent')
    const [input, setInput] = useState(!discount.value ? '' : discount.type === 'amount' ? formatVNDInput(discount.value) : String(discount.value))

    const rawValue = type === 'amount' ? parseVNDInput(input) : (parseInt(input, 10) || 0)
    const presets = type === 'percent' ? PERCENT_PRESETS : AMOUNT_PRESETS

    // Báo giá trị đang sửa (chưa bấm Đồng ý) lên nơi gọi — để cập nhật hiển thị
    // ngay khi gõ/chọn preset, không phải đợi xác nhận mới thấy.
    useEffect(() => { onPreview?.({ type, value: rawValue }) }, [onPreview, type, rawValue])

    function switchType(next) {
        if (next === type) return
        setType(next)
        setInput('')
    }

    function handleInput(raw) {
        if (type === 'amount') return setInput(formatVNDInput(raw))
        // Percent: digits only, clamp to 100
        const digits = raw.replace(/[^\d]/g, '')
        if (!digits) return setInput('')
        setInput(String(Math.min(parseInt(digits, 10), 100)))
    }

    return (
        <>
            {/* Value input — bấm cụm %/đ để đổi đơn vị, khỏi cần 2 nút rời bên cạnh. */}
            <div className="relative flex items-center h-12 bg-surface-light border border-border/60 rounded-[14px] focus-within:border-primary/40 transition-colors overflow-hidden">
                <input
                    type="text"
                    inputMode="numeric"
                    value={input}
                    autoFocus
                    onChange={e => handleInput(e.target.value)}
                    placeholder="0"
                    className="w-full h-full bg-transparent pl-3 text-right font-bold text-text tabular-nums text-lg placeholder:text-text-secondary/40 focus:outline-none"
                />
                <button
                    type="button"
                    onClick={() => switchType(type === 'percent' ? 'amount' : 'percent')}
                    className="h-full px-3 shrink-0 font-black text-[13px] transition-colors"
                >
                    <span className={type === 'percent' ? 'text-primary' : 'text-text-secondary/40'}>%</span>
                    <span className="text-text-secondary/40"> / </span>
                    <span className={type === 'amount' ? 'text-primary' : 'text-text-secondary/40'}>đ</span>
                </button>
            </div>

            {/* Quick presets — "Bỏ" là một lựa chọn trong cùng lưới (giảm về 0), không
                phải nút tách riêng nữa; chỉ hiện khi đang CÓ giảm giá để bỏ. */}
            <div className={`grid gap-2 ${discount.value > 0 ? 'grid-cols-4' : 'grid-cols-3'}`}>
                {presets.map(p => {
                    const active = rawValue === p
                    return (
                        <button
                            key={p}
                            onClick={() => handleInput(String(p))}
                            className={`py-2 rounded-[14px] border font-bold text-[13px] tabular-nums transition-colors ${active ? 'bg-primary/10 border-primary/50 text-primary' : 'bg-bg border-border/60 text-text-secondary hover:text-text'}`}
                        >
                            {type === 'percent' ? `${p}%` : formatVND(p)}
                        </button>
                    )
                })}
                {discount.value > 0 && (
                    <button
                        onClick={() => onApply({ type, value: 0 })}
                        className="py-2 rounded-[14px] border font-bold text-[13px] tabular-nums transition-colors bg-bg border-danger/30 text-danger hover:bg-danger/5"
                    >
                        Bỏ
                    </button>
                )}
            </div>

            <div className="flex gap-2">
                <button
                    onClick={onSecondary}
                    className="flex-1 py-3 rounded-[14px] bg-bg border border-border/60 text-text-secondary font-bold text-[13px] hover:bg-surface-light transition-colors"
                >
                    {secondaryLabel}
                </button>
                <button
                    onClick={() => onApply({ type, value: type === 'percent' ? Math.min(rawValue, 100) : rawValue })}
                    className="flex-1 py-3 rounded-[14px] bg-primary text-black font-black text-[13px] hover:bg-primary/90 transition-colors"
                >
                    Đồng ý
                </button>
            </div>
        </>
    )
}
