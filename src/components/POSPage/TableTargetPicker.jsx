import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useCart } from '../../contexts/CartContext'
import { Dialog, MODAL_PANEL } from '../common/ModalShell'

// Màn "chọn đích" dùng chung cho Gộp/Chuyển bàn (TableDetailModal) và Chuyển vào bàn (từ
// đơn mang đi, TakeawayListModal) — cả hai chỉ khác nhau ở orderIds truyền vào và có cho
// chọn "Mang đi" làm đích hay không (nguồn đã là mang đi thì không cần tự chuyển vào chính
// nó). moveTableRounds coi target=null là "Mang đi", xem POSContext.jsx.
export default function TableTargetPicker({ orderIds, label, tableNames, showTakeawayOption = false, onBack, onClose }) {
    const { moveTableRounds } = useCart()
    const [moveTarget, setMoveTarget] = useState('')

    function confirmMove(target) {
        if (target !== null && !target.trim()) return
        moveTableRounds(orderIds, target === null ? null : target.trim())
        onBack()
    }

    return (
        <Dialog onClose={onClose} panelClassName={MODAL_PANEL}>
            <div className="shrink-0 flex items-center gap-3 px-5 pt-5 pb-4 border-b border-border/40">
                <button onClick={onBack} aria-label="Quay lại" className="shrink-0 p-1.5 -ml-1.5 text-text-secondary hover:text-text rounded-lg hover:bg-surface-light">
                    <ArrowLeft size={18} />
                </button>
                <p className="min-w-0 flex-1 text-text font-black text-base leading-none truncate">Chuyển {label} sang bàn</p>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-2">
                {showTakeawayOption && (
                    <button
                        onClick={() => confirmMove(null)}
                        className="w-full text-left px-4 py-3 rounded-[14px] border border-border/40 bg-surface-light/40 text-[13px] font-black uppercase tracking-wide text-text hover:border-primary/40 transition-colors"
                    >
                        Mang đi
                    </button>
                )}
                {tableNames.map(name => (
                    <button
                        key={name}
                        onClick={() => confirmMove(name)}
                        className="w-full text-left px-4 py-3 rounded-[14px] border border-border/40 bg-surface-light/40 text-[13px] font-black uppercase tracking-wide text-text hover:border-primary/40 transition-colors"
                    >
                        {name}
                    </button>
                ))}
                {tableNames.length === 0 && !showTakeawayOption && (
                    <p className="text-[12px] font-medium text-text-secondary py-1">Chưa có bàn nào khác — gõ tên bàn mới bên dưới.</p>
                )}
                <form onSubmit={e => { e.preventDefault(); confirmMove(moveTarget) }} className="flex gap-2 mt-1">
                    <input
                        type="text"
                        autoFocus={tableNames.length === 0 && !showTakeawayOption}
                        value={moveTarget}
                        onChange={e => setMoveTarget(e.target.value)}
                        placeholder="Bàn mới..."
                        className="flex-1 min-w-0 bg-surface-light border border-border/60 rounded-[12px] px-3 py-2 text-[13px] font-black uppercase tracking-wide text-text placeholder:text-text-secondary/50 placeholder:normal-case placeholder:tracking-normal placeholder:font-medium focus:outline-none focus:border-primary/40 transition-colors"
                    />
                    <button
                        type="submit"
                        disabled={!moveTarget.trim()}
                        className="shrink-0 px-4 rounded-[12px] bg-primary text-bg text-[12px] font-black uppercase tracking-wider disabled:opacity-50 hover:bg-primary/90 active:bg-primary/80 transition-colors"
                    >
                        Chuyển
                    </button>
                </form>
            </div>
        </Dialog>
    )
}
