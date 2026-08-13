import { useRef } from 'react'
import { ArrowLeft, Trash2, Check, Printer } from 'lucide-react'
import { useCart } from '../../contexts/CartContext'
import { useHistory } from '../../contexts/HistoryContext'
import { useAddress } from '../../contexts/AddressContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { formatVND } from '../../utils'
import { timeStringVN, dateShortVN, isSameDayVN } from '../../utils/dateVN'
import { Dialog } from '../common/ModalShell'

// Chi tiết một bàn — mở từ thẻ bàn trong lưới (TableModal).
//
// Thẻ bàn chỉ đủ chỗ cho tờ hoá đơn đã gộp; ở đây tách lại theo ĐỢT vì mọi thao tác
// đều nhắm vào một đợt cụ thể ("cái đợt 10g15 gọi nhầm", "đợt vừa rồi ra món chưa"),
// không nhắm vào dòng món đã gộp. Tính tiền cũng nằm ở đây chứ không ở thẻ: bấm tính
// tiền mà chưa đọc lại đợt nào của bàn là cách thu sai tiền dễ nhất.
//
// ponytail: in qua window.print() (xem #print-bill ở cuối file + @media print trong
// index.css), không SDK máy in nhiệt. Đổi khi quán có máy ESC/POS thật.
// Ba nút trên mỗi đợt cùng một khuôn viên thuốc: tách chuỗi class ra để đổi kiểu một
// lần, không phải săn từng bản chép.
const CHIP = 'h-[26px] rounded-full border text-[11px] font-black uppercase tracking-wider transition-colors'
const CHIP_IDLE = `${CHIP} bg-surface-light border-border/60 text-text-secondary`

export default function TableDetailModal({ table, onClose, onPick }) {
    const confirm = useConfirm()
    const { handleCloseTable, refreshTables, reopenRoundIntoCart, toggleServed, orderCount } = useCart()
    const { handleDeleteOrder } = useHistory()
    const { selectedAddress } = useAddress()
    const printedAtRef = useRef(null)

    // Bàn ngồi qua nửa đêm là chuyện thường (xem fetchOpenTables) nên nhãn giờ phải kèm
    // ngày khi khác hôm nay, còn hôm nay thì chỉ giờ cho gọn.
    const fullLabel = (d) => `${timeStringVN(d)} ${dateShortVN(d)}`
    const openedLabel = (iso) => {
        const d = new Date(iso)
        return isSameDayVN(d, new Date()) ? timeStringVN(d) : fullLabel(d)
    }
    const linesLabel = (lines) => lines.map(l => `${l.qty} ${l.name}`).join(', ')

    async function handleEditRound(round) {
        // Cả chuỗi xoá-nạp-giỏ nằm trong POSContext (reopenRoundIntoCart) — ở đây chỉ
        // còn việc đóng modal và chọn bàn khi nó báo xong.
        if (await reopenRoundIntoCart(round)) onPick()
    }

    async function handleDeleteRound(round) {
        const ok = await confirm({
            title: `Xóa đợt ${openedLabel(round.createdAt)}?`,
            detail: `${linesLabel(round.lines)} — ${formatVND(round.total)}. Hành động này không thể hoàn tác!`,
            danger: true,
            confirmLabel: 'Xóa',
        })
        if (!ok) return
        // handleDeleteOrder tự đồng bộ lại lưới bàn; bàn hết đợt thì TableModal gỡ modal
        // này xuống, không cần tự đóng ở đây.
        await handleDeleteOrder(round.id)
    }

    // In = mở hộp in của trình duyệt/hệ điều hành, CSS @media print (index.css) lo phần
    // chỉ hiện #print-bill. Bill dựng sẵn trong DOM nên không có bước render lại nào
    // giữa cú bấm và lệnh in.
    function handlePrint() {
        // Ghi thẳng vào DOM chứ không qua state: window.print() chạy đồng bộ, React chưa
        // kịp render lại thì hộp in đã chụp mất tờ bill với giờ cũ.
        if (printedAtRef.current) printedAtRef.current.textContent = fullLabel(new Date())
        window.print()
    }

    async function handleBill() {
        // Máy khác có thể vừa gửi thêm một đợt sau lần fetch gần nhất. Nhân viên thu
        // tiền theo đúng con số trong hộp này nên lấy lại số mới nhất ngay trước khi hỏi.
        const fresh = (await refreshTables()).find(x => x.name === table.name) || table
        const pending = fresh.rounds.filter(r => !r.servedAt).length
        const ok = await confirm({
            title: `Tính tiền ${fresh.name}?`,
            detail: `${linesLabel(fresh.lines)} — ${formatVND(fresh.total)} · ${fresh.rounds.length} đợt từ ${openedLabel(fresh.openedAt)}`
                // Thu tiền xong bàn biến mất khỏi lưới, đợt chưa ra món cũng biến mất
                // theo — cảnh báo ở đây là chỗ cuối cùng còn kịp.
                + (pending ? `\n⚠ Còn ${pending} đợt chưa ra món.` : ''),
            confirmLabel: 'Tính tiền',
        })
        if (!ok) return
        handleCloseTable(fresh)
        onClose()
    }

    return (
        <Dialog onClose={onClose} panelClassName="w-full max-w-md mx-4 max-h-[85dvh] flex flex-col bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden">
            <div className="shrink-0 flex items-center gap-3 px-5 pt-5 pb-4 border-b border-border/40">
                {/* Mũi tên chứ không phải dấu X: đóng cái này là quay về lưới bàn, không
                    phải thoát ra POS. */}
                <button onClick={onClose} aria-label="Về lưới bàn" className="shrink-0 p-1.5 -ml-1.5 text-text-secondary hover:text-text rounded-lg hover:bg-surface-light">
                    <ArrowLeft size={18} />
                </button>
                <div className="min-w-0 flex-1">
                    <p className="text-text font-black text-base leading-none uppercase tracking-wide truncate">{table.name}</p>
                    <p className="text-[12px] font-bold text-text-secondary mt-1.5 leading-none">
                        {table.rounds.length} đợt từ {openedLabel(table.openedAt)}
                    </p>
                </div>
                <span className="shrink-0 text-[17px] font-black tabular-nums text-primary">{formatVND(table.total)}</span>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
                {table.rounds.map((round, i) => (
                    <div key={round.id || i} className="rounded-[16px] border border-border/40 bg-surface-light/40 px-4 py-3">
                        <div className="flex items-baseline justify-between gap-3 mb-1.5">
                            <span className="text-[12px] font-bold text-text-secondary/70 leading-none">{openedLabel(round.createdAt)}</span>
                            <span className="text-[13px] font-black tabular-nums text-text">{formatVND(round.total)}</span>
                        </div>
                        <div className="flex flex-col gap-0.5">
                            {round.lines.map(l => (
                                <span key={l.name} className="text-[13px] font-bold text-text leading-snug">
                                    {l.qty > 1 && <span className="tabular-nums text-text-secondary">{l.qty} </span>}{l.name}
                                </span>
                            ))}
                        </div>
                        {/* Đợt offline chưa có id trong DB → chưa sửa/xoá/đánh dấu được,
                            ẩn cả hàng nút thay vì để nút bấm vào không có gì xảy ra. */}
                        {round.id && (
                            <div className="flex items-center gap-2 mt-2.5">
                                <button
                                    onClick={() => toggleServed(round)}
                                    className={`flex items-center gap-1.5 px-2.5 ${round.servedAt
                                        ? `${CHIP} bg-success/10 border-success/40 text-success`
                                        : `${CHIP_IDLE} hover:text-text hover:border-primary/40`}`}
                                >
                                    <Check size={12} strokeWidth={3} />
                                    {round.servedAt ? `Ra ${timeStringVN(new Date(round.servedAt))}` : 'Ra món'}
                                </button>
                                <button
                                    onClick={() => handleEditRound(round)}
                                    className={`${CHIP_IDLE} ml-auto px-2.5 hover:text-text hover:border-primary/40`}
                                >
                                    Sửa
                                </button>
                                <button
                                    onClick={() => handleDeleteRound(round)}
                                    aria-label={`Xóa đợt ${openedLabel(round.createdAt)}`}
                                    className={`${CHIP_IDLE} shrink-0 w-[26px] flex items-center justify-center hover:text-danger`}
                                >
                                    <Trash2 size={14} strokeWidth={2.25} />
                                </button>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            <div className="shrink-0 flex gap-2 px-5 py-4 border-t border-border/40">
                <button
                    onClick={onPick}
                    className="flex-1 py-2.5 rounded-[12px] bg-surface-light border border-border/60 text-[12px] font-black uppercase tracking-wider text-text hover:border-primary/40 transition-colors"
                >
                    {orderCount > 0 ? `Gọi thêm ${orderCount} ly` : 'Gọi thêm'}
                </button>
                <button
                    onClick={handlePrint}
                    aria-label="In bill"
                    className="shrink-0 w-[46px] py-2.5 rounded-[12px] bg-surface-light border border-border/60 flex items-center justify-center text-text hover:border-primary/40 transition-colors"
                >
                    <Printer size={16} strokeWidth={2.25} />
                </button>
                <button
                    onClick={handleBill}
                    className="flex-1 py-2.5 rounded-[12px] bg-primary text-bg text-[12px] font-black uppercase tracking-wider hover:bg-primary/90 active:bg-primary/80 transition-colors"
                >
                    Tính tiền
                </button>
            </div>

            {/* Tờ bill. Ẩn trên màn hình, chỉ hiện khi in (@media print ở index.css).
                Chia theo ĐỢT với tiền từng đợt — đó là dữ liệu thật đang có; ghi giá
                từng ly thì phải đoán lại phần chiết khấu đã áp cho đợt, tức là in sai. */}
            <div id="print-bill" className="hidden">
                <div style={{ textAlign: 'center', fontWeight: 700, textTransform: 'uppercase' }}>
                    {selectedAddress?.name || 'Hoá đơn'}
                </div>
                <div style={{ textAlign: 'center', textTransform: 'uppercase' }}>{table.name}</div>
                <div ref={printedAtRef} style={{ textAlign: 'center' }}>{fullLabel(new Date())}</div>
                <div>--------------------------------</div>
                {table.rounds.map((round, i) => (
                    <div key={round.id || i} style={{ marginBottom: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Đợt {i + 1} · {openedLabel(round.createdAt)}</span>
                            <span>{formatVND(round.total)}</span>
                        </div>
                        {round.lines.map(l => (
                            <div key={l.name}>{l.qty} {l.name}</div>
                        ))}
                    </div>
                ))}
                <div>--------------------------------</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                    <span>TỔNG</span>
                    <span>{formatVND(table.total)}</span>
                </div>
                <div style={{ textAlign: 'center', marginTop: 8 }}>Cảm ơn quý khách!</div>
            </div>
        </Dialog>
    )
}
