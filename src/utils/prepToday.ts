import { r1, computeBalance, pack2Of, type UsageMap } from './inventory'
import { lookupByLabel } from './ingredients'
import type { Row } from '../types/domain'

/** Ô nhập theo ingredient: '' = để trống (khác 0). */
export type Inputs = Record<string, string | number | undefined>

export interface PrepItem {
    ingredient: string
    have?: number
    need?: number
    needPacks?: number
    unit?: string
    packSize?: number
    packUnit?: string | null
    pack2?: ReturnType<typeof pack2Of>
    fillQty?: number
    // buildPrepTodayList
    reason?: string
    warehouse?: number | null
    tare?: number
    restock?: number
    counted?: number
    // buildDepletedList
    kind?: 'depleted'
    haveLabel?: string
    low?: boolean
    taken?: number // đã lấy bao nhiêu trong lần mở modal này (món hết giữa ca, giữ lại làm dòng "Đã lấy")
    // Bổ sung tồn kho (buildHubBuyItems)
    done?: boolean
    forecast?: number
    minStock?: number
    boughtToday?: number
    // buildPrepTodayList: kho tổng đã chốt chia cho chi nhánh này hôm nay (+ đã tick "soạn xong" chưa)
    sent?: number
    sentPacked?: boolean
    by?: string // tên người đã xác nhận soạn (kho tổng → "Soạn cho ngày mai"), hiện cạnh dòng "đã soạn"
}

/** Phiếu chia hàng kho tổng → chi nhánh (hôm nay): { [ingredient]: { qty, packed } }. */
export type SentMap = Record<string, { qty: number; packed: boolean; by?: string }>

// Danh sách "Chuẩn bị hôm nay" (đưa NVL từ kho dự trữ ra quầy) — dùng chung cho /report
// (card Chuẩn bị hôm nay) và /pos (dải notice + modal xác nhận). Hàm thuần, không đọc state.

// Mốc lịch sử cho dự báo Soạn — 3 tuần gần nhất cùng thứ HÔM NAY, trung bình hoá (xem
// averageIngredientMaps) thay vì chỉ đúng 1 tuần trước để đỡ nhạy với 1 ngày bất thường.
export const HISTORY_OFFSETS_TODAY = [7, 14, 21]
export const HISTORY_OFFSETS_TOMORROW = [6, 13, 20]  // cùng thứ NGÀY MAI
// Dự phòng khi chưa có lịch sử cùng thứ (chi nhánh mới): 7 ngày gần nhất. Dự báo hôm nay bỏ hôm nay (chưa hết ngày);
// dự báo ngày mai lấy luôn hôm nay — thường là ngày bán duy nhất của chi nhánh vừa mở.
export const RECENT_OFFSETS_TODAY = [1, 2, 3, 4, 5, 6, 7]
export const RECENT_OFFSETS_TOMORROW = [0, 1, 2, 3, 4, 5, 6]

// "Soạn cho hôm nay" coi là đã làm khi Nhập thêm (restock) khác 0 — rỗng/0 = chưa soạn.
export const isPrepFilled = (v: unknown) => v !== undefined && v !== null && v !== '' && Number(v) !== 0

// Dự báo = max(tiêu thụ hôm nay tới giờ, cùng thứ tuần trước).
const forecastFor = (ingredient: string, usedMap: UsageMap, lastWeekMap: UsageMap) =>
    Math.max(r1(lookupByLabel(ingredient, usedMap)), r1(lookupByLabel(ingredient, lastWeekMap)))

// Item chung: { ingredient, have, need, needPacks, unit, packUnit, pack2, fillQty }.
//   have = tồn hiện có ("Còn"); need = target − have ("Cần"); needPacks = quy đổi ra bịch.
export const toPrepItem = (ing: Row, have: number, target: number): PrepItem | null => {
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
        packSize,
        packUnit: ing.pack_unit,
        pack2: pack2Of(ing),
        // Lượng đổ vào Nhập thêm khi tick "đã soạn" = số quy đổi nguyên bịch
        // (số bịch × quy cách). Không có quy cách bịch thì dùng đúng "Cần".
        fillQty: needPacks > 0 ? r1(needPacks * packSize) : need,
    }
}

const openingGross = (ing: Row, openingInputs: Inputs, openingStock: UsageMap) => {
    const oRaw = openingInputs[ing.ingredient]
    return r1(oRaw !== undefined && oRaw !== '' ? oRaw : (openingStock[ing.ingredient] ?? 0))
}

// "Soạn cho hôm nay" — sáng: đưa NVL ra QUẦY đủ cho dự báo bán hôm nay.
// have = tồn quầy ĐẦU ca (opening, đã trừ bì); need = max(forecast, min_counter_stock) − opening.
// Ngày dự báo thấp vẫn đưa ra đủ sàn quầy; min_stock (ngưỡng KHO) không chặn việc rút hàng.
// Có phiếu chia hàng của kho tổng (`sent`) → món đó LUÔN có dòng (kể cả dự báo không cần) và tick đổ đúng số kho đã soạn
// vào Nhập thêm thay vì số theo dự báo — hàng đã ra khỏi kho tổng thì chi nhánh ghi nhận đúng số đó (sửa tay nếu nhận lệch).
export function buildPrepTodayList({ ingredientsList, openingInputs, openingStock, restockInputs = {}, inventoryInputs = {}, warehouseStocks, usedMap, lastWeekUsedMap, sent = {} }: {
    ingredientsList?: Row[] | null; openingInputs: Inputs; openingStock: UsageMap; restockInputs?: Inputs; inventoryInputs?: Inputs
    warehouseStocks?: UsageMap | null; usedMap: UsageMap; lastWeekUsedMap: UsageMap; sent?: SentMap
}) {
    const out: PrepItem[] = []
    for (const ing of ingredientsList || []) {
        // Đầu kỳ = số cân hộp (gồm bì) → matcha THẬT để bán = trừ bì, kẹp 0. Bì tự khử
        // trong Hao hụt (đầu+cuối cùng gross) nên chỉ trừ ở đây — chỗ cần lượng thật.
        const tare = r1(ing.tare_weight)
        const opening = Math.max(0, r1(openingGross(ing, openingInputs, openingStock) - tare))
        const forecast = forecastFor(ing.ingredient, usedMap, lastWeekUsedMap)
        const minCounter = r1(ing.min_counter_stock)
        const t = sent[ing.ingredient]
        const base = toPrepItem(ing, opening, Math.max(forecast, minCounter))
        const forced = !base && !!t
        const item = base ?? (t ? toPrepItem(ing, opening, opening + t.qty) : null)
        if (item) {
            if (t) { item.sent = t.qty; item.sentPacked = t.packed; item.by = t.by; item.fillQty = t.qty }
            if (!forced && forecast - opening <= 0) item.reason = `Tồn quầy ít nhất: ${minCounter} ${ing.unit}` // chỉ vì sàn quầy mới phải lấy
            // Kho tổng hiện có (warehouse_stock thực tế, KHÔNG phải số đầu ca) để rút ra
            // quầy. Lookup theo key trực tiếp; null nếu NVL không theo dõi kho.
            const wh = (warehouseStocks || {})[ing.ingredient]
            item.warehouse = wh != null ? r1(wh) : null
            item.tare = tare // >0 → card hiện "bì X + <thật>"
            // Hành trình trong ca (card kể "Đầu ca / Đã lấy thêm / Cuối ca" cho món đã xử lý): đã lấy ra quầy hôm nay
            // (Nhập thêm) và số đếm Cuối kỳ (trừ bì). need/fillQty vẫn tính theo đầu ca ở trên.
            const restock = r1(restockInputs[ing.ingredient])
            if (restock > 0) item.restock = restock
            const counted = inventoryInputs[ing.ingredient]
            if (counted !== undefined && counted !== '') item.counted = Math.max(0, r1(Number(counted) - tare))
            out.push(item)
        }
    }
    return out
}

export type PrepConfirmed = Record<string, { qty: number; warehouse: number | null }>

// NVL ĐÃ HẾT (hoặc SẮP HẾT: dưới min_counter_stock) ở quầy giữa ca: có bán (used > 0) mà Lý thuyết
// (Đầu kỳ + Nhập thêm − Sử dụng, trừ bì) ≤ 0 hoặc < tồn quầy ít nhất (đã đếm Cuối kỳ thì lấy số đếm thay Lý thuyết — đếm thực tế đúng hơn) — kể cả món sáng nay đã soạn. Cần lấy thêm từ kho dự trữ; bấm xác nhận = cộng thêm 1 lần
// vào Nhập thêm, nên Lý thuyết > 0 lại thì tự rớt khỏi danh sách. Món đã "bỏ qua" thì thôi.
// effectiveWarehouseStocks = kho TRƯỚC khi trừ restock ca này (xem useShiftInventoryState).
// ponytail: NVL không có quy cách bịch thì lấy 25% lượng đã dùng (tối thiểu 1) — chưa có cấu hình
// "lượng lấy mỗi lần"; thêm cột cấu hình nếu 25% không hợp.
// confirmed = { [ingredient]: { qty: số vừa lấy, warehouse: kho còn lại ngay lúc lấy } } trong lần mở modal này: món đó
// ở lại danh sách (dù Lý thuyết đã > 0) để hiện "Đã lấy", chỉ rớt sau khi đóng modal (qty 0 = đã hoàn tác). Kho đóng băng lúc bấm vì kho trước ca
// (đổi ngay khi phiếu lưu) và kho server (tải lại sau) cập nhật lệch nhịp → tính sống thì số nhảy 1 → 0 → 1 → 0.
// producedMap = tiêu hao RÒNG của mẻ sản xuất hôm nay (nguyên liệu gốc +, thành phẩm −): cộng vào Lý thuyết, còn dự báo vẫn chỉ theo đơn bán.
export function buildDepletedList({ ingredientsList, openingInputs, openingStock, restockInputs, inventoryInputs = {}, skipped, usedMap, producedMap = {}, effectiveWarehouseStocks, confirmed = {} }: {
    ingredientsList?: Row[] | null; openingInputs: Inputs; openingStock: UsageMap; restockInputs: Inputs; inventoryInputs?: Inputs
    skipped: Record<string, unknown>; usedMap: UsageMap; producedMap?: UsageMap; effectiveWarehouseStocks: UsageMap; confirmed?: PrepConfirmed
}) {
    const out: PrepItem[] = []
    for (const ing of ingredientsList || []) {
        const sold = r1(lookupByLabel(ing.ingredient, usedMap))
        const produced = r1(lookupByLabel(ing.ingredient, producedMap))
        const used = r1(sold + produced)
        if ((sold <= 0 && produced <= 0) || skipped[ing.ingredient]) continue
        const oRaw = openingInputs[ing.ingredient]
        const { lyThuyet } = computeBalance({
            restockValue: restockInputs[ing.ingredient],
            openingValue: oRaw === '' ? undefined : oRaw,
            openingFallback: openingStock[ing.ingredient] ?? 0,
            used,
        })
        const counted = inventoryInputs[ing.ingredient]
        // Số đếm là mốc cố định — Nhập thêm tick SAU khi đếm không nằm trong đó, nên cộng phần vừa lấy lần này vào.
        // (Chưa đếm thì lyThuyet đã gồm restock.)
        const balance = counted !== undefined && counted !== '' ? r1(Number(counted) + (confirmed[ing.ingredient]?.qty || 0)) : lyThuyet
        const tare = r1(ing.tare_weight)
        const net = balance - tare
        const minCounter = r1(ing.min_counter_stock)
        const low = net > 0 && minCounter > 0 && net < minCounter
        if (net > 0 && !low && !confirmed[ing.ingredient]) continue

        const packSize = Number(ing.pack_size) || 0
        // Lấy 1 bịch; nếu 1 bịch chưa đưa quầy lên lại sàn thì lấy đủ số bịch để lên sàn.
        const base = packSize > 0 ? packSize : Math.max(1, r1(used * 0.25))
        const toFloor = Math.max(0, minCounter - Math.max(0, net))
        const packs = packSize > 0 ? Math.ceil(Math.max(base, toFloor) / packSize) : 0
        const need = packs > 0 ? r1(packs * packSize) : Math.max(base, toFloor)
        const avail = lookupByLabel<number | null>(ing.ingredient, effectiveWarehouseStocks, null) // null = không theo dõi kho
        const left = avail == null ? Infinity : r1(Number(avail || 0) - r1(restockInputs[ing.ingredient]))
        const done = confirmed[ing.ingredient]
        out.push({
            ingredient: ing.ingredient,
            kind: 'depleted' as const,
            have: net, // số thật đã trừ bì (có thể âm) — thấy được mức lệch so với số đếm
            tare, // >0 → card hiện "bì X + <thật>", khớp với tiêu chí hết/sắp hết (tính trên net)
            haveLabel: 'Tồn quầy lý thuyết',
            need,
            needPacks: packs,
            low, // sắp hết (còn hàng nhưng dưới sàn quầy) — card hiện "Sắp hết" thay "Hết"
            unit: ing.unit,
            packSize,
            packUnit: ing.pack_unit,
            pack2: pack2Of(ing),
            fillQty: Math.max(0, Math.min(need, left)), // 0 = kho dự trữ cũng hết, không lấy thêm được
            // Kho còn lại = kho trước ca − Nhập thêm vừa tick → giảm ngay lúc tick, khỏi chờ lưu + tải lại từ server.
            warehouse: done ? done.warehouse : avail == null ? null : Math.max(0, left),
            taken: done?.qty || undefined, // qty 0 = đã hoàn tác trong lần mở này
        })
    }
    return out
}

// Gộp 2 nguồn thành 1 danh sách hiển thị: món soạn sáng nay + món hết giữa ca. Món vừa nằm trong
// danh sách soạn (đã tick) vừa đã hết lại → dùng bản "hết" (cần lấy thêm), không coi là xong.
export function mergePrepItems(prepList: PrepItem[], depletedList: PrepItem[], restockInputs: Inputs) {
    const dep = new Map(depletedList.map(d => [d.ingredient, d]))
    const inPrep = new Set(prepList.map(p => p.ingredient))
    const items = prepList.map(p => (dep.has(p.ingredient) && isPrepFilled(restockInputs[p.ingredient]) ? dep.get(p.ingredient)! : p))
    for (const d of depletedList) if (!inPrep.has(d.ingredient)) items.push(d)
    return items
}

// Đã xử lý? "Bỏ qua" luôn tính xong; đã nhập thêm tính xong, trừ món đang hết (cần lấy lần nữa).
export const isPrepDone = (it: PrepItem, restockInputs: Inputs, skipped: Record<string, unknown>) =>
    !!skipped[it.ingredient] || it.taken != null || (it.kind !== 'depleted' && isPrepFilled(restockInputs[it.ingredient]))

// Tổng đã "Nhập kho" (mua qua RestockModal, is_refill trên expenses) hôm nay theo NVL — hiển thị kèm dòng
// "Đã mua hôm nay" để thấy đã mua bao nhiêu (số đó đã nằm trong tồn kho, chỉ là hiển thị thêm).
// Phiếu hiệu chỉnh (sửa tay tồn kho, metadata.adjustment) cũng là expense is_refill nhưng KHÔNG phải mua → bỏ.
export function buildTodayBoughtMap(todayExpenses?: Row[] | null) {
    const m: UsageMap = {}
    for (const e of todayExpenses || []) {
        if (!e.is_refill || e.metadata?.cancelled || e.metadata?.adjustment) continue
        const ing = e.metadata?.ingredient
        const qty = Number(e.metadata?.qty) || 0
        if (!ing || !qty) continue
        m[ing] = (m[ing] || 0) + qty
    }
    Object.keys(m).forEach(k => { m[k] = r1(m[k]) })
    return m
}

// Kho tổng hiện có của 1 NVL (kẹp ≥ 0; tra cả key biến thể theo label).
export const poolOf = (ingredient: string, pool?: UsageMap | null) => Math.max(0, r1(lookupByLabel(ingredient, pool || {})))

// "Soạn kho nhóm" — quản lý nhìn 1 bảng cho cả nhóm kho chung: mỗi chi nhánh cần rút bao nhiêu cho mai (cùng
// công thức `pull` của buildWarehousePrepList, tính trên tồn quầy + dự báo CỦA CHI NHÁNH ĐÓ), cộng lại so với
// MỘT pool kho tổng. Bản 1 chi nhánh so từng nhu cầu riêng với pool nên 6 nơi cùng thấy "đủ" dù tổng vượt kho.
//   branches: [{ id, name, ingredientsList (cấu hình NVL của chi nhánh), counterStock: {ing: số cân hộp}, forecast: {ing} }]
//   pool: { ing: kho tổng hiện có } — số server đã trừ mọi lần rút đã ghi của cả nhóm.
//   cần mua = min_stock + Σ rút − pool, kẹp ≥ 0. min_stock lấy MAX giữa các chi nhánh (hàng dự phòng của nhóm chỉ giữ 1 lần).
// ponytail: chưa trừ phần "đã soạn nhưng chưa ghi" — chờ phiếu xuất kho nội bộ.
// sampleDays = số ngày CÓ đơn làm mẫu cho `forecast` (ít → ước lượng thô, UI gắn nhãn).
export interface GroupPrepBranch { id: string; name: string; ingredientsList: Row[]; counterStock: UsageMap; forecast: UsageMap; sampleDays?: number }
export interface GroupPrepRow {
    ingredient: string
    unit: string
    minStock: number
    branches: { id: string; name: string; qty: number; packs: number; packUnit?: string | null; sampleDays?: number }[]
    pool: number
    totalPull: number
    buy: number
}
// minAsFloor (địa chỉ lẻ, không có kho tổng): min_stock là sàn của kho chứ không cộng chồng lên phần rút mai — cần mua =
// max(min_stock, Σ rút) − pool, cùng công thức cho địa chỉ lẻ và kho tổng. Mặc định (kho tổng của nhóm):
// min_stock + Σ rút − pool, vì rút ra quầy xong kho vẫn phải còn ≥ min_stock.
export function buildGroupPrepPlan({ branches, pool, minAsFloor = false }: { branches: GroupPrepBranch[]; pool?: UsageMap | null; minAsFloor?: boolean }): GroupPrepRow[] {
    const byIng = new Map<string, Omit<GroupPrepRow, 'pool' | 'totalPull' | 'buy'>>()
    for (const b of branches) {
        for (const ing of b.ingredientsList || []) {
            const item = tomorrowItem(ing, b.counterStock, b.forecast)
            // Địa chỉ lẻ (minAsFloor): kho và quầy cùng chỗ, không cần rút nguyên bịch → so kho với lượng cần thật. Kho tổng nhóm: mỗi chi nhánh lấy nguyên bịch.
            const qty = (minAsFloor ? item?.need : item?.fillQty) ?? 0
            const packs = item?.needPacks ?? 0
            let row = byIng.get(ing.ingredient)
            if (!row) {
                row = { ingredient: ing.ingredient, unit: ing.unit, minStock: 0, branches: [] }
                byIng.set(ing.ingredient, row)
            }
            row.minStock = Math.max(row.minStock, r1(ing.min_stock))
            row.branches.push({ id: b.id, name: b.name, qty, packs, packUnit: ing.pack_unit, sampleDays: b.sampleDays })
        }
    }
    const out: GroupPrepRow[] = []
    for (const row of byIng.values()) {
        const poolNow = poolOf(row.ingredient, pool)
        const totalPull = r1(row.branches.reduce((s, x) => s + x.qty, 0))
        const buy = Math.max(0, r1((minAsFloor ? Math.max(row.minStock, totalPull) : row.minStock + totalPull) - poolNow))
        if (totalPull > 0 || buy > 0) out.push({ ...row, pool: poolNow, totalPull, buy })
    }
    return out.sort((a, c) => c.buy - a.buy || c.totalPull - a.totalPull)
}

// "Soạn cho ngày mai" của MỘT địa chỉ trong nhóm kho chung: cùng công thức "Soạn cho hôm nay" nhưng theo dự báo MAI —
// rút mai = max(dự báo mai, min_counter_stock) − tồn quầy cuối ca (đã trừ bì). warehouse = kho tổng chung còn lại.
const tomorrowItem = (ing: Row, counterStock: UsageMap, forecast: UsageMap) => {
    const counterReal = Math.max(0, r1(r1(lookupByLabel(ing.ingredient, counterStock || {})) - r1(ing.tare_weight)))
    return toPrepItem(ing, counterReal, Math.max(r1(lookupByLabel(ing.ingredient, forecast || {})), r1(ing.min_counter_stock)))
}
export function buildTomorrowPrepList({ ingredientsList, counterStock, forecast, pool }: {
    ingredientsList?: Row[] | null; counterStock: UsageMap; forecast: UsageMap; pool?: UsageMap | null
}) {
    const out: PrepItem[] = []
    for (const ing of ingredientsList || []) {
        const item = tomorrowItem(ing, counterStock, forecast)
        if (item) out.push(Object.assign(item, { warehouse: poolOf(ing.ingredient, pool), tare: r1(ing.tare_weight) }))
    }
    return out
}
