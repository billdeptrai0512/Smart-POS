import { useState } from 'react'
import type { Discount } from '../types/domain'

// Dòng nào đang mở ô sửa giảm giá + giá trị đang gõ/chọn (chưa bấm Đồng ý) của dòng
// đó — trùng logic ở CartListModal (giỏ chưa gửi) và OrdersList (đơn đã chốt), tách
// ra đây để khỏi lặp 2 lần. preview reset mỗi khi đổi/đóng dòng đang sửa để không
// dính preview của dòng cũ.
export function useDiscountEditing(initialId: string | null = null) {
    const [editingId, setEditingId] = useState<string | null>(initialId)
    const [preview, setPreview] = useState<Discount | null>(null)

    function toggleEditing(id: string) {
        setEditingId(cur => cur === id ? null : id)
        setPreview(null)
    }

    return { editingId, preview, setPreview, toggleEditing }
}
