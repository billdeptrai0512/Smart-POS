import { formatPackedQty, pack2Of, r1, unitTiersOf } from './inventory'
import type { Row } from '../types/domain'

export type Draft = Record<string, Record<string, string>>
export interface TransferItem { address_id: string; ingredient: string; unit: string | null; qty: number }

// Bảng soạn kho quản lý nhập tay (trang Soạn kho nhóm): { [addressId]: { [ingredient]: chuỗi ô nhập } } ⇄ dòng phiếu
// [{ address_id, ingredient, unit, qty }]. Ô trống / 0 / không phải số = không phát → không thành dòng phiếu.
// Chấp nhận dấu phẩy thập phân. toQty làm tròn 1 số lẻ — đúng số sẽ được lưu, nên "có số" (toQty > 0) khớp phiếu.
export const toQty = (v: unknown) => r1(String(v).replace(',', '.'))

// Ô nhập gam/ml cho gõ "5kg" / "2 lít" → đổi sang "5000" / "2000" (gọi lúc rời ô). Không khớp hoặc đơn vị khác thì giữ nguyên.
export function parseQtyInput(v: string, unit?: string | null) {
    const m = /^\s*(\d+(?:[.,]\d+)?)\s*(kg|l|lít|lit)\s*$/i.exec(v)
    if (!m || !((unit === 'g') === /^kg$/i.test(m[2])) || (unit !== 'g' && unit !== 'ml')) return v
    return String(r1(Number(m[1].replace(',', '.')) * 1000))
}

// Gợi ý chỉ vài gam/ml (vd. 8 g cacao) là nhiễu trong danh sách chia hàng — không gợi ý, quản lý muốn thì tự gõ.
export const isTrivialQty = (qty: number, unit?: string | null) => (unit === 'g' || unit === 'ml') && qty < 10

// Số kiểu Việt kèm đơn vị. Có quy cách (cfg: pack_size/pack_unit/pack2_*) thì đọc theo đơn vị nhập kho thật ("2 thùng + 3 hộp"),
// không thì "10.000 g". Mọi chi nhánh trong nhóm dùng CHUNG cfg của kho chung nên gọi tên giống nhau. Chỉ để HIỂN THỊ —
// ô nhập và dữ liệu lưu vẫn theo đơn vị gốc.
export function fmtQty(n: number, unit?: string | null, cfg?: Row | null) {
    return formatPackedQty(n, cfg?.pack_size, cfg?.pack_unit, unit, { pack2: pack2Of(cfg), compact: true })
}

// Bỏ phần đầu chung của tên các chi nhánh ("KOPHIN 62 TRƯỜNG SA", "KOPHIN 34B XVNT" → "62 TRƯỜNG SA", "34B XVNT") cho ô nhập
// gọn trên điện thoại. Chỉ bỏ cả từ, và không bỏ nếu sẽ làm trống/trùng tên.
export function shortNames(names: string[]) {
    if (names.length < 2) return names
    const words = names.map(n => n.trim().split(/\s+/))
    let k = 0
    while (words.every(w => w.length > k + 1 && w[k] === words[0][k])) k++
    const short = words.map(w => w.slice(k).join(' '))
    return new Set(short).size === names.length ? short : names
}

export function draftFromItems(items?: { address_id: string; ingredient: string; qty: number }[] | null) {
    const draft: Draft = {}
    for (const it of items || []) (draft[it.address_id] ||= {})[it.ingredient] = String(it.qty)
    return draft
}

export function draftToItems(draft: Draft | null, unitOf: Record<string, string> = {}) {
    const out: TransferItem[] = []
    for (const [address_id, row] of Object.entries(draft || {})) {
        for (const [ingredient, v] of Object.entries(row)) {
            const qty = toQty(v)
            if (qty > 0) out.push({ address_id, ingredient, unit: unitOf[ingredient] ?? null, qty })
        }
    }
    return out
}

// Tổng từng nguyên liệu quản lý định phát cho cả nhóm, 1 lượt quét: { [ingredient]: total }.
export function draftTotals(draft: Draft | null) {
    const totals: Record<string, number> = {}
    for (const row of Object.values(draft || {})) for (const [ing, v] of Object.entries(row)) totals[ing] = (totals[ing] || 0) + toQty(v)
    for (const ing in totals) totals[ing] = r1(totals[ing])
    return totals
}

// Làm tròn LÊN theo đơn vị nhập lớn nhất của nguyên liệu (thùng, không có thì hộp/bịch…) — dùng cho "Cần mua": mua nguyên đơn vị,
// không mua lẻ. Chưa khai quy cách thì giữ nguyên số.
export function ceilToBigUnit(qty: number, unit: string, cfg?: Row | null) {
    const { mult } = unitTiersOf(cfg?.pack_size, cfg?.pack_unit, pack2Of(cfg), unit)[0]
    return Math.ceil(qty / mult - 1e-9) * mult
}
