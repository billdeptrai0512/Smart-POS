import { useState, useEffect } from 'react'
import { Plus, X } from 'lucide-react'
import { useCart } from '../../contexts/CartContext'
import { useAddress } from '../../contexts/AddressContext'
import { useAuth } from '../../contexts/AuthContext'
import { formatVND } from '../../utils'
import { dateShortVN, isSameDayVN } from '../../utils/dateVN'
import { Dialog } from '../common/ModalShell'
import TableDetailModal from './TableDetailModal'

// Chọn bàn — chỉ mở được từ CheckoutBar, tức chỉ ở địa chỉ dine_in.
//
// Lưới bàn = danh sách bàn cố định của địa chỉ (addresses.tables, quản lý tạo sẵn một
// lần) chồng lên các bàn ĐANG có khách (nhóm đơn chưa tính tiền, xem fetchOpenTables).
// Bàn nào chưa gọi món thì hiện "Trống". Chọn bàn xong thì đợt đang dựng rơi vào bàn
// đó, nên khách ngồi tiếp gọi thêm là gọi đúng vào bàn cũ.
//
// ponytail: lưới thẳng, không phải sơ đồ theo vị trí thật. Đổi sang sơ đồ khi quán cần
// nhìn ra bàn nào ngoài sân / bàn nào trong nhà, chứ không chỉ bàn nào còn trống.

// MỌI thẻ cùng một chiều cao. Bàn gọi nhiều loại thì cắt dòng, không kéo thẻ dài ra —
// lưới cao thấp lởm chởm nhìn không ra bàn nào với bàn nào.
const CARD_H = 'h-[148px]'
// Số DÒNG tối đa phần món chiếm được. Nhiều hơn thì dòng cuối nhường chỗ cho "+N món
// nữa" — cắt mà không nói là giấu tiền của khách.
const CARD_LINES = 3
export default function TableModal({ onClose }) {
    const { tableName, setTableName, openTables, refreshTables, orderCount, showError } = useCart()
    const { selectedAddress, setTables } = useAddress()
    const { isManager, isAdmin } = useAuth()
    const [newName, setNewName] = useState('')
    const [adding, setAdding] = useState(false)
    // Tên bàn đang mở chi tiết. Giữ TÊN chứ không giữ object bàn: openTables đổi sau
    // mỗi lần xoá đợt, ôm object cũ là modal hiện số tiền đã chết.
    const [detail, setDetail] = useState(null)

    // Bàn có thể vừa được mở/đóng ở máy khác — đồng bộ lại mỗi lần mở modal thay vì
    // nuôi thêm một kênh realtime. Component chỉ mount khi mở (xem CheckoutBar) nên
    // effect này = "mở modal", và lúc đóng không còn render rỗng ăn theo mỗi cú chạm món.
    useEffect(() => { refreshTables() }, [refreshTables])

    const canEdit = isManager || isAdmin
    // Set: tên bàn là React key, danh sách trùng tên (ghi tay vào DB) sẽ làm hỏng lưới.
    const configured = [...new Set(selectedAddress?.tables || [])]
    // Bàn có khách nhưng không nằm trong danh sách cố định (mở tạm trong ca, hoặc vừa
    // bị xoá khỏi danh sách) vẫn phải hiện — nếu không thì tiền của bàn đó biến mất
    // khỏi màn hình dù đơn vẫn còn trong DB.
    const adHoc = [...new Set([...openTables.map(t => t.name), tableName].filter(n => n && !configured.includes(n)))]
    const names = [...configured, ...adHoc]
    const statsOf = (name) => openTables.find(t => t.name === name) || { name, total: 0, rounds: [], openedAt: null, lines: [] }
    const detailTable = detail ? openTables.find(t => t.name === detail) : null

    // Bàn không bị cắt theo ngày (xem fetchOpenTables), nên bàn quên chưa tính tiền có
    // thể là của hôm qua. Giờ mở KHÔNG hiện trên thẻ — cái nhân viên cần đọc là danh
    // sách món; chỉ ngày khác hôm nay mới đáng cảnh báo (thẻ hiện "Từ 08/08"), còn
    // giờ đầy đủ để lại trong hộp xác nhận tính tiền.
    const staleLabel = (iso) => (iso && !isSameDayVN(new Date(iso), new Date())) ? `Từ ${dateShortVN(new Date(iso))}` : null

    function pick(name) {
        setTableName(name)
        onClose()
    }

    async function handleOpenNew(e) {
        e.preventDefault()
        const name = newName.trim()
        if (!name) return
        setNewName('')
        setAdding(false)
        // Gõ "bàn 1" khi đã có "Bàn 1" thì dùng lại bàn cũ — khác hoa thường mà tách
        // thành hai bàn là mất một nửa tiền của khách.
        const target = names.find(n => n.toLowerCase() === name.toLowerCase()) || name
        // Quản lý gõ tên = tạo sẵn luôn vào danh sách cố định (lần sau khỏi gõ lại).
        // Kể cả tên đang tồn tại dưới dạng bàn tạm — "Thêm" phải đưa được nó vào danh
        // sách, không thì bàn tạm không bao giờ lên cố định được.
        // Nhân viên không có quyền ghi addresses → bàn chỉ sống trong ca, vẫn gắn được
        // vào đơn bình thường.
        if (canEdit && !configured.includes(target)) {
            try { await setTables(selectedAddress.id, [...configured, target]) }
            catch (err) { showError(err, 'Lưu danh sách bàn') }
        }
        pick(target)
    }

    async function handleRemove(name) {
        try { await setTables(selectedAddress.id, configured.filter(n => n !== name)) }
        catch (err) { showError(err, 'Xoá bàn') }
    }

    return (
        <Dialog onClose={onClose} panelClassName="w-full max-w-md mx-4 max-h-[85dvh] flex flex-col bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="shrink-0 flex items-center justify-between px-5 pt-5 pb-4 border-b border-border/40">
                <p className="text-text font-black text-base leading-none">Chọn bàn</p>
                <button onClick={onClose} className="p-1.5 text-text-secondary hover:text-text rounded-lg hover:bg-surface-light">
                    <X size={16} />
                </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {orderCount > 0 && (
                    <p className="text-[12px] font-bold text-warning bg-warning/10 border border-warning/40 rounded-[14px] px-4 py-3">
                        Đang có {orderCount} ly chưa gửi — sẽ tính cho bàn bạn chọn ở đây.
                    </p>
                )}

                <div className="grid grid-cols-2 gap-3">
                    {/* Đơn mang đi ở quán có bàn: bỏ chọn bàn, đơn về lại dạng không nhãn. */}
                    <button
                        onClick={() => pick('')}
                        className={`${CARD_H} rounded-[20px] border p-3.5 flex flex-col items-center justify-center transition-colors ${!tableName ? 'bg-primary/5 border-primary' : 'bg-surface border-border/60 hover:border-primary/40'}`}
                    >
                        <span className="text-[13px] font-black uppercase tracking-wide text-text">Mang đi</span>
                    </button>

                    {names.map(name => {
                        const t = statsOf(name)
                        const active = name === tableName
                        const busy = t.rounds.length > 0
                        const stale = staleLabel(t.openedAt)
                        const pending = t.rounds.filter(r => !r.servedAt).length
                        const shown = t.lines.length > CARD_LINES ? t.lines.slice(0, CARD_LINES - 1) : t.lines
                        return (
                            <div
                                key={name}
                                className={`${CARD_H} relative rounded-[20px] border p-3.5 flex flex-col gap-1.5 transition-colors ${active ? 'bg-primary/5 border-primary' : busy ? 'bg-surface border-border/60' : 'bg-surface/50 border-border/40'}`}
                            >
                                {/* Chỉ xoá được bàn trống: bàn còn khách mà biến mất khỏi lưới
                                    thì không ai bấm tính tiền cho nó được nữa. */}
                                {canEdit && !busy && configured.includes(name) && (
                                    <button
                                        onClick={() => handleRemove(name)}
                                        aria-label={`Xoá ${name}`}
                                        className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center text-text-secondary/60 hover:text-danger transition-colors"
                                    >
                                        <X size={14} strokeWidth={3} />
                                    </button>
                                )}
                                {/* Thẻ = tờ hoá đơn đang chạy. Tên và tổng cùng một hàng vì đó là
                                    hai thứ hay đọc chung; danh sách món ở dưới, cắt bớt cho vừa
                                    khung — bản đầy đủ nằm trong modal chi tiết.
                                    Bàn có khách: chạm = mở chi tiết (đọc/sửa/thu tiền đều ở đó).
                                    Bàn trống: không có gì để đọc, chạm = chọn bàn luôn. */}
                                <button onClick={() => busy ? setDetail(name) : pick(name)} className="flex-1 min-h-0 w-full overflow-hidden text-left flex flex-col gap-1 focus:outline-none">
                                    <span className="w-full flex items-baseline justify-between gap-2">
                                        <span className={`text-[13px] font-black uppercase tracking-wide line-clamp-1 ${busy || active ? 'text-text' : 'text-text-secondary'}`}>{name}</span>
                                        {busy && <span className="shrink-0 text-[14px] font-black tabular-nums text-primary">{formatVND(t.total)}</span>}
                                    </span>
                                    {stale && <span className="text-[11px] font-bold text-warning">{stale}</span>}
                                    {busy ? (
                                        <span className="flex flex-col gap-0.5">
                                            {/* Số lượng chỉ hiện khi > 1 — "1" lặp ở mọi dòng là nhiễu.
                                                Cùng quy ước với dòng Nhật ký (buildLastOrderFromCart). */}
                                            {shown.map(l => (
                                                <span key={l.name} className="text-[12px] font-bold text-text-secondary leading-snug line-clamp-1">
                                                    {l.qty > 1 && <span className="tabular-nums text-text">{l.qty} </span>}{l.name}
                                                </span>
                                            ))}
                                            {t.lines.length > shown.length && (
                                                <span className="text-[12px] font-bold text-text-secondary/60 leading-snug">+{t.lines.length - shown.length} món nữa</span>
                                            )}
                                        </span>
                                    ) : (
                                        <span className="text-[12px] font-bold text-text-secondary/50">Trống</span>
                                    )}
                                    {/* Còn đợt chưa bưng ra — thứ duy nhất trên lưới mà nhân
                                        viên cần thấy trước khi bấm vào bàn. Chi tiết đợt nào
                                        thì mở thẻ ra xem. */}
                                    {pending > 0 && (
                                        <span className="mt-auto text-[11px] font-black uppercase tracking-wide text-warning">
                                            {pending} đợt chưa ra món
                                        </span>
                                    )}
                                </button>
                            </div>
                        )
                    })}

                    {/* Ô "+" là một thẻ trong lưới, không phải form riêng ở trên: bấm mới
                        mở ô gõ tên, để lưới không bị một hàng input chiếm chỗ mãi. */}
                    {adding ? (
                        <form onSubmit={handleOpenNew} className={`${CARD_H} rounded-[20px] border border-primary bg-primary/5 p-3 flex flex-col justify-center gap-2`}>
                            <input
                                type="text"
                                autoFocus
                                value={newName}
                                onChange={e => setNewName(e.target.value)}
                                onBlur={() => { if (!newName.trim()) setAdding(false) }}
                                placeholder={canEdit ? 'Tên bàn' : 'Bàn tạm'}
                                className="w-full min-w-0 bg-surface-light border border-border/60 rounded-[12px] px-3 py-2 text-[13px] font-black uppercase tracking-wide text-text placeholder:text-text-secondary/50 placeholder:normal-case placeholder:tracking-normal placeholder:font-medium focus:outline-none focus:border-primary/40 transition-colors"
                            />
                            <button
                                type="submit"
                                disabled={!newName.trim()}
                                className="w-full py-2 rounded-[12px] bg-primary text-bg text-[12px] font-black uppercase tracking-wider disabled:opacity-50 hover:bg-primary/90 active:bg-primary/80 transition-colors"
                            >
                                Thêm
                            </button>
                        </form>
                    ) : (
                        <button
                            onClick={() => setAdding(true)}
                            className={`${CARD_H} w-full rounded-[20px] border border-dashed border-border/60 p-4 flex flex-col items-center justify-center gap-1.5 text-text-secondary hover:text-text hover:border-primary/40 transition-colors`}
                        >
                            <Plus size={20} strokeWidth={3} />
                            <span className="text-[12px] font-black uppercase tracking-wide">{canEdit ? 'Thêm bàn' : 'Bàn tạm'}</span>
                        </button>
                    )}
                </div>

                {names.length === 0 && !canEdit && (
                    <p className="text-center text-[13px] font-medium text-text-secondary py-2">
                        Chưa có bàn nào. Nhờ quản lý tạo danh sách bàn.
                    </p>
                )}
            </div>

            {/* Tra lại openTables mỗi lần render: xoá một đợt trong modal chi tiết phải
                thấy tiền bàn tụt xuống ngay tại đó. Bàn không còn (máy khác vừa tính tiền
                / đợt cuối vừa bị xoá) → không tìm thấy → modal tự đóng. */}
            {detailTable && (
                <TableDetailModal
                    table={detailTable}
                    tableNames={names}
                    onClose={() => setDetail(null)}
                    onPick={() => pick(detail)}
                />
            )}
        </Dialog>
    )
}
