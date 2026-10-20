import { useState, type ReactNode } from 'react'
import type { Row } from '../../types/domain'
import ProduceBatchSheet from './ProduceBatchSheet'

// Nút mở sheet Sản xuất của 1 thành phẩm (giữ state mở/đóng) — dùng ở Chuẩn bị hôm nay và Kiểm kê.
export default function ProduceButton({ product, suggestedQty, onDone, className, children }: {
    product: Row; suggestedQty?: number; onDone?: () => void; className: string; children: ReactNode
}) {
    const [open, setOpen] = useState(false)
    return (
        <>
            <button type="button" onClick={() => setOpen(true)} className={className}>{children}</button>
            {open && <ProduceBatchSheet product={product} suggestedQty={suggestedQty} onClose={() => setOpen(false)} onDone={onDone} />}
        </>
    )
}
