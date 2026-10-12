import { formatPackedQty, pack2Of, unitTiersOf } from './inventory'
import type { Row } from '../types/domain'

// Gợi ý chỉ vài gam/ml (vd. 8 g cacao) là nhiễu trong danh sách soạn hàng — bỏ qua.
export const isTrivialQty = (qty: number, unit?: string | null) => (unit === 'g' || unit === 'ml') && qty < 10

// Số kiểu Việt kèm đơn vị. Có quy cách (cfg: pack_size/pack_unit/pack2_*) thì đọc theo đơn vị nhập kho thật ("2 thùng + 3 hộp"),
// không thì "10.000 g". Mọi địa chỉ trong nhóm dùng CHUNG cfg của kho chung nên gọi tên giống nhau. Chỉ để HIỂN THỊ.
export function fmtQty(n: number, unit?: string | null, cfg?: Row | null) {
    return formatPackedQty(n, cfg?.pack_size, cfg?.pack_unit, unit, { pack2: pack2Of(cfg), compact: true })
}

// Làm tròn LÊN theo đơn vị nhập lớn nhất của nguyên liệu (thùng, không có thì hộp/bịch…) — dùng cho "Cần mua": mua nguyên đơn vị,
// không mua lẻ. Chưa khai quy cách thì giữ nguyên số.
export function ceilToBigUnit(qty: number, unit: string, cfg?: Row | null) {
    const { mult } = unitTiersOf(cfg?.pack_size, cfg?.pack_unit, pack2Of(cfg), unit)[0]
    return Math.ceil(qty / mult - 1e-9) * mult
}
