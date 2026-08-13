// Chạy cb khi tab quay lại sau khi ĐI VẮNG ≥30s — không phải mỗi lần 'visible'.
// Trình duyệt/webview bắn 'visible' dồn dập, kể cả khi chưa từng 'hidden' (xem
// useOrdersPoll); fetch thẳng trong handler là vòng lặp chỉ bị ghìm bởi RTT.
// Trả về hàm huỷ đăng ký, dùng thẳng làm cleanup của useEffect.
export function onTabReturn(cb) {
    let lastHidden = 0
    const handler = () => {
        if (document.visibilityState === 'hidden') { lastHidden = Date.now(); return }
        if (Date.now() - lastHidden <= 30_000) return
        lastHidden = Date.now() // dời mốc: chuỗi 'visible' liên tiếp chỉ chạy 1 lần
        cb()
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
}
