import { discountToPercent } from './money'

// Đơn giá 1 dòng bill in: order_items không lưu giá theo dòng, nên tự tính lại từ giá
// món/topping ĐANG hiệu lực trong menu (products/productExtras) — đúng cho đơn vừa tạo
// trong ca này, giá chưa kịp đổi. Dùng chung cho bill theo bàn (TableDetailModal) và bill
// đơn mang đi lẻ (OrdersList). it: { productId, extraIds }.
export function priceLineFor(it, products, productExtras) {
    const product = products.find(p => p.id === it.productId)
    const extras = (it.extraIds || [])
        .map(id => (productExtras[it.productId] || []).find(e => e.id === id))
        .filter(Boolean)
    const unitPrice = (product?.price || 0) + extras.reduce((s, e) => s + (e.price || 0), 0)
    return { name: product?.name || 'Món đã xoá', extras, unitPrice }
}

// Phần tổng cuối bill in, khớp với các dòng món phía trên: dòng có giảm giá riêng đã in sẵn
// TT đã trừ giảm, nên TIỀN HÀNG = gộp − giảm theo dòng (= tổng cột TT), còn GIẢM GIÁ chỉ là
// phần giảm cả đơn KHÔNG nằm trên dòng nào (đơn cũ, trước khi có giảm theo dòng). Trước đây
// TIỀN HÀNG in giá gốc rồi trừ tiếp toàn bộ giảm kèm 1 % bình quân tự suy (2 trà sữa -25% +
// 1 bạc xỉu đồng giá 10k → "GIẢM GIÁ (32%)") — khách thấy như trừ 2 lần. % chỉ hiện khi tính
// ngược lại đúng y số tiền giảm.
export function billFooter(lines, subtotal, discountTotal) {
    const lineDiscount = lines.reduce((s, l) => s + (l.discountAmount || 0), 0)
    const goods = subtotal - lineDiscount
    const orderDiscount = Math.max(0, discountTotal - lineDiscount)
    const { pct, exact } = discountToPercent(goods, orderDiscount)
    return { goods, orderDiscount, discountLabel: exact ? `GIẢM GIÁ (${pct}%)` : 'GIẢM GIÁ' }
}

// Đơn giá/thành tiền từng dòng cho bill in theo BÀN (TableDetailModal): gộp mọi round của
// bàn (không tách theo round — bill không còn hiện nhãn "Đợt N"), 1 món gọi ở hai đợt khác
// nhau chỉ ra một dòng. Dòng có giảm giá riêng KHÔNG gộp qua các đợt khác — gộp sẽ chia
// trung bình discount qua nhiều ly khác giá nhau (vd 1 ly full giá + 1 ly miễn phí gộp
// thành 2 ly "nửa giá" trên bill, sai với thực tế). extras giữ riêng mảng (không nhét vào
// chuỗi tên như tableLineName) — bill in mỗi topping xuống một dòng "* tên" riêng, gộp
// trùng phải tính theo tổ hợp món+topping.
export function tablePriceLines(rounds, products, productExtras) {
    const out = []
    for (const round of rounds) {
        for (const it of round.items) {
            const { name, extras, unitPrice } = priceLineFor(it, products, productExtras)
            const discountAmount = it.discountAmount || 0
            const baseKey = `${name}::${extras.map(e => e.id).sort().join(',')}`
            const hit = discountAmount === 0 ? out.find(l => l.key === baseKey) : null
            if (hit) { hit.qty += it.qty; continue }
            out.push({
                key: discountAmount === 0 ? baseKey : `${baseKey}::${round.id}::${out.length}`,
                name, extras, qty: it.qty, unitPrice, discountAmount,
            })
        }
    }
    return out
}
