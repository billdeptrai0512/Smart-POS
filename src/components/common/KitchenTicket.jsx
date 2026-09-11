import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { OFFSCREEN_FRAME_CSS, captureOffscreen, printImageNative } from '../../lib/escposBitmap'

// Phiếu bếp khổ 80mm — mẫu in duy nhất cho cả phiếu tự in lúc tạo đơn (POSContext.doSubmit)
// lẫn nút in lại (KitchenReprintButton). Chỉ có đường in native (máy bếp qua mạng), không có
// bản @media print như PrintBill. Chữ to hơn bill quầy: bếp đọc từ xa.
const BULLET = { paddingLeft: 12, fontSize: 15, fontWeight: 600 }

// eslint-disable-next-line react-refresh/only-export-components -- mẫu phiếu + hàm in chung 1 file (như PrintBill tự chụp chính nó)
function KitchenTicket({ orderNo, tableName, lines, tag }) {
    const where = tableName ? `Bàn: ${tableName}` : 'Mang đi'
    return (
        <div style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 16, lineHeight: 1.35 }}>
            {/* tag: "HỦY #41" (đơn sửa — bếp huỷ phiếu cũ, làm theo phiếu này) / "IN LẠI" — đóng khung
                ở đầu phiếu để bếp nhận ra ngay, không làm trùng món. */}
            {tag && (
                <div style={{ textAlign: 'center', fontSize: 18, fontWeight: 800, border: '2px solid #000', padding: '2px 0', marginBottom: 6 }}>{tag}</div>
            )}
            {/* orderNo null = đơn offline chưa được server cấp số. */}
            <div style={{ textAlign: 'center', fontSize: 24, fontWeight: 800, marginBottom: 6 }}>
                {orderNo != null ? `#${orderNo} | ${where}` : where}
            </div>
            {/* dish/opts/note tách sẵn ở tableLine (orderService). */}
            {lines.map(l => (
                <div key={l.name} style={{ marginTop: 4, wordBreak: 'break-word' }}>
                    <div style={{ fontWeight: 700 }}>{l.qty} ly {l.dish}</div>
                    {l.opts.map((o, i) => <div key={i} style={BULLET}>• {o}</div>)}
                    {l.note && <div style={{ ...BULLET, fontStyle: 'italic' }}>• {l.note}</div>}
                </div>
            ))}
        </div>
    )
}

// Không mount sẵn trong cây app như <PrintBill> — doSubmit chạy fire-and-forget trong context,
// không có component để gắn ref — nên vẽ vào thẻ tạm ngoài màn hình (flushSync: DOM có ngay
// để chụp), chụp, rồi gỡ.
// Không qua printBusy (fail-fast của nút In bill): phiếu bếp tự bắn theo từng đơn, không ai
// đứng bấm lại, nên đơn tạo liền tay phải xếp hàng (onPrinter) chứ không được bị từ chối.
// printerIp đã qua nativePrinterIp ở người gọi.
export function printKitchenTicket(printerIp, ticket) {
    const el = document.createElement('div')
    el.style.cssText = OFFSCREEN_FRAME_CSS
    document.body.appendChild(el)
    const root = createRoot(el)
    flushSync(() => root.render(<KitchenTicket {...ticket} />))
    return printImageNative(captureOffscreen(el).finally(() => { root.unmount(); el.remove() }), 'captureKitchenTicket', printerIp)
}
