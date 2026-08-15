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
