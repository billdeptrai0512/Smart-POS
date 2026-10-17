import { Fragment, useState, type ReactNode } from 'react'
import type { PrepItem } from '../../utils/prepToday'
import { Check, X, RotateCcw, Pencil, ChevronUp, ChevronDown } from 'lucide-react'
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
    // qty = số nhân viên sửa tay (không có → theo gợi ý). có onToggle → dòng CHƯA tick có chip ✎ mở ô sửa số; dòng đã lấy thì ẩn ✎ (bỏ tick rồi sửa lại).
    onToggle?: (ingredient: string, qty?: number) => void
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
    // Có onToggle = dạng checklist "Lấy/Soạn" (Chuẩn bị hôm nay, Soạn cho ngày mai); có thêm onSkip thì mới có nút ✕ bỏ qua.
    const skipMode = typeof onToggle === 'function'
    // Card Soạn gộp 2 nguồn: món hết giữa ca (cần lấy ngay) lên đầu, món soạn đầu ca xuống dưới; chỉ chia
    // tiêu đề khi cả 2 nhóm cùng có mặt. Trong mỗi nhóm, món còn việc lên trước, món đã xử lý (tick/bỏ qua)
    // xuống đáy (card Mua cũng vậy: món đã mua đủ `done` xuống đáy). Sort ổn định nên thứ tự còn lại giữ nguyên.
    // "Đã xử lý" chỉ chốt lúc mở card: tick xong dòng đứng yên (đổi màu tại chỗ) để không nhảy dưới ngón tay,
    // đóng sheet mở lại mới xuống đáy.
    const rows = items.map(withDefaults)
    const isUrgent = (it: Item) => it.kind === 'depleted'
    const [handledOnOpen] = useState(() => new Set(
        rows.filter(it => checked[it.ingredient] || skipped[it.ingredient] || it.done).map(it => it.ingredient)))
    // Card Mua: trong nhóm còn việc, hết hẳn (kho = 0) lên trước, rồi dưới tối thiểu, rồi còn lại — mắt đọc từ gấp nhất xuống.
    const low = (it: Item) => it.warehouse != null && it.warehouse < it.minStock
    const tier = (it: Item) => skipMode ? 0 : it.warehouse === 0 ? 0 : low(it) ? 1 : 2
    const ordered = [...rows].sort((a, b) => Number(isUrgent(b)) - Number(isUrgent(a)) || Number(handledOnOpen.has(a.ingredient)) - Number(handledOnOpen.has(b.ingredient)) || tier(a) - tier(b))
    const [editing, setEditing] = useState<string | null>(null)
    const [draft, setDraft] = useState(0) // số đang sửa (đơn vị gốc) của dòng `editing`
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
                            <span className={`block text-[15px] font-bold leading-tight ${muted ? 'text-text-dim line-through' : 'text-text'}`}>
                                {ingredientLabel(it.ingredient)}
                            </span>
                        )
                        // Nhãn nhỏ trên, số dưới (lưới 2×2 ở card Mua): mắt quét cột số nhanh hơn dòng "Nhãn: số".
                        // Cam = hành động (CTA "Mua"), đỏ = vấn đề (kho dưới mức tối thiểu), xanh = đã mua đủ, trắng = thông tin.
                        const field = (label: string, value: ReactNode, right = false, valueCls = 'text-text-secondary') => (
                            <div className={`min-w-0 ${right ? 'text-right' : ''}`}>
                                <span className="block text-[10px] font-bold uppercase tracking-wide text-text-dim">{label}</span>
                                <span className={`block text-[13px] font-bold tabular-nums ${valueCls}`}>{value}</span>
                            </div>
                        )
                        // Vạch trái 2 mức: hết hẳn (kho = 0) đỏ đậm, chỉ dưới tối thiểu đỏ nhạt — để món gấp nổi lên trong danh sách toàn đỏ.
                        const edge = it.done ? 'border-transparent' : it.warehouse === 0 ? 'border-danger' : low(it) ? 'border-danger/40' : 'border-transparent'
                        const warehouseCls = it.done ? 'text-success' : low(it) ? 'text-danger' : 'text-text'
                        // Các dòng dưới cùng nằm NGOÀI hàng có viên thuốc → chạy hết chiều ngang, không bị bẻ dòng bởi viên.
                        // Món đã mua đủ thì viên "Đã mua N" đã nói số đã mua — khỏi lặp.
                        const showBought = it.boughtToday > 0 && !it.done
                        const tail = showBought && (
                            <div className="text-[11px] text-text-dim">
                                <span className="block text-success">Đã mua hôm nay: {fmt(it.boughtToday)}</span>
                            </div>
                        )

                        // Không cấu hình pack_size (mua rời, vd Ống hút) → đếm theo đơn vị gốc.
                        // Có phiếu chia của kho tổng → nút lấy đúng số kho đã soạn (không phải số theo dự báo).
                        const qty = it.done ? '' : it.sent ? fmt(it.sent) : it.needPacks > 0 ? formatPackCount(it.needPacks, it.packUnit, it.pack2) : `${it.need} ${it.unit}`
                        const ctaLabel = `${packVerb} ${qty}`

                        // Card Soạn (skipMode): nút bỏ qua (✕/↩) nằm ngay cạnh tên nguyên liệu; viên thuốc ở cuối dòng
                        // vừa là CTA "Lấy N …" vừa là trạng thái tick (cam → xanh "✓ Đã lấy N …" → xám "Bỏ qua"). Viên là span
                        // (không phải button) để tránh lồng button trong button; bấm cả dòng vẫn tick/bỏ tick.
                        if (skipMode) {
                            const groupStart = split && (i === 0 || isUrgent(ordered[i - 1]) !== isUrgent(it))
                            // Dòng cuối của nhóm: dải tiêu đề nhóm sau đã là ranh giới, bỏ gạch chân để khỏi thành 2 đường liền nhau.
                            const groupEnd = split && !!ordered[i + 1] && isUrgent(ordered[i + 1]) !== isUrgent(it)
                            // Dải full-bleed (bù px-5 + pt-1 của NoticeSheet); nhóm gấp nền đỏ nhạt, nhóm thường nền xám.
                            // Không kèm số đếm: tiến độ đã có ở "x/y" trên header sheet.
                            const heading = groupStart && (
                                <div className={`-mx-5 px-5 py-1.5 text-[12px] font-black uppercase tracking-wide ${i === 0 ? '-mt-1' : ''} ${isUrgent(it) ? 'bg-danger/10 text-danger' : 'bg-surface-light text-text-secondary'}`}>
                                    {isUrgent(it) ? 'Cần lấy ngay' : 'Soạn đầu ca'}
                                </div>
                            )
                            // Đang sửa số: dòng thành div (ô nhập không được nằm trong button) và ô nhập thay cho chip ✎ + viên CTA.
                            const ed = editing === it.ingredient && !isDone
                            const meta = qtyMeta(it, draft)
                            const shown = Math.round(draft / meta.step * 10) / 10
                            const Row = (ed ? 'div' : 'button') as 'button'
                            return (
                                <Fragment key={it.ingredient}>
                                {heading}
                                <Row
                                    {...(ed ? {} : { type: 'button' as const, onClick: () => onToggle?.(it.ingredient) })}
                                    className={`flex items-start gap-3 py-2.5 ${groupEnd ? '' : 'border-b border-border/20'} last:border-0 text-left active:scale-[0.99] transition ${isSkipped ? 'opacity-60' : ''}`}
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1">
                                            <span className={`text-[14px] font-bold leading-tight ${muted ? 'text-text-dim line-through' : 'text-text'}`}>
                                                {ingredientLabel(it.ingredient)}
                                            </span>
                                            {/* Đã tick xong thì không còn gì để "bỏ qua" — ẩn ✕; món đã bỏ qua vẫn giữ ↩ hoàn tác. */}
                                            {!isDone && onSkip && (
                                                <span
                                                    onClick={(e) => { e.stopPropagation(); onSkip(it.ingredient) }}
                                                    title={isSkipped ? 'Hoàn tác bỏ qua' : 'Bỏ qua — không cần lấy'}
                                                    className={`shrink-0 w-6 h-6 flex items-center justify-center rounded-lg active:scale-95 transition ${isSkipped ? 'text-primary hover:bg-primary/10' : 'text-text-dim hover:text-text hover:bg-border/40'}`}
                                                >
                                                    {isSkipped ? <RotateCcw size={13} /> : <X size={13} />}
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-[11px] text-text-dim mt-0.5">
                                            {/* Tồn kho chỉ để biết còn đủ hàng mà lấy; xử lý xong rồi thì số đó chỉ còn gây nhiễu. */}
                                            {(!muted || it.taken != null) && it.warehouse != null && (
                                                <span className="block">
                                                    Tồn kho: <span className={(muted ? it.warehouse === 0 : shortfall) ? 'text-danger font-bold' : ''}>{fmt(it.warehouse)}</span>
                                                </span>
                                            )}
                                            {/* Kho tổng đã chia số này cho chi nhánh; nhận khác số đó (đã Nhập thêm xong) → cam để đối chiếu. */}
                                            {it.sent != null && (
                                                <span className={`block ${isDone && it.restock !== it.sent ? 'text-warning font-bold' : ''}`}>
                                                    Kho tổng chia: {fmt(it.sent)}{it.sentPacked && ` ✓ đã soạn${it.by ? ` bởi ${it.by}` : ''}`}{isDone && it.restock !== it.sent && ` · nhận ${fmt(it.restock)}`}
                                                </span>
                                            )}
                                            {isDone && it.kind !== 'depleted' && it.sent == null && it.fillQty != null && (it.taken ?? it.restock) !== it.fillQty && (
                                                <span className="block text-warning font-bold">Gợi ý: {fmt(it.fillQty)}</span>
                                            )}
                                            {it.reason && <span className="block text-warning font-bold">{it.reason}</span>}
                                            {ed && meta.over && <span className="block text-danger font-bold">Vượt kho — chỉ lấy tối đa {fmt(meta.out)}</span>}
                                            <span className="block">
                                                {it.haveLabel || haveLabel}: {it.tare > 0 && <>{it.tare} + </>}{fmt(it.have)}
                                            </span>
                                            {/* Món đã xử lý → kể tiếp hành trình trong ca (mỗi số một dòng) để số cuối ca không đứng một mình.
                                                Món còn chờ lấy chỉ có dòng đầu ca (đã đếm 0 mà nút vẫn "Lấy" thì "cuối ca" gây mâu thuẫn). */}
                                            {isDone && it.by && it.sent == null && <span className="block">Đã soạn bởi {it.by}</span>}
                                            {muted && it.restock > 0 && <span className="block">Đã lấy thêm: +{fmt(it.restock)}</span>}
                                            {muted && it.counted != null && <span className="block">Tồn quầy cuối ca: {it.tare > 0 && <>{it.tare} + </>}{fmt(it.counted)}</span>}
                                        </div>
                                    </div>
                                    {ed ? (
                                        // [ 1 hộp ✓ ] ▲▼ — ✓ trong ô, ▲▼ ngoài ô. Chạm ra ngoài / Esc = đóng, chưa ✓ thì chưa ghi gì.
                                        <div
                                            className="self-center shrink-0 flex items-center gap-1.5"
                                            onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setEditing(null) }}
                                            onKeyDown={(e) => { if (e.key === 'Escape') setEditing(null) }}
                                        >
                                            <div className={`flex items-center w-[132px] h-11 pl-3 pr-1 gap-1 rounded-xl bg-surface border ${meta.over ? 'border-danger' : 'border-border/60 focus-within:border-primary/60'}`}>
                                                <input
                                                    type="number" inputMode="decimal" min={0} step="any" autoFocus
                                                    value={shown}
                                                    style={{ width: `${String(shown).length}ch` }}
                                                    onChange={(e) => setDraft(Math.max(0, Math.round(Number(e.target.value) * meta.step * 10) / 10))}
                                                    className="min-w-0 bg-transparent text-left text-[16px] font-black outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                                                />
                                                <span className="text-[12px] text-text-secondary">{meta.unitLabel}</span>
                                                <button
                                                    type="button" title={`${packVerb} ${fmt(meta.out)}`} disabled={meta.out <= 0}
                                                    onMouseDown={(e) => e.preventDefault()} // giữ focus ở ô nhập để onBlur không đóng trước khi click
                                                    onClick={() => { setEditing(null); onToggle?.(it.ingredient, meta.out) }}
                                                    className="ml-auto shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-primary disabled:opacity-40 active:scale-95 transition"
                                                >
                                                    <Check size={20} strokeWidth={3} />
                                                </button>
                                            </div>
                                            <div className="flex flex-col gap-0.5">
                                                {[1, -1].map(dir => (
                                                    <button
                                                        key={dir} type="button" title={dir > 0 ? 'Tăng' : 'Giảm'}
                                                        onMouseDown={(e) => e.preventDefault()}
                                                        onClick={() => setDraft(Math.max(0, Math.round((draft + dir * meta.step) * 10) / 10))}
                                                        className="w-8 h-[21px] flex items-center justify-center rounded-md bg-surface border border-border/40 text-text-secondary active:scale-95"
                                                    >
                                                        {dir > 0 ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    ) : <>
                                    {!isDone && !isSkipped && (
                                        <span
                                            onClick={(e) => { e.stopPropagation(); setEditing(it.ingredient); setDraft(it.sent ?? it.fillQty ?? it.need) }}
                                            title="Sửa số lượng"
                                            className="self-center shrink-0 w-11 h-11 flex items-center justify-center rounded-xl border active:scale-95 transition text-text-dim border-border/40 hover:text-text"
                                        >
                                            <Pencil size={16} />
                                        </span>
                                    )}
                                    <span className={`self-center ${PILL} ${
                                        isDone ? 'bg-success/15 text-success'
                                            : isSkipped ? 'bg-border/30 text-text-dim'
                                                : 'bg-primary/10 text-primary'}`}>
                                        {isDone && <Check size={13} strokeWidth={3} />}
                                        {isDone ? `Đã ${packVerb.toLowerCase()} ${fmt(it.taken ?? it.restock)}` : isSkipped ? 'Bỏ qua' : ctaLabel}
                                    </span>
                                    </>}
                                </Row>
                                </Fragment>
                            )
                        }

                        // Còn lại là card "Chuẩn bị tồn kho" (không skipMode): bấm nút "Mua N …" mở phiếu Nhập kho,
                        // bấm tên mở chi tiết nguyên liệu (onOpen; không set → cũng mở phiếu Nhập kho).
                        const restock = () => onRestock?.(it.ingredient, it.needPacks > 0 ? it.needPacks : it.need)
                        const open = onOpen ? () => onOpen(it.ingredient) : restock
                        return (
                            <div key={it.ingredient} className={`p-3 mb-3.5 last:mb-0 rounded-[14px] bg-surface-light ring-1 ring-border/30 border-l-2 ${edge} ${it.done ? `opacity-60 ${ordered[i - 1]?.done ? '' : 'mt-5'}` : ''}`}>
                                {/* Lưới 2×2: hàng 1 = tên | nút (cùng một đường giữa); hàng 2 = 2 dòng trái | 2 dòng phải (cùng đỉnh).
                                    min-h-8! thấp hơn PILL (44px) để nút cân với tên. */}
                                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5">
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
                                    <button type="button" onClick={open} className="col-span-2 grid grid-cols-2 gap-x-3 gap-y-2.5 pt-2.5 border-t border-border/30 text-left active:scale-[0.99] transition">
                                        {it.warehouse != null ? field('Tồn kho cuối kỳ', fmt(it.warehouse), false, warehouseCls) : <div />}
                                        {field(haveLabel || '', <>{it.tare > 0 && <>{it.tare} + </>}{fmt(it.have)}</>, true)}
                                        {it.minStock > 0 ? field('Tồn kho tối thiểu', fmt(it.minStock)) : <div />}
                                        {it.forecast > 0 ? field('Ngày mai sử dụng', fmt(it.forecast), true) : <div />}
                                    </button>
                                </div>
                                {tail && <button type="button" onClick={open} className="block w-full text-left active:scale-[0.99] transition">{tail}</button>}
                            </div>
                        )
                    })}
                </div>
            )
    )
}

// Đơn vị bước (1 bịch, hoặc 1 đơn vị gốc nếu không có quy cách) + số thực sự ghi (kẹp theo kho) của ô sửa số.
// ponytail: chỉ 1 ô số (bịch có thể lẻ), chưa tách ô "bịch + lẻ g" của pack2 — thêm khi nhân viên cần.
function qtyMeta(it: Item, draft: number) {
    const packed = !!it.packSize && it.packSize > 0
    const over = it.warehouse != null && draft > it.warehouse
    return { step: packed ? it.packSize! : 1, unitLabel: packed ? (it.packUnit || 'bịch') : (it.unit || ''), over, out: over ? it.warehouse! : draft }
}
