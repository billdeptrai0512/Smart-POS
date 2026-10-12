import { useCallback, useState } from 'react'

/** Tập món đang tick vs đã lưu — dùng cho tick-list "Áp dụng cho món" (topping, chương trình giảm giá). */
export function useProductLinks() {
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [saved, setSaved] = useState<Set<string>>(new Set())

    // Nạp từ server: coi tập này vừa là đang chọn vừa là đã lưu. Ổn định để dùng trong deps của effect.
    const reset = useCallback((ids: Set<string>) => { setSelected(ids); setSaved(ids) }, [])

    return {
        selected,
        dirty: selected.size !== saved.size || [...selected].some(id => !saved.has(id)),
        toggle: (id: string) => setSelected(prev => {
            const next = new Set(prev)
            if (!next.delete(id)) next.add(id)
            return next
        }),
        reset,
        markSaved: () => setSaved(new Set(selected)),
    }
}
