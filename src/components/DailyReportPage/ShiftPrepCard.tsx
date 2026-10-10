import { Fragment } from 'react'
import type { PrepItem } from '../../utils/prepToday'
import { Check, X, RotateCcw } from 'lucide-react'
import { ingredientLabel } from '../../utils/ingredients'
import { formatPackCount, formatPackedQty } from '../../utils/inventory'

// Viên thuốc CTA dùng chung cho cả 2 card (Lấy / Mua) — màu theo trạng thái do từng nơi ghép thêm.
const PILL = 'shrink-0 min-h-[44px] min-w-[124px] px-3 flex items-center justify-center gap-1 rounded-xl text-[12px] font-black transition'

// Danh sách checklist dùng chung cho 2 dải notice: "Chuẩn bị hôm nay" (/pos — đưa hàng ra quầy) và
// "Bổ sung tồn kho" (/inventory — đi chợ đắp kho). Mỗi dòng có viên thuốc CTA (Lấy = tick, Mua = nhập kho)
// + so sánh "Còn" (tồn hiện có) vs "Cần" (lượng cần thêm) + quy đổi ra bịch. Chỉ vẽ phần danh sách —
// header/khung do caller (NoticeSheet) lo; tick/bỏ qua do parent giữ.
//
// items: [{ ingredient, have, need, needPacks, unit, packUnit, pack2 }]
interface Props {
    items?: PrepItem[]
    checked?: Record<string, boolean>
    onToggle?: (ingredient: string) => void
    onRestock?: (ingredient: string, qty: number) => void
    onOpen?: (ingredient: string) => void
    skipped?: Record<string, boolean>
    onSkip?: (ingredient: string) => void
    haveLabel?: string
    emptyTitle?: string
    emptyHint?: string
    packVerb: string
}

// PrepItem có nhiều số tuỳ chọn (mỗi nguồn danh sách điền một phần) — chuẩn hoá về 0 một lần ở đầu
// để phần vẽ không phải `?? 0` từng chỗ.
const withDefaults = (it: PrepItem) => ({
    ...it,
    have: it.have ?? 0, need: it.need ?? 0, needPacks: it.needPacks ?? 0, tare: it.tare ?? 0, minStock: it.minStock ?? 0,
    forecast: it.forecast ?? 0, boughtToday: it.boughtToday ?? 0, restock: it.restock ?? 0,
})
type Item = ReturnType<typeof withDefaults>

export default function ShiftPrepCard({
    items = [],
    checked = {},
    onToggle,
    // Khi set → viên thuốc mỗi dòng thành nút "Mua N …" mở phiếu Nhập kho (card "Bổ sung tồn
    // kho"). Bấm nút "Mua N …" gọi onRestock(ingredient, qty). Không set → giữ hành vi tick như cũ.
    onRestock,
    // Chỉ dùng cùng onRestock: bấm tên nguyên liệu → onOpen(ingredient) (mở trang chi tiết).
    onOpen,
    // Khi set (card Soạn) → mỗi dòng thêm nút "bỏ qua" (✕): đánh dấu "đã xem, không cần
    // lấy" để vẫn hoàn tất ca; bấm lại (↩) để hủy. skipped: { [ingredient]: true }.
    skipped = {},
    onSkip,
    // Nhãn cho số tồn quầy ở dòng phụ: card Soạn = tồn quầy đầu ca ("Quầy"),
    // card Chuẩn bị kho = tồn quầy cuối ca.
    haveLabel,
    emptyTitle,
    emptyHint = '',
    // Động từ CTA: "Lấy" (soạn ra quầy) / "Mua" (đi chợ). Dòng lớn = "<packVerb> N bịch"
    // nếu có pack_size, không thì "<packVerb> X <đơn vị>".
    packVerb,
}: Props) {
    const skipMode = typeof onSkip === 'function'
    // Card Soạn gộp 2 nguồn: món hết giữa ca (cần lấy ngay) lên đầu, món soạn đầu ca xuống dưới; chỉ chia
    // tiêu đề khi cả 2 nhóm cùng có mặt. Trong mỗi nhóm, món còn việc lên trước, món đã xử lý (tick/bỏ qua)
    // xuống đáy (card Mua cũng vậy: món đã mua đủ `done` xuống đáy). Sort ổn định nên thứ tự còn lại giữ nguyên.
    const rows = items.map(withDefaults)
    const isUrgent = (it: Item) => it.kind === 'depleted'
    const isHandled = (it: Item) => !!checked[it.ingredient] || !!skipped[it.ingredient] || !!it.done
    const ordered = [...rows].sort((a, b) => Number(isUrgent(b)) - Number(isUrgent(a)) || Number(isHandled(a)) - Number(isHandled(b)))
    const split = skipMode && ordered.some(isUrgent) && ordered.some(it => !isUrgent(it))

    return (
            items.length === 0 ? (
                <div className="py-3 text-center flex flex-col items-center gap-1">
                    <span className="text-[13px] font-bold text-success">{emptyTitle}</span>
                    {emptyHint && <span className="text-[11px] text-text-secondary">{emptyHint}</span>}
                </div>
            ) : (
                <div className="flex flex-col">
                    {ordered.map((it, i) => {
                        const isDone = !!checked[it.ingredient]
                        const isSkipped = !isDone && !!skipped[it.ingredient]
                        const muted = isDone || isSkipped || !!it.done // đã xử lý (nhập, bỏ qua hoặc đã mua đủ) → mờ + gạch ngang
                        // Số lượng theo quy cách đóng gói ("2 hộp", "1 bịch + 350 g"), cùng kiểu với viên CTA; không có quy cách thì đơn vị gốc.
                        const fmt = (n: number) => formatPackedQty(n, it.packSize, it.packUnit, it.unit, { compact: true, pack2: it.pack2 })
                        // Kho không đủ cho NHU CẦU hôm nay (kho < Cần) → tô đỏ: soạn hết kho vẫn thiếu, cần mua thêm.
                        // Chỉ đọc ở nhánh skipMode (card Soạn) bên dưới, và dòng "Tồn kho" ở đó chỉ vẽ khi chưa xử lý.
                        const shortfall = it.warehouse != null && it.warehouse < it.need

                        const name = (
                            <span className={`block text-[14px] font-bold leading-tight ${muted ? 'text-text-dim line-through' : 'text-text'}`}>
                                {ingredientLabel(it.ingredient)}
                            </span>
                        )
                        const details = (
                            <div className="text-[11px] text-text-dim">
                                {/* Cam = hành động (CTA "Mua"), đỏ = vấn đề (kho dưới mức tối thiểu), xanh = đã mua đủ, xám = thông tin. */}
                                {it.warehouse != null && (
                                    <span className="block">
                                        Tồn kho cuối kỳ: <span className={it.done ? 'text-success font-bold' : it.warehouse < it.minStock ? 'text-danger font-bold' : ''}>{fmt(it.warehouse)}</span>
                                    </span>
                                )}
                                {it.minStock > 0 && <span className="block">Tồn kho cần ít nhất: {fmt(it.minStock)}</span>}
                            </div>
                        )
                        // Các dòng dưới cùng nằm NGOÀI hàng có viên thuốc → chạy hết chiều ngang, không bị bẻ dòng bởi viên.
                        // Món đã mua đủ thì viên "Đã mua N" đã nói số đã mua — khỏi lặp.
                        const showBought = it.boughtToday > 0 && !it.done
                        const tail = showBought && (
                            <div className="text-[11px] text-text-dim">
                                <span className="block text-success">Đã mua hôm nay: {fmt(it.boughtToday)}</span>
                            </div>
                        )

                        // Không cấu hình pack_size (mua rời, vd Ống hút) → đếm theo đơn vị gốc.
                        const qty = it.done ? '' : it.needPacks > 0 ? formatPackCount(it.needPacks, it.packUnit, it.pack2) : `${it.need} ${it.unit}`
                        const ctaLabel = `${packVerb} ${qty}`

                        // Card Soạn (skipMode): nút bỏ qua (✕/↩) nằm ngay cạnh tên nguyên liệu; viên thuốc ở cuối dòng
                        // vừa là CTA "Lấy N …" vừa là trạng thái tick (cam → xanh "✓ Đã lấy N …" → xám "Bỏ qua"). Viên là span
                        // (không phải button) để tránh lồng button trong button; bấm cả dòng vẫn tick/bỏ tick.
                        if (skipMode) {
                            const groupStart = split && (i === 0 || isUrgent(ordered[i - 1]) !== isUrgent(it))
                            // Dải full-bleed (bù px-5 + pt-1 của NoticeSheet); nhóm gấp nền đỏ nhạt, nhóm thường nền xám.
                            // Không kèm số đếm: tiến độ đã có ở "x/y" trên header sheet.
                            const heading = groupStart && (
                                <div className={`-mx-5 px-5 py-1.5 text-[12px] font-black uppercase tracking-wide ${i === 0 ? '-mt-1' : 'mt-3'} ${isUrgent(it) ? 'bg-danger/10 text-danger' : 'bg-surface-light text-text-secondary'}`}>
                                    {isUrgent(it) ? 'Cần lấy ngay' : 'Soạn đầu ca'}
                                </div>
                            )
                            return (
                                <Fragment key={it.ingredient}>
                                {heading}
                                <button
                                    type="button"
                                    onClick={() => onToggle?.(it.ingredient)}
                                    className={`flex items-start gap-3 py-2.5 border-b border-border/20 last:border-0 text-left active:scale-[0.99] transition ${isSkipped ? 'opacity-60' : ''}`}
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1">
                                            <span className={`text-[14px] font-bold leading-tight ${muted ? 'text-text-dim line-through' : 'text-text'}`}>
                                                {ingredientLabel(it.ingredient)}
                                            </span>
                                            {/* Đã tick xong thì không còn gì để "bỏ qua" — ẩn ✕; món đã bỏ qua vẫn giữ ↩ hoàn tác. */}
                                            {!isDone && (
                                                <span
                                                    onClick={(e) => { e.stopPropagation(); onSkip?.(it.ingredient) }}
                                                    title={isSkipped ? 'Hoàn tác bỏ qua' : 'Bỏ qua — không cần lấy'}
                                                    className={`shrink-0 w-6 h-6 flex items-center justify-center rounded-lg active:scale-95 transition ${isSkipped ? 'text-primary hover:bg-primary/10' : 'text-text-dim hover:text-text hover:bg-border/40'}`}
                                                >
                                                    {isSkipped ? <RotateCcw size={13} /> : <X size={13} />}
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-[11px] text-text-dim mt-0.5">
                                            {/* Tồn kho chỉ để biết còn đủ hàng mà lấy; xử lý xong rồi thì số đó chỉ còn gây nhiễu. */}
                                            {!muted && it.warehouse != null && (
                                                <span className={`block ${shortfall ? 'text-danger font-bold' : ''}`}>
                                                    Tồn kho: {fmt(it.warehouse)}
                                                </span>
                                            )}
                                            {it.reason && <span className="block text-warning font-bold">{it.reason}</span>}
                                            <span className="block">
                                                {it.haveLabel || haveLabel}: {it.tare > 0 && <>{it.tare} + </>}{fmt(it.have)}
                                            </span>
                                            {/* Món đã xử lý → kể tiếp hành trình trong ca (mỗi số một dòng) để số cuối ca không đứng một mình.
                                                Món còn chờ lấy chỉ có dòng đầu ca (đã đếm 0 mà nút vẫn "Lấy" thì "cuối ca" gây mâu thuẫn). */}
                                            {muted && it.restock > 0 && <span className="block">Đã lấy thêm: +{fmt(it.restock)}</span>}
                                            {muted && it.counted != null && <span className="block">Tồn quầy cuối ca: {it.tare > 0 && <>{it.tare} + </>}{fmt(it.counted)}</span>}
                                        </div>
                                    </div>
                                    <span className={`self-center ${PILL} ${
                                        isDone ? 'bg-success/15 text-success'
                                            : isSkipped ? 'bg-border/30 text-text-dim'
                                                : 'bg-primary/10 text-primary'}`}>
                                        {isDone && <Check size={13} strokeWidth={3} />}
                                        {isDone ? `Đã ${packVerb.toLowerCase()} ${fmt(it.restock)}` : isSkipped ? 'Bỏ qua' : ctaLabel}
                                    </span>
                                </button>
                                </Fragment>
                            )
                        }

                        // Còn lại là card "Chuẩn bị tồn kho" (không skipMode): bấm nút "Mua N …" mở phiếu Nhập kho,
                        // bấm tên mở chi tiết nguyên liệu (onOpen; không set → cũng mở phiếu Nhập kho).
                        const restock = () => onRestock?.(it.ingredient, it.needPacks > 0 ? it.needPacks : it.need)
                        const open = onOpen ? () => onOpen(it.ingredient) : restock
                        return (
                            <div key={it.ingredient} className="py-2.5 border-b border-border/20 last:border-0">
                                {/* Lưới 2×2: hàng 1 = tên | nút (cùng một đường giữa); hàng 2 = 2 dòng trái | 2 dòng phải (cùng đỉnh).
                                    min-h-8! thấp hơn PILL (44px) để nút cân với tên. */}
                                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5">
                                    <button type="button" onClick={open} className="min-w-0 text-left active:scale-[0.99] transition">
                                        {name}
                                    </button>
                                    {it.done ? (
                                        <span className={`${PILL} min-h-8! justify-self-end bg-success/15 text-success`}>
                                            <Check size={13} strokeWidth={3} />
                                            Đã mua {fmt(it.boughtToday)}
                                        </span>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={restock}
                                            title="Nhập kho"
                                            className={`${PILL} min-h-8! justify-self-end bg-primary/10 text-primary active:scale-95`}
                                        >
                                            {ctaLabel}
                                        </button>
                                    )}
                                    <button type="button" onClick={open} className="min-w-0 self-start text-left active:scale-[0.99] transition">
                                        {details}
                                    </button>
                                    <div className="self-start text-[11px] text-text-dim text-right">
                                        <span className="block">
                                            {haveLabel}: <span className="whitespace-nowrap">{it.tare > 0 && <>{it.tare} + </>}{fmt(it.have)}</span>
                                        </span>
                                        {it.forecast > 0 && <span className="block">Dự báo sử dụng: <span className="whitespace-nowrap">{fmt(it.forecast)} / ngày</span></span>}
                                    </div>
                                </div>
                                {tail && <button type="button" onClick={open} className="block w-full text-left active:scale-[0.99] transition">{tail}</button>}
                            </div>
                        )
                    })}
                </div>
            )
    )
}
