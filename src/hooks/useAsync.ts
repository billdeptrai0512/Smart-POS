import { useState, useEffect, useRef, useCallback } from 'react'

// Một nguồn dữ liệu bất đồng bộ với trạng thái RÕ RÀNG: 'loading' (chưa có gì) | 'ready' | 'error'.
// Thay cho cặp useState(null) + cờ loaded tự chế (null vừa là "đang tải" vừa là "lỗi" → UI hiện rỗng giả).
// reload() làm tươi tại chỗ: giữ data cũ, status không quay về 'loading' (không chớp skeleton). Lỗi lần reload giữ data cũ.
// enabled=false → chưa tải (vd. chờ quyền admin). Kết quả của lượt cũ bị bỏ khi enabled/reload đổi hoặc unmount.
export type AsyncState<T> = { status: 'loading' | 'ready' | 'error'; data: T | null; error: unknown }

export function useAsync<T>(fn: () => Promise<T>, enabled = true) {
    const [state, setState] = useState<AsyncState<T>>({ status: 'loading', data: null, error: null })
    const [tick, setTick] = useState(0)
    const fnRef = useRef(fn)
    useEffect(() => { fnRef.current = fn }) // khai báo trước effect tải → luôn gọi bản fn mới nhất
    useEffect(() => {
        if (!enabled) return
        let stale = false
        fnRef.current()
            .then(data => { if (!stale) setState({ status: 'ready', data, error: null }) })
            .catch(error => { if (!stale) setState(s => ({ status: 'error', data: s.data, error })) })
        return () => { stale = true }
    }, [enabled, tick])
    const reload = useCallback(() => setTick(t => t + 1), [])
    return { ...state, reload }
}
