// Per-field last-write-wins merge cho state đồng bộ đa thiết bị (dùng bởi
// useShiftInventoryState — kiểm kê tồn quầy — và bất kỳ hook nào khác cần
// hoà state local đang gõ dở với 1 bản ghi remote mới về, KHÔNG được ghi đè
// field user đang sửa dở.
//
// Luật: field "dirty" (khác baseline = lần load/lưu gần nhất) → giữ nguyên
// local, baseline giữ nguyên (còn dirty, sẽ tự đẩy lại ở lần autosave sau).
// Field "sạch" → nhận thẳng giá trị remote (vắng mặt ở remote = bị xoá).

export const norm = (v) => (v === undefined || v === null || v === '' ? null : String(v))

export const strField = { eq: norm, present: (v) => norm(v) !== null }
export const boolField = { eq: (v) => !!v, present: (v) => !!v }

// Trả về [merged, nextBaseline, adoptedFromRemoteKeys] — key thứ 3 là những
// field vừa nhận giá trị remote KHÁC baseline cũ (để caller tự xét "đây có
// phải remote vừa đè lên push gần đây của chính mình không" — thời gian tính
// conflict là chuyện riêng của từng field, không thuộc hàm merge thuần này).
export function mergeField(prevMap, baseMap, remoteMap, field) {
    const { eq, present } = field
    const out = {}, nextBase = {}
    const adopted = []
    const keys = new Set([...Object.keys(prevMap), ...Object.keys(baseMap), ...Object.keys(remoteMap)])
    for (const k of keys) {
        const dirty = eq(prevMap[k]) !== eq(baseMap[k])
        if (dirty) {
            if (present(prevMap[k])) out[k] = prevMap[k]
            if (present(baseMap[k])) nextBase[k] = baseMap[k]   // giữ baseline cũ → vẫn dirty → tự đẩy lại
        } else if (present(remoteMap[k])) {
            out[k] = remoteMap[k]; nextBase[k] = remoteMap[k]
            if (eq(remoteMap[k]) !== eq(baseMap[k])) adopted.push(k)
        }
    }
    return [out, nextBase, adopted]
}
