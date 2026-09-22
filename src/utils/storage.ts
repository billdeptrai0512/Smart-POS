// Đọc/ghi JSON trong localStorage có bọc try/catch: private mode chặn, quota đầy, hay
// giá trị hỏng (bản build cũ ghi vào) đều không được ném lỗi làm trắng màn hình.
// Trước đây mỗi context tự bọc lại đúng 2 dòng này.

export function readJSON<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key)
        return raw ? (JSON.parse(raw) as T) : fallback
    } catch { return fallback }
}

export function writeJSON(key: string, val: unknown) {
    try { localStorage.setItem(key, JSON.stringify(val)) } catch { /* quota / private mode */ }
}
