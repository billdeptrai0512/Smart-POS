import { r1 } from './inventory'

export type Draft = Record<string, Record<string, string>>
export interface TransferItem { address_id: string; ingredient: string; unit: string | null; qty: number }

// Bảng soạn kho quản lý nhập tay (trang Soạn kho nhóm): { [addressId]: { [ingredient]: chuỗi ô nhập } } ⇄ dòng phiếu
// [{ address_id, ingredient, unit, qty }]. Ô trống / 0 / không phải số = không phát → không thành dòng phiếu.
// Chấp nhận dấu phẩy thập phân. toQty làm tròn 1 số lẻ — đúng số sẽ được lưu, nên "có số" (toQty > 0) khớp phiếu.
export const toQty = (v: unknown) => r1(String(v).replace(',', '.'))

// Số kiểu Việt ("10.000") kèm đơn vị; g/ml đủ lớn thì ghi thêm kg/lít trong ngoặc ("10.000 g (10 kg)") vì chủ quán nghĩ bằng kg dễ hơn.
// Chỉ để HIỂN THỊ — ô nhập và dữ liệu lưu vẫn theo đơn vị gốc.
const vn = (n: number) => Number(n).toLocaleString('vi-VN')
const BIG_UNIT: Record<string, string> = { g: 'kg', ml: 'lít' }
export function fmtQty(n: number, unit?: string | null) {
    const base = `${vn(n)} ${unit ?? ''}`.trim()
    return unit && BIG_UNIT[unit] && Math.abs(n) >= 1000 ? `${base} (${vn(Math.round(n / 10) / 100)} ${BIG_UNIT[unit]})` : base
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
