import { useRef, useState } from 'react'
import { Dialog, ModalHeader, ModalActions } from '../common/ModalShell'

// Ghi chú từng món cho giỏ đang dựng — mở từ nút Ghi chú ở CheckoutBar. Ghi chú sống trên
// chính cart item (như giảm giá dòng ở CartListModal), gửi theo order_items.note và in lên
// phiếu bếp. Gõ vào nháp cục bộ, bấm Lưu mới ghi vào giỏ — không đẩy context mỗi phím gõ.
export default function CartNoteModal({ cart, onClose, onItemNote }) {
    const [drafts, setDrafts] = useState(() => Object.fromEntries(cart.map(i => [i.cartItemId, i.note || ''])))

    const save = () => {
        cart.forEach(item => {
            const note = drafts[item.cartItemId].trim()
            if (note !== (item.note || '')) onItemNote(item.cartItemId, note)
        })
        onClose()
    }

    const inputRefs = useRef([])
    // Enter: sang ô kế, ô cuối thì Lưu. Bỏ qua lúc bộ gõ (Telex/VNI trên máy bàn) còn đang
    // ghép chữ — Enter lúc đó là chốt chữ, không phải chuyển ô.
    const onEnter = (e, idx) => {
        if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
        e.preventDefault()
        const next = inputRefs.current[idx + 1]
        if (next) next.focus()
        else save()
    }

    return (
        <Dialog onClose={onClose} panelClassName="w-full max-w-md mx-4 max-h-[85dvh] flex flex-col bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden">
            <ModalHeader title="Ghi chú" onClose={onClose} className="shrink-0" />

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
                {cart.map((item, idx) => {
                    const extrasLabel = [...(item.extras || []), ...(item.toppings || [])].map(e => e.name).join(', ')
                    return (
                        <div key={item.cartItemId} className="rounded-[14px] border border-border/40 bg-surface-light/40 px-4 py-3 space-y-2">
                            <div className="min-w-0">
                                <span className="block text-[13px] font-black text-text truncate">
                                    {item.quantity > 1 && <span className="tabular-nums text-text-secondary">{item.quantity} </span>}{item.name}
                                </span>
                                {extrasLabel && <span className="block text-[11px] font-medium text-text-secondary truncate">{extrasLabel}</span>}
                            </div>
                            <input
                                type="text"
                                value={drafts[item.cartItemId]}
                                onChange={e => setDrafts(d => ({ ...d, [item.cartItemId]: e.target.value }))}
                                placeholder="Ghi chú cho bếp"
                                maxLength={200}
                                aria-label={`Ghi chú ${item.name}`}
                                ref={el => { inputRefs.current[idx] = el }}
                                autoFocus={idx === 0}
                                enterKeyHint={idx === cart.length - 1 ? 'done' : 'next'}
                                onKeyDown={e => onEnter(e, idx)}
                                className="w-full px-3 py-2 rounded-[10px] bg-bg border border-border/60 text-[13px] font-medium text-text placeholder:text-text-dim focus:outline-none focus:border-primary/40"
                            />
                        </div>
                    )
                })}
            </div>

            <div className="shrink-0 px-5 pb-5">
                <ModalActions confirmLabel="Lưu" onCancel={onClose} onConfirm={save} />
            </div>
        </Dialog>
    )
}
