import { useState, useEffect } from 'react'
import { formatVND, formatVNDInput, parseVNDInput } from '../../utils'
import { clampPercentInput } from '../../utils/discountPrograms'
import type { Discount } from '../../types/domain'

const PERCENT_PRESETS = [20, 50, 100]
const AMOUNT_PRESETS = [10000, 20000, 50000]

// Input + preset cho MỘT giảm giá (% hoặc đ) — không phải modal, chỉ là khối form.
// Dùng lại ở CartListModal (giỏ chưa gửi) và OrdersList (đơn đã chốt, sửa giảm giá
// theo dòng) — cả hai đọc `onPreview` để cập nhật giá NGAY trên dòng món tương ứng,
// nên không cần khối kết quả nào ở đây. Luôn mount/unmount theo điều kiện ở nơi gọi
// (không giữ mount rồi đổi `open`) nên state seed lại đúng mỗi lần mở — khỏi cần
// effect đồng bộ riêng cho việc đó.
// note: cảnh báo hiện ngay trên ô nhập (OrdersList dùng để báo "số đang có gồm cả giảm giá
// chương trình") — bỏ trống thì không chiếm chỗ nào.
interface Props {
    discount: Discount
    onApply: (discount: Discount) => void
    onSecondary?: () => void
    onPreview?: (discount: Discount) => void
    secondaryLabel?: string
    note?: string | null
    // compact: một hàng preset, chạm là áp luôn (chạm lại = bỏ); ô nhập số tay ẩn sau "Khác"
    compact?: boolean
}

export default function DiscountEditor({ discount, onApply, onSecondary, onPreview, secondaryLabel = 'Đóng', note = null, compact = false }: Props) {
    const [type, setType] = useState<Discount['type']>(discount.value ? discount.type : 'percent')
    const [input, setInput] = useState(!discount.value ? '' : discount.type === 'amount' ? formatVNDInput(discount.value) : String(discount.value))

    const presets = type === 'percent' ? PERCENT_PRESETS : AMOUNT_PRESETS
    // Đang có mức giảm tuỳ ý (không trùng preset) thì mở sẵn ô nhập để thấy đúng số đang áp.
    const [showInput, setShowInput] = useState(!compact || (discount.value > 0 && !presets.includes(discount.value)))
    const rawValue = type === 'amount' ? parseVNDInput(input) : (parseInt(input, 10) || 0)

    // Báo giá trị đang sửa (chưa bấm Đồng ý) lên nơi gọi — để cập nhật hiển thị
    // ngay khi gõ/chọn preset, không phải đợi xác nhận mới thấy.
    useEffect(() => { onPreview?.({ type, value: rawValue }) }, [onPreview, type, rawValue])

    function switchType(next: Discount['type']) {
        if (next === type) return
        setType(next)
        setInput('')
    }

    function handleInput(raw: string) {
        setInput(type === 'amount' ? formatVNDInput(raw) : clampPercentInput(raw))
    }

    const apply = () => onApply({ type, value: type === 'percent' ? Math.min(rawValue, 100) : rawValue })

    return (
        <>
            {note && <p className="text-[11px] font-bold text-warning leading-snug">{note}</p>}
            {/* Value input — bấm cụm %/đ để đổi đơn vị, khỏi cần 2 nút rời bên cạnh. */}
            {showInput && <div className="relative flex items-center h-12 bg-surface-light border border-border/60 rounded-[14px] focus-within:border-primary/40 transition-colors overflow-hidden">
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
            </div>}

            {/* Quick presets — "Bỏ" là một lựa chọn trong cùng lưới (giảm về 0), không
                phải nút tách riêng nữa; chỉ hiện khi đang CÓ giảm giá để bỏ. */}
            <div className={compact ? 'flex gap-2' : `grid gap-2 ${discount.value > 0 ? 'grid-cols-4' : 'grid-cols-3'}`}>
                {presets.map(p => {
                    const active = rawValue === p
                    return (
                        <button
                            key={p}
                            onClick={() => {
                                if (!compact || showInput) return handleInput(String(p))
                                // Chạm lại preset đang chọn = bỏ giảm giá.
                                const next = active ? 0 : p
                                setInput(next ? String(p) : '')
                                onApply({ type, value: next })
                            }}
                            className={`${compact ? 'flex-1 min-w-0 h-10' : 'py-2'} rounded-[14px] border font-bold text-[13px] tabular-nums transition-colors ${active ? 'bg-primary/10 border-primary/50 text-primary' : 'bg-bg border-border/60 text-text-secondary hover:text-text'}`}
                        >
                            {type === 'percent' ? `${p}%` : compact ? `${p / 1000}k` : formatVND(p)}
                        </button>
                    )
                })}
                {compact && !showInput && (
                    <button onClick={() => setShowInput(true)} className="shrink-0 h-10 px-3 rounded-[14px] border font-bold text-[12px] transition-colors bg-bg border-border/60 text-text-secondary hover:text-text">
                        Khác
                    </button>
                )}
                {discount.value > 0 && (!compact || showInput) && (
                    <button
                        onClick={() => onApply({ type, value: 0 })}
                        className={`${compact ? 'shrink-0 h-10 px-3' : 'py-2'} rounded-[14px] border font-bold text-[13px] tabular-nums transition-colors bg-bg border-danger/30 text-danger hover:bg-danger/5`}
                    >
                        Bỏ
                    </button>
                )}
                {compact && showInput && (
                    <button onClick={apply} className="shrink-0 h-10 px-4 rounded-[14px] bg-primary text-black font-black text-[13px] hover:bg-primary/90 transition-colors">
                        Đồng ý
                    </button>
                )}
            </div>

            {!compact && <div className="flex gap-2">
                <button
                    onClick={onSecondary}
                    className="flex-1 py-3 rounded-[14px] bg-bg border border-border/60 text-text-secondary font-bold text-[13px] hover:bg-surface-light transition-colors"
                >
                    {secondaryLabel}
                </button>
                <button
                    onClick={apply}
                    className="flex-1 py-3 rounded-[14px] bg-primary text-black font-black text-[13px] hover:bg-primary/90 transition-colors"
                >
                    Đồng ý
                </button>
            </div>}
        </>
    )
}
