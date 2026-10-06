import { r1, computeBalance } from './inventory'
import { lookupByLabel } from './ingredients'

// Danh sách "Chuẩn bị hôm nay" (đưa NVL từ kho dự trữ ra quầy) — dùng chung cho /report
// (card Chuẩn bị hôm nay) và /pos (dải notice + modal xác nhận). Hàm thuần, không đọc state.

// Mốc lịch sử cho dự báo Soạn — 3 tuần gần nhất cùng thứ HÔM NAY, trung bình hoá (xem
// averageIngredientMaps) thay vì chỉ đúng 1 tuần trước để đỡ nhạy với 1 ngày bất thường.
export const HISTORY_OFFSETS_TODAY = [7, 14, 21]
export const HISTORY_OFFSETS_TOMORROW = [6, 13, 20]  // cùng thứ NGÀY MAI

// "Soạn cho hôm nay" coi là đã làm khi Nhập thêm (restock) khác 0 — rỗng/0 = chưa soạn.
export const isPrepFilled = (v) => v !== undefined && v !== null && v !== '' && Number(v) !== 0

// Dự báo = max(tiêu thụ hôm nay tới giờ, cùng thứ tuần trước).
export const forecastFor = (ingredient, usedMap, lastWeekMap) =>
    Math.max(r1(lookupByLabel(ingredient, usedMap)), r1(lookupByLabel(ingredient, lastWeekMap)))

// Item chung: { ingredient, have, need, needPacks, unit, packUnit, fillQty }.
//   have = tồn hiện có ("Còn"); need = target − have ("Cần"); needPacks = quy đổi ra bịch.
export const toPrepItem = (ing, have, target) => {
    const need = r1(target - have)
    if (need <= 0) return null
    const packSize = Number(ing.pack_size) || 0
    const needPacks = packSize > 0 ? Math.ceil(need / packSize) : 0
    return {
        ingredient: ing.ingredient,
        have,
        need,
        needPacks,
        unit: ing.unit,
        packUnit: ing.pack_unit,
        // Lượng đổ vào Nhập thêm khi tick "đã soạn" = số quy đổi nguyên bịch
        // (số bịch × quy cách). Không có quy cách bịch thì dùng đúng "Cần".
        fillQty: needPacks > 0 ? r1(needPacks * packSize) : need,
    }
}

const openingGross = (ing, openingInputs, openingStock) => {
    const oRaw = openingInputs[ing.ingredient]
    return r1(oRaw !== undefined && oRaw !== '' ? oRaw : (openingStock[ing.ingredient] ?? 0))
}

// "Soạn cho hôm nay" — sáng: đưa NVL ra QUẦY đủ cho dự báo bán hôm nay.
// have = tồn quầy ĐẦU ca (opening, đã trừ bì); need = forecast − opening. KHÔNG dùng min_stock.
export function buildPrepTodayList({ ingredientsList, openingInputs, openingStock, warehouseStocks, usedMap, lastWeekUsedMap }) {
    const out = []
    for (const ing of ingredientsList || []) {
        // Đầu kỳ = số cân hộp (gồm bì) → matcha THẬT để bán = trừ bì, kẹp 0. Bì tự khử
        // trong Hao hụt (đầu+cuối cùng gross) nên chỉ trừ ở đây — chỗ cần lượng thật.
        const tare = r1(ing.tare_weight)
        const opening = Math.max(0, r1(openingGross(ing, openingInputs, openingStock) - tare))
        const item = toPrepItem(ing, opening, forecastFor(ing.ingredient, usedMap, lastWeekUsedMap))
        if (item) {
            // Kho tổng hiện có (warehouse_stock thực tế, KHÔNG phải số đầu ca) để rút ra
            // quầy. Lookup theo key trực tiếp; null nếu NVL không theo dõi kho.
            const wh = (warehouseStocks || {})[ing.ingredient]
            item.warehouse = wh != null ? r1(wh) : null
            item.tare = tare // >0 → card hiện "bì X + <thật>"
            out.push(item)
        }
    }
    return out
}

// NVL ĐÃ HẾT ở quầy giữa ca: có bán (used > 0) mà Lý thuyết (Đầu kỳ + Nhập thêm − Sử dụng, trừ bì)
// ≤ 0 (đã đếm Cuối kỳ thì lấy số đếm thay Lý thuyết — đếm thực tế đúng hơn) — kể cả món sáng nay đã soạn. Cần lấy thêm từ kho dự trữ; bấm xác nhận = cộng thêm 1 lần
// vào Nhập thêm, nên Lý thuyết > 0 lại thì tự rớt khỏi danh sách. Món đã "bỏ qua" thì thôi.
// effectiveWarehouseStocks = kho TRƯỚC khi trừ restock ca này (xem useShiftInventoryState).
// ponytail: NVL không có quy cách bịch thì lấy 25% lượng đã dùng (tối thiểu 1) — chưa có cấu hình
// "lượng lấy mỗi lần"; thêm cột cấu hình nếu 25% không hợp.
export function buildDepletedList({ ingredientsList, openingInputs, openingStock, restockInputs, inventoryInputs = {}, skipped, usedMap, warehouseStocks, effectiveWarehouseStocks }) {
    const out = []
    for (const ing of ingredientsList || []) {
        const used = r1(lookupByLabel(ing.ingredient, usedMap))
        if (used <= 0 || skipped[ing.ingredient]) continue
        const oRaw = openingInputs[ing.ingredient]
        const { lyThuyet } = computeBalance({
            restockValue: restockInputs[ing.ingredient],
            openingValue: oRaw === '' ? undefined : oRaw,
            openingFallback: openingStock[ing.ingredient] ?? 0,
            used,
        })
        const counted = inventoryInputs[ing.ingredient]
        const balance = counted !== undefined && counted !== '' ? r1(counted) : lyThuyet
        const tare = r1(ing.tare_weight)
        if (balance - tare > 0) continue

        const packSize = Number(ing.pack_size) || 0
        const need = packSize > 0 ? packSize : Math.max(1, r1(used * 0.25))
        const avail = lookupByLabel(ing.ingredient, effectiveWarehouseStocks, null) // null = không theo dõi kho
        const left = avail == null ? Infinity : r1(Number(avail || 0) - r1(restockInputs[ing.ingredient]))
        const wh = (warehouseStocks || {})[ing.ingredient]
        out.push({
            ingredient: ing.ingredient,
            kind: 'depleted',
            have: balance, // số thật (có thể âm) — thấy được mức lệch so với số đếm
            haveLabel: 'Lý thuyết',
            need,
            needPacks: packSize > 0 ? 1 : 0,
            unit: ing.unit,
            packUnit: ing.pack_unit,
            fillQty: Math.max(0, Math.min(need, left)), // 0 = kho dự trữ cũng hết, không lấy thêm được
            warehouse: wh != null ? r1(wh) : null,
        })
    }
    return out
}

// Gộp 2 nguồn thành 1 danh sách hiển thị: món soạn sáng nay + món hết giữa ca. Món vừa nằm trong
// danh sách soạn (đã tick) vừa đã hết lại → dùng bản "hết" (cần lấy thêm), không coi là xong.
export function mergePrepItems(prepList, depletedList, restockInputs) {
    const dep = new Map(depletedList.map(d => [d.ingredient, d]))
    const inPrep = new Set(prepList.map(p => p.ingredient))
    const items = prepList.map(p => (dep.has(p.ingredient) && isPrepFilled(restockInputs[p.ingredient]) ? dep.get(p.ingredient) : p))
    for (const d of depletedList) if (!inPrep.has(d.ingredient)) items.push(d)
    return items
}

// Đã xử lý? "Bỏ qua" luôn tính xong; đã nhập thêm tính xong, trừ món đang hết (cần lấy lần nữa).
export const isPrepDone = (it, restockInputs, skipped) =>
    !!skipped[it.ingredient] || (it.kind !== 'depleted' && isPrepFilled(restockInputs[it.ingredient]))

// Tổng đã "Nhập kho" (mua qua RestockModal, is_refill trên expenses) hôm nay theo NVL — hiển thị kèm dòng
// "Đã mua hôm nay" để thấy đã mua bao nhiêu (số đó đã nằm trong tồn kho, chỉ là hiển thị thêm).
export function buildTodayBoughtMap(todayExpenses) {
    const m = {}
    for (const e of todayExpenses || []) {
        if (!e.is_refill || e.metadata?.cancelled) continue
        const ing = e.metadata?.ingredient
        const qty = Number(e.metadata?.qty) || 0
        if (!ing || !qty) continue
        m[ing] = (m[ing] || 0) + qty
    }
    Object.keys(m).forEach(k => { m[k] = r1(m[k]) })
    return m
}

// "Bổ sung tồn kho" — cho mai: đủ hàng để mai SOẠN RA BÁN không? Mai bán từ TỔNG tồn = kho tổng + tồn
// quầy cuối ca (số vừa đếm). Thiếu thì mua.
//   have = tổng tồn = (kho tổng − restock) + tồn quầy cuối ca (thật, đã trừ bì).
//   target = max(forecast, min_stock) — mua để đạt mức cao hơn giữa "đủ bán mai" và "sàn tồn tối thiểu".
//   Chưa đếm Cuối kỳ → ước lượng quầy theo Lý thuyết (Đầu kỳ + Nhập thêm − Sử dụng).
//   effectiveWarehouseStocks là kho TRƯỚC khi trừ restock của ca này → phải trừ restock để khỏi đếm 2 lần.
export function buildWarehousePrepList({ ingredientsList, effectiveWarehouseStocks, restockInputs, inventoryInputs, openingInputs, openingStock, usedMap, nextDowUsedMap, todayBoughtMap }) {
    const out = []
    for (const ing of ingredientsList || []) {
        const warehouse = Math.max(0, r1(lookupByLabel(ing.ingredient, effectiveWarehouseStocks || {})))
        const restock = r1(restockInputs[ing.ingredient])
        const counted = inventoryInputs[ing.ingredient]
        let counter
        if (counted !== undefined && counted !== '') {
            counter = r1(counted)
        } else {
            const used = r1(lookupByLabel(ing.ingredient, usedMap))
            counter = Math.max(0, r1(openingGross(ing, openingInputs, openingStock) + restock - used))
        }
        // counter là số cân hộp (gồm bì) → lượng THẬT tại quầy = trừ bì, kẹp 0.
        // Kho tổng (bịch, không hộp) không có bì. Tổng tồn thật = kho + quầy thật.
        const counterReal = Math.max(0, r1(counter - r1(ing.tare_weight)))
        const total = Math.max(0, r1(warehouse - restock + counterReal))
        const target = Math.max(forecastFor(ing.ingredient, usedMap, nextDowUsedMap), r1(ing.min_stock || 0))
        const item = toPrepItem(ing, total, target)
        if (item) {
            // Tách tồn để dễ kiểm kê: kho riêng (đã trừ phần rút ra quầy) + tồn quầy thật.
            // need vẫn tính từ TỔNG tồn ở toPrepItem; have đổi thành tồn quầy để hiển thị.
            item.warehouse = Math.max(0, r1(warehouse - restock))
            item.have = counterReal
            item.boughtToday = lookupByLabel(ing.ingredient, todayBoughtMap)
            out.push(item)
        }
    }
    return out
}
