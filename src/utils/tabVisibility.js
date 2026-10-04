// Chạy cb khi tab quay lại sau khi ĐI VẮNG ≥30s — không phải mỗi lần 'visible'.
// Trình duyệt/webview bắn 'visible' dồn dập, kể cả khi chưa từng 'hidden' (xem
// useOrdersPoll); fetch thẳng trong handler là vòng lặp chỉ bị ghìm bởi RTT.
// Trả về hàm huỷ đăng ký, dùng thẳng làm cleanup của useEffect.
export function onTabReturn(cb) {
    // Mốc khởi tạo = lúc đăng ký (không phải 0): 'visible' đầu tiên mà chưa từng 'hidden'
    // (trang tải ở nền / webview) không được tính là "đã đi vắng" → khỏi refetch cả loạt.
    let lastHidden = Date.now()
    const handler = () => {
        if (document.visibilityState === 'hidden') { lastHidden = Date.now(); return }
        if (Date.now() - lastHidden <= 30_000) return
        lastHidden = Date.now() // dời mốc: chuỗi 'visible' liên tiếp chỉ chạy 1 lần
        cb()
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
}
