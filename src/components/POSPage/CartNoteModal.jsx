import { useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { Dialog } from '../common/ModalShell'

// Ghi chú từng món cho giỏ đang dựng — mở từ nút Ghi chú ở CheckoutBar. Ghi chú sống trên
// chính cart item (như giảm giá dòng ở CartListModal), gửi theo order_items.note và in lên
// phiếu bếp. Gõ vào nháp cục bộ (không đẩy context mỗi phím gõ), tự lưu khi rời ô / Enter /
// bấm ra ngoài; ô đang sửa dở có thêm ✓ (lưu) / ✕ (trả về ghi chú đã lưu) ở góc phải.
// Muốn bỏ ghi chú thì xoá trống ô.
export default function CartNoteModal({ cart, onClose, onItemNote }) {
    const [drafts, setDrafts] = useState(() => Object.fromEntries(cart.map(i => [i.cartItemId, i.note || ''])))

    const isDirty = (item) => drafts[item.cartItemId].trim() !== (item.note || '')
    const commit = (item) => {
        if (isDirty(item)) onItemNote(item.cartItemId, drafts[item.cartItemId].trim())
    }

    const close = () => {
        cart.forEach(commit)
        onClose()
    }

    const inputRefs = useRef([])
    // Enter: sang ô kế (blur tự lưu ô vừa rời), ô cuối thì lưu hết và đóng. Bỏ qua lúc bộ gõ
    // (Telex/VNI trên máy bàn) còn đang ghép chữ — Enter lúc đó là chốt chữ, không phải chuyển ô.
    const onEnter = (e, idx) => {
        if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
        e.preventDefault()
        const next = inputRefs.current[idx + 1]
        if (next) next.focus()
        else close()
    }

    return (
        <Dialog onClose={close} panelClassName="w-full max-w-md mx-4 max-h-[85dvh] flex flex-col bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden">
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                {cart.map((item, idx) => {
                    const extrasLabel = [...(item.extras || []), ...(item.toppings || [])].map(e => e.name).join(', ')
                    const dirty = isDirty(item)
                    return (
                        <div key={item.cartItemId} className="space-y-1.5">
                            <span className="block text-[13px] font-black text-text truncate">
                                {item.quantity > 1 && <span className="tabular-nums text-text-secondary">{item.quantity} </span>}{item.name}
                                {extrasLabel && <span className="font-medium text-[11px] text-text-secondary"> · {extrasLabel}</span>}
                            </span>
                            <div className="relative">
                                {/* textarea 1 dòng tự cao theo nội dung (ref chạy lại mỗi render, kể cả
                                    sau khi ✕ trả nháp về) — field-sizing:content chưa có trên Safari iOS. */}
                                <textarea
                                    rows={1}
                                    value={drafts[item.cartItemId]}
                                    onChange={e => setDrafts(d => ({ ...d, [item.cartItemId]: e.target.value }))}
                                    onBlur={() => commit(item)}
                                    placeholder="Ghi chú cho bếp"
                                    maxLength={200}
                                    aria-label={`Ghi chú ${item.name}`}
                                    ref={el => {
                                        inputRefs.current[idx] = el
                                        if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` }
                                    }}
                                    autoFocus={idx === 0}
                                    enterKeyHint={idx === cart.length - 1 ? 'done' : 'next'}
                                    onKeyDown={e => onEnter(e, idx)}
                                    className={`block w-full pl-3 py-2 ${dirty ? 'pr-[68px]' : 'pr-3'} rounded-[10px] bg-bg border border-border/60 text-[13px] font-medium text-text placeholder:text-text-dim resize-none overflow-hidden focus:outline-none focus:border-primary/40`}
                                />
                                {/* Chỉ hiện khi nháp khác ghi chú đã lưu. preventDefault ở pointerdown giữ
                                    focus trong ô — không thì blur tự lưu chạy trước khi ✕ kịp trả nháp về. */}
                                {dirty && (
                                    <div className="absolute top-1 right-1 flex gap-1" onPointerDown={e => e.preventDefault()}>
                                        <button
                                            type="button"
                                            aria-label={`Bỏ sửa ghi chú ${item.name}`}
                                            onClick={() => setDrafts(d => ({ ...d, [item.cartItemId]: item.note || '' }))}
                                            className="w-[28px] h-[28px] rounded-[8px] border border-border/60 bg-surface-light text-text-secondary hover:text-text flex items-center justify-center transition-colors"
                                        >
                                            <X size={14} strokeWidth={2.5} />
                                        </button>
                                        <button
                                            type="button"
                                            aria-label={`Lưu ghi chú ${item.name}`}
                                            onClick={() => commit(item)}
                                            className="w-[28px] h-[28px] rounded-[8px] bg-primary text-black hover:bg-primary/90 flex items-center justify-center transition-colors"
                                        >
                                            <Check size={14} strokeWidth={3} />
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>
        </Dialog>
    )
}
