// Vị trí chèn thanh extras trong grid menu 2 cột của /pos.
// Thanh extras (col-span-2) chèn sau CUỐI HÀNG của card đang active để không
// tạo lỗ hổng grid. Divider (is_divider) chiếm nguyên hàng nên reset cột —
// không thể suy cột từ idx % 2 khi menu có divider.
// Trả về -1 khi không có active (activeIdx < 0).
export function computeExtrasAfterIdx(products, activeIdx) {
    if (activeIdx < 0) return -1
    const colByIdx = []
    let col = 0
    for (const p of products) {
        if (p.is_divider) { colByIdx.push(-1); col = 0 }
        else { colByIdx.push(col); col = col === 0 ? 1 : 0 }
    }
    // Active ở cột trái và item kế tiếp là card cột phải cùng hàng → chèn sau nó.
    return (colByIdx[activeIdx] === 0 && colByIdx[activeIdx + 1] === 1) ? activeIdx + 1 : activeIdx
}
