import { useState } from 'react'

// Dòng nào đang mở ô sửa giảm giá + giá trị đang gõ/chọn (chưa bấm Đồng ý) của dòng
// đó — trùng logic ở CartListModal (giỏ chưa gửi) và OrdersList (đơn đã chốt), tách
// ra đây để khỏi lặp 2 lần. preview reset mỗi khi đổi/đóng dòng đang sửa để không
// dính preview của dòng cũ.
export function useDiscountEditing(initialId = null) {
    const [editingId, setEditingId] = useState(initialId)
    const [preview, setPreview] = useState(null)

    function toggleEditing(id) {
        setEditingId(cur => cur === id ? null : id)
        setPreview(null)
    }

    return { editingId, preview, setPreview, toggleEditing }
}
