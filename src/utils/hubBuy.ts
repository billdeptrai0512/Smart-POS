import type { useGroupPrep } from '../hooks/useGroupPrep'
import { ceilToBigUnit } from './warehouseTransfer'
import { byIngredientLabel, lookupByLabel } from './ingredients'
import { pack2Of, type UsageMap } from './inventory'
import { toPrepItem, poolOf, type PrepItem } from './prepToday'

export type HubPrep = Pick<ReturnType<typeof useGroupPrep>, 'plan' | 'cfgOf' | 'pool'>

// bought (tuỳ chọn, tổng đã "Nhập kho" hôm nay theo NVL — buildTodayBoughtMap): có thì kèm "Đã mua hôm nay" và giữ lại dòng
// "đã mua đủ" (done) thay vì để món biến mất — mẫu số tiến độ đứng yên suốt ngày, như card Bổ sung tồn kho của địa chỉ lẻ.
export function buildHubBuyItems({ plan, cfgOf, pool }: HubPrep, bought?: UsageMap, minAsFloor = false): PrepItem[] {
    const items = (plan ?? [])
        .map((r): PrepItem | null => {
            const cfg = cfgOf[r.ingredient]
            const item = toPrepItem(cfg, 0, ceilToBigUnit(r.buy, r.unit, cfg))
            return item && { ...item, warehouse: r.pool, minStock: r.minStock, have: r.totalPull, boughtToday: lookupByLabel(r.ingredient, bought ?? {}) }
        })
        .filter((it): it is PrepItem => !!it)
    for (const [ingredient, qty] of Object.entries(bought ?? {})) {
        const cfg = cfgOf[ingredient]
        if (!cfg || !(qty > 0) || items.some(it => it.ingredient === ingredient)) continue
        const poolNow = poolOf(ingredient, pool)
        const pull = plan?.find(r => r.ingredient === ingredient)?.totalPull ?? 0
        const minStock = Number(cfg.min_stock) || 0
        // Trước khi mua kho còn thiếu (kho đã gồm số mua) thì đây là dòng "xong"; món tình cờ nhập mà vốn không thiếu thì bỏ.
        if ((minAsFloor ? Math.max(minStock, pull) : minStock + pull) - Math.max(0, poolNow - qty) > 0) {
            items.push({
                ingredient, done: true, boughtToday: qty, warehouse: poolNow, minStock, have: pull,
                unit: cfg.unit, packUnit: cfg.pack_unit, packSize: Number(cfg.pack_size) || 0, pack2: pack2Of(cfg),
            })
        }
    }
    return items.sort((a, b) => byIngredientLabel(a.ingredient, b.ingredient))
}
