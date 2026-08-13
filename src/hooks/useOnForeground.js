import { useEffect, useRef } from 'react'

// Chạy `cb` khi tab thật sự quay lại foreground.
//
// Năm chỗ trong app từng tự viết đoạn này, và phần lớn dính cùng một bug: trình duyệt
// (nhất là webview trên điện thoại) bắn 'visible' cả khi CHƯA từng 'hidden' — đo được
// một chùm ngay sau lúc tải trang, có cặp cách nhau 13ms. Bản tự viết nào cũng khởi tạo
// `hiddenAt = 0` rồi so `Date.now() - hiddenAt > 30000`, mà mốc 0 là năm 1970 nên lần
// bắn đầu LUÔN vượt ngưỡng: cả một lượt refetch chạy trước khi người dùng kịp chạm gì.
//
// minAwayMs = 0: chạy mọi lần quay lại thật (liếc qua app 2 giây cũng tính).
// minAwayMs > 0: chỉ chạy khi vắng đủ lâu — dùng cho thứ đắt (refetch nguyên trang dữ
// liệu), để chuyển app qua lại không dồn đọc lên đường mạng yếu.
export function useOnForeground(cb, minAwayMs = 0) {
    // cb thường dựng inline ở nơi gọi nên đổi định danh mỗi render — đi qua ref để
    // listener không phải gỡ ra gắn lại liên tục. Cập nhật trong effect (không phải giữa
    // render): listener chỉ nổ từ sự kiện của trình duyệt nên không đời nào đọc trúng bản
    // trễ một nhịp render.
    const cbRef = useRef(cb)
    useEffect(() => { cbRef.current = cb })

    useEffect(() => {
        let hiddenAt = 0
        const onVis = () => {
            if (document.visibilityState !== 'visible') { hiddenAt = Date.now(); return }
            if (!hiddenAt) return          // chưa từng ẩn ⇒ đây không phải "quay lại app"
            const away = Date.now() - hiddenAt
            hiddenAt = 0
            if (away >= minAwayMs) cbRef.current()
        }
        document.addEventListener('visibilitychange', onVis)
        return () => document.removeEventListener('visibilitychange', onVis)
    }, [minAwayMs])
}
