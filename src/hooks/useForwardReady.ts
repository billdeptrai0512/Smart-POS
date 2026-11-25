import { useEffect, useState } from 'react'

// Guide đọc số (Nhật ký, Đối chiếu, Tổng hao hụt): `active` được chừng này ms thì true → dải giải thích nhường chỗ cho dải bấm sang bước sau.
const FORWARD_MS = 2500

export function useForwardReady(active: boolean) {
    const [ready, setReady] = useState(false)
    useEffect(() => {
        if (!active) return
        const t = setTimeout(() => setReady(true), FORWARD_MS)
        return () => clearTimeout(t)
    }, [active])
    return active && ready
}
