import { forwardRef, useImperativeHandle, useRef } from 'react'
import { createPortal } from 'react-dom'
import { QRCodeSVG } from 'qrcode.react'
import { formatVND } from '../../utils'
import { vietQrPayload } from '../../utils/vietqr'
import { timeStringVN, dateShortVN, dateFullVN } from '../../utils/dateVN'
import { captureOffscreen, OFFSCREEN_FRAME_CSS } from '../../lib/escposBitmap'

// Tờ bill khổ 80mm dùng chung cho bill theo BÀN (TableDetailModal) và bill ĐƠN LẺ
// mang đi (OrdersList) — một mẫu in duy nhất, tránh 2 thiết kế lệch nhau khi sửa.
// Ẩn trên màn hình, chỉ hiện khi in (@media print + @page trong index.css).
// Bố cục theo phong cách mẫu VietQR compact2: căn giữa, thoáng, đường kẻ mảnh liền thay cho
// gạch đứt, thông tin dạng nhãn trái — giá trị phải, QR đóng khung mảnh + STK/số tiền bên dưới.
const BILL_RULE = { borderTop: '1px solid #000', margin: '10px 0' }
const BILL_COLS = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 58px 26px 58px', gap: 6 }
const CENTER = { textAlign: 'center' }
const MUTED = { fontSize: 11 }

// ponytail: tài khoản nhận chuyển khoản hardcode cùng chỗ với logo/địa chỉ/SĐT (xem comment
// ngay dưới) — đổi tài khoản chỉ cần sửa 2 hằng này; QR tự sinh theo tổng hoá đơn.
const BANK_BIN = '970407' // mã NAPAS của Techcombank (TCB)
const BANK_ACCOUNT = '2274868686'

const fullLabel = (d) => `${timeStringVN(d)} ${dateShortVN(d)}`

// Dòng nhãn trái — giá trị phải (thông tin bàn/giờ lẫn các dòng tổng tiền).
function Row({ label, children, style }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, ...style }}>
            <span style={{ fontWeight: 700 }}>{label}</span>
            <span style={{ textAlign: 'right' }}>{children}</span>
        </div>
    )
}

// tableName truthy → bill theo bàn: "Bàn: <tên>" + "Giờ vào" (openedAt, cố định) + "Giờ ra"
// (thời điểm bấm in, cập nhật lại mỗi lần in). tableName null → đơn mang đi: "Bàn: Mang đi"
// + 1 mốc "Giờ" (openedAt = order.createdAt, cố định, chỉ giờ không kèm ngày — ngày đã có
// ở dòng "Ngày:" chung phía trên rồi).
const PrintBill = forwardRef(function PrintBill(
    { orderNo, tableName, openedAt, staffName, lines, subtotal, discountTotal, discountPct, total, printCount, onPrinted },
    ref
) {
    const printedAtRef = useRef(null)
    const printDateRef = useRef(null)
    const printCountLabelRef = useRef(null)
    const elRef = useRef(null)
    // Hàng đợi chụp ảnh — CẤP INSTANCE (mỗi <PrintBill> giữ chuỗi riêng): lưới an toàn chặn 2
    // lệnh captureImage() chồng lên nhau TRÊN CHÍNH THẺ NÀY (double-tap, "Tính tiền" tự in
    // trong lúc bấm luôn nút In bill riêng). Trước đây phải để cấp module vì mọi <PrintBill>
    // cùng tra chung document.getElementById('print-bill'); giờ mỗi thẻ đã tự giữ elRef riêng
    // (bên dưới) nên 2 thẻ khác nhau không còn đụng chung node để mà cần xếp hàng chung nữa.
    const chainRef = useRef(Promise.resolve())
    const initialPrintCount = (printCount ?? 0) + 1

    // Cập nhật "Giờ ra"/"Ngày"/"In lần" ngay trước khi lấy bản in — dùng chung cho cả
    // print() (web) và captureImage() (native) nên 2 đường in không lệch giờ/lần in.
    //
    // "In lần": onPrinted() (xem TableDetailModal/OrdersList → bumpOrderPrintCount) trả về
    // NGAY một số đồng bộ (không đợi mạng — in phải tức thì) từ cache phía client, còn ghi
    // xuống server chạy ở nền. Không đếm bằng biến cục bộ NGAY TRONG component này vì
    // props.printCount (todayOrders/openTables) không tự cập nhật giữa các lần in — poll đồng
    // bộ không patch cột print_count (xem comment ở incrementOrderPrintCount) — nên mỗi lần
    // PrintBill remount (Nhật ký, mount lại mỗi lần bấm in — xem usePrintArmed) sẽ seed lại
    // đúng 1 số cũ; cache ở tầng gọi (bumpOrderPrintCount) không mất theo component nên tăng
    // đúng qua nhiều lần in liên tiếp.
    function bumpPrintMeta() {
        const now = new Date()
        if (printedAtRef.current) printedAtRef.current.textContent = fullLabel(now)
        if (printDateRef.current) printDateRef.current.textContent = dateFullVN(now)
        const next = onPrinted?.()
        if (printCountLabelRef.current) printCountLabelRef.current.textContent = String(next ?? initialPrintCount)
    }

    useImperativeHandle(ref, () => ({
        // Ghi thẳng vào DOM chứ không qua state: window.print() chạy đồng bộ, React
        // chưa kịp render lại thì hộp in đã chụp mất tờ bill với giờ/lần in cũ.
        print() {
            bumpPrintMeta()
            window.print()
        },
        // App native: chụp #print-bill bằng html2canvas thay vì window.print() — khớp
        // 100% layout web vì dùng chung DOM. Phần tử đang `hidden` (display:none) nên
        // phải tạm hiện lên NGOÀI màn hình (position:fixed, left âm) mới chụp được —
        // html2canvas không đọc được phần tử display:none. Import html2canvas động vì
        // chỉ đường native cần, không kéo vào bundle web.
        async captureImage() {
            bumpPrintMeta()
            // Chuỗi hoá qua chainRef (xem khai báo ở đầu component) — lưới an toàn chặn 2
            // lệnh gọi chồng lên nhau TRÊN CÙNG THẺ NÀY (double-tap, "Tính tiền" tự in trong
            // lúc bấm luôn nút In bill riêng) mutate style/className của elRef.current (đổi
            // rồi khôi phục lại nguyên trạng cũ) chồng lên nhau — lần sau ghi đè giữa lúc lần
            // trước đang chụp/khôi phục thì html2canvas vẫn chạy "thành công" nhưng chụp trúng
            // lúc DOM sai trạng thái (ảnh trắng/lỗi), không ném lỗi gì để bắt. Nối vào
            // .then/.catch (không await ngay) để lần gọi SAU luôn đợi lần TRƯỚC xong (dù thành
            // công hay lỗi) mới bắt đầu, thay vì chạy song song.
            const run = async () => {
                const el = elRef.current
                if (!el) return null
                const prevClassName = el.className
                const prevStyle = el.getAttribute('style')
                el.className = ''
                // color:#000 bắt buộc — chữ trong PrintBill không tự set màu, vốn ăn theo
                // default (đen trên nền trắng khi in thật qua @media print). Chụp ở ngữ cảnh
                // MÀN HÌNH thường (@media print không áp dụng) thì chữ kế thừa màu SÁNG từ
                // theme tối của app → trắng trên nền trắng tôi ép, chữ vô hình dù đường viền
                // (inline #000 riêng) vẫn thấy.
                // font/cỡ chữ/line-height PHẢI set ở đây: html2canvas render theo style MÀN HÌNH,
                // không áp @media print — thiếu thì bill in từ app native ăn font + 16px mặc định
                // của body (cao hơn bản in qua trình duyệt ~25%, tốn giấy mà không ai thấy vì hai
                // đường in không bao giờ chạy cùng lúc). Giữ khớp với khối #print-bill trong
                // index.css để hai đường in ra cùng một tờ.
                el.style.cssText = `${OFFSCREEN_FRAME_CSS} font-family:Arial, Helvetica, sans-serif; font-size:12px; line-height:1.3;`
                try {
                    return await captureOffscreen(el)
                } finally {
                    el.className = prevClassName
                    if (prevStyle) el.setAttribute('style', prevStyle)
                    else el.removeAttribute('style')
                }
            }
            const result = chainRef.current.then(run, run)
            chainRef.current = result.catch(() => {})
            return result
        },
    }), [])

    // Portal thẳng ra document.body — #print-bill vốn nằm sâu trong cây DOM của modal/thẻ
    // (sau header, danh sách món, nút bấm...). CSS in chỉ ẩn phần còn lại bằng
    // visibility:hidden (vẫn chiếm chỗ layout), trong khi position:fixed của #print-bill
    // lại không được Chromium tôn trọng khi phần tử nằm sâu như vậy lúc in — nó bị đẩy
    // xuống đúng bằng chiều cao phần nội dung ẩn phía trước, ra khoảng trắng lớn đầu bill.
    // Portal ra body loại bỏ hẳn mọi tổ tiên/nội dung đứng trước nó.
    return createPortal((
        <div id="print-bill" ref={elRef} className="hidden">
            {/* ponytail: logo/địa chỉ/SĐT hardcode cho 1 quán (Kôphin) — addresses
                chưa có cột logo/address/phone (xem AddressContext), nên chưa thể tự
                set theo từng địa chỉ. Sau này mỗi khách cần tự upload logo + nhập
                địa chỉ/SĐT riêng cho quán của họ thay vì dùng chung khối này. */}
            <div style={{ ...CENTER, fontWeight: 800, fontSize: 18, letterSpacing: 0.5 }}>KÔPHiN COFFEE</div>
            {/* <div style={{ textAlign: 'center', fontWeight: 800, fontSize: 9, letterSpacing: 3, marginTop: 2 }}>COFFEE TO GO</div> */}
            <div style={{ ...CENTER, ...MUTED, marginTop: 4 }}>
                <div style={{ whiteSpace: 'nowrap' }}>Địa chỉ: 31 Nguyễn Thị Tươi,</div>
                <div style={{ whiteSpace: 'nowrap' }}>P. Tân Đông Hiệp, TPHCM</div>
                <div>Điện thoại: 0794 466 366</div>
            </div>
            <div style={BILL_RULE} />
            <div style={{ ...CENTER, fontWeight: 800, fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Hoá đơn thanh toán
            </div>
            <div style={{ ...CENTER, ...MUTED, marginTop: 2 }}>
                {orderNo != null && <div>Số: HĐ{String(orderNo).padStart(6, '0')}</div>}
                <div>Ngày: <span ref={printDateRef}>{dateFullVN(new Date())}</span></div>
            </div>
            <div style={{ marginTop: 10 }}>
                <Row label="Bàn">{tableName || 'Mang đi'}</Row>
                {tableName ? (
                    <>
                        <Row label="Giờ vào">{fullLabel(new Date(openedAt))}</Row>
                        <Row label="Giờ ra"><span ref={printedAtRef}>{fullLabel(new Date())}</span></Row>
                    </>
                ) : (
                    <Row label="Giờ">{timeStringVN(new Date(openedAt))}</Row>
                )}
                {staffName && <Row label="Nhân viên">{staffName}</Row>}
                <Row label="In lần"><span ref={printCountLabelRef}>{initialPrintCount}</span></Row>
            </div>
            <div style={BILL_RULE} />
            <div style={{ ...BILL_COLS, fontWeight: 700, marginBottom: 2 }}>
                <span style={{ whiteSpace: 'nowrap' }}>Tên hàng</span>
                <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>Đơn giá</span>
                <span style={{ textAlign: 'right' }}>SL</span>
                <span style={{ textAlign: 'center' }}>TT</span>
            </div>
            {lines.map(l => {
                // Dòng có giảm giá riêng → cột Đơn giá tách 2 tầng: giá gốc gạch ngang ở
                // trên, giá thực khách trả (đã trừ phần giảm của riêng dòng này, chia đều
                // cho SL) ở dưới. TT = thành tiền THỰC (đã trừ giảm giá dòng) — TIỀN HÀNG/
                // GIẢM GIÁ/TỔNG THANH TOÁN ở cuối bill tính riêng từ subtotal/discountTotal
                // cấp đơn (props), không cộng lại từ TT nên không bị đếm giảm giá 2 lần.
                const discounted = l.discountAmount > 0
                const netUnit = discounted ? Math.round((l.unitPrice * l.qty - l.discountAmount) / l.qty) : l.unitPrice
                return (
                    <div key={l.key} style={BILL_COLS}>
                        {/* Tên món + extras gộp chung 1 cột — extras bám sát ngay dưới tên, không
                            phụ thuộc chiều cao cột Đơn giá (2 dòng khi có giảm giá riêng dòng). */}
                        <div>
                            <div style={{ wordBreak: 'break-word' }}>{l.name}</div>
                            {l.extras.map(e => (
                                <div key={e.id} style={{ fontStyle: 'italic', fontSize: 10, whiteSpace: 'nowrap' }}>• {e.name}</div>
                            ))}
                        </div>
                        <span style={{ textAlign: 'right' }}>
                            {discounted ? (
                                <>
                                    <span style={{ display: 'block', textDecoration: 'line-through', fontSize: 9, opacity: 0.65 }}>{formatVND(l.unitPrice)}</span>
                                    <span style={{ display: 'block' }}>{formatVND(netUnit)}</span>
                                </>
                            ) : formatVND(l.unitPrice)}
                        </span>
                        <span style={{ textAlign: 'right' }}>{l.qty}</span>
                        <span style={{ textAlign: 'right' }}>{formatVND(l.unitPrice * l.qty - l.discountAmount)}</span>
                    </div>
                )
            })}
            <div style={BILL_RULE} />
            <Row label="TIỀN HÀNG">{formatVND(subtotal)}</Row>
            {discountTotal > 0 && <Row label={`GIẢM GIÁ (${discountPct}%)`}>-{formatVND(discountTotal)}</Row>}
            <Row label="TỔNG THANH TOÁN" style={{ fontWeight: 800, fontSize: 14, marginTop: 4 }}>{formatVND(total)}</Row>
            {/* QR chuyển khoản (VietQR, tự sinh — không cần mạng lúc in). Bọc flex chứ không
                margin:auto trên chính <svg>: html2canvas chụp svg block-level bị bóp méo tỉ lệ,
                QR in ra quét không được. */}
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
                <div style={{ padding: 6, border: '1px solid #000' }}>
                    <QRCodeSVG value={vietQrPayload({ bin: BANK_BIN, account: BANK_ACCOUNT, amount: total })} size={140} />
                </div>
            </div>
            <div style={{ ...CENTER, ...MUTED, marginTop: 6 }}>Techcombank - {BANK_ACCOUNT}</div>
            <div style={{ ...CENTER, ...MUTED }}>Số tiền: {formatVND(total)}</div>
            <div style={{ ...CENTER, marginTop: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>
                Xin cảm ơn và hẹn gặp lại quý khách!
            </div>
            <div style={{ ...CENTER, ...MUTED, fontStyle: 'italic' }}>Powered by KOPOS</div>
        </div>
    ), document.body)
})

export default PrintBill
