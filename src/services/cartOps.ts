// Logic THUẦN của giỏ hàng / đơn lạc quan, rút từ POSContext. Mọi hàm không đọc state, không gọi
// mạng, không đụng ref — POSContext giữ phần "ref đồng bộ + setState + gọi server", ở đây chỉ còn
// tính toán, nên test được mà không cần render React (xem tests/pos/cartOps.test.ts).
import type { CartItem, CartExtra, CartTopping, CostPerItem, Discount, UUID, Row } from '../types/domain'
import { errorMessage } from '../utils/errorMessage'
import { computeDiscount, cartLineSubtotal, discountToPercent, NO_DISCOUNT } from '../utils/money'
import { resolveDiscountedPrice, type DiscountProgram } from '../utils/discountPrograms'
import { mergeTableLines, tableLine, type TableLine, type TableRound, type OpenTable } from './orderService'

// Mất mạng vs lỗi thật: chỉ lỗi mạng mới được xếp hàng chờ, lỗi thật phải nổi lên cho
// người dùng thấy. Supabase-js ném TypeError của fetch nên phải soi message.
export const isNetworkError = (err: unknown, online = navigator.onLine) =>
    !online || /fetch|network|NetworkError/i.test(errorMessage(err, ''))

// ---- Giỏ ----

const addonsPrice = (item: CartItem) => [...item.extras, ...(item.toppings || [])].reduce((s, e) => s + e.price, 0)

export const cartTotal = (cart: CartItem[]) =>
    cart.reduce((sum, item) => sum + (item.basePrice + addonsPrice(item)) * item.quantity, 0)

export const cartOrderCount = (cart: CartItem[]) => cart.reduce((sum, item) => sum + item.quantity, 0)

// Giảm giá TAY sống trên từng dòng (item.discount); tổng đơn chỉ là cộng dồn.
const manualLineDiscount = (item: CartItem) => computeDiscount(cartLineSubtotal(item), item.discount || NO_DISCOUNT).discountAmount
export const cartDiscountTotal = (cart: CartItem[]) => cart.reduce((sum, item) => sum + manualLineDiscount(item), 0)

// Chạm lại cùng món = thêm DÒNG mới, không cộng quantity (mỗi dòng mang extras/topping riêng).
// Giá lấy theo chương trình giảm giá đang hiệu lực nếu có.
export function newCartLine(product: Row, productExtras: CartExtra[] | undefined, enabledStickyIds: string[], programs: DiscountProgram[] | undefined, cartItemId: UUID): CartItem {
    const stickyExtras = (productExtras || []).filter(e => e.is_sticky && enabledStickyIds.includes(e.id))
    const basePrice = resolveDiscountedPrice(product.price, programs) ?? product.price
    return { cartItemId, productId: product.id, name: product.name, basePrice, quantity: 1, extras: [...stickyExtras], toppings: [] }
}

export const patchLine = (cart: CartItem[], cartItemId: UUID, patch: Partial<CartItem>) =>
    cart.map(i => i.cartItemId === cartItemId ? { ...i, ...patch } : i)

// Nút X trên card: bớt dòng MỚI NHẤT của chính món đó (không phải dòng cuối giỏ). Không có → trả lại cùng mảng.
export function removeLatestOfProduct(cart: CartItem[], productId: UUID): CartItem[] {
    const targetId = [...cart].reverse().find(i => i.productId === productId)?.cartItemId
    return targetId ? cart.filter(i => i.cartItemId !== targetId) : cart
}

function patchLast(cart: CartItem[], patch: (last: CartItem) => Partial<CartItem>): CartItem[] {
    if (cart.length === 0) return cart
    const idx = cart.length - 1
    const next = [...cart]
    next[idx] = { ...cart[idx], ...patch(cart[idx]) }
    return next
}

// Bật/tắt (on = ép trạng thái; bỏ trống = đảo) một extra/topping trên dòng vừa chạm (dòng cuối giỏ).
function setOnLast(cart: CartItem[], key: 'extras' | 'toppings', item: { id: string }, on?: boolean) {
    return patchLast(cart, last => {
        const list = last[key] as { id: string }[]
        const has = list.some(x => x.id === item.id)
        if (!(on ?? !has)) return { [key]: list.filter(x => x.id !== item.id) }
        return { [key]: has ? list : [...list, item] }
    })
}

export const toggleExtraOnLast = (cart: CartItem[], extra: CartExtra) => setOnLast(cart, 'extras', extra)
export const toggleToppingOnLast = (cart: CartItem[], topping: CartTopping) => setOnLast(cart, 'toppings', topping)
// Extra "dính": bật thì thêm (nếu chưa có) vào dòng cuối, tắt thì gỡ khỏi dòng cuối.
export const setStickyExtraOnLast = (cart: CartItem[], extra: CartExtra, enable: boolean) => setOnLast(cart, 'extras', extra, enable)

// ---- Nhật ký / dòng bill ----

// Dòng Nhật ký và dòng hoá đơn bàn cùng một quy ước ("2 Cà phê (Ít đá)").
const journalLines = (lines: TableLine[]) => lines.map(l => `${l.qty > 1 ? l.qty + ' ' : ''}${l.name}`)

export function buildLastOrderFromDB(order: Row) {
    const lines = mergeTableLines([], (order.order_items || []).map((i: Row) =>
        tableLine(i.products?.name || '?', (i.options || '').split(', '), null, i.quantity)))
    return { id: order.id, total: order.total, createdAt: order.created_at, items: journalLines(lines) }
}

/** Một dòng "Nhật ký" gần nhất trên header /pos. */
export type LastOrder = ReturnType<typeof buildLastOrderFromDB>

// id = React key duy nhất: createdAt phân giải ms nên 2 đơn cùng ms sẽ trùng key.
export function buildLastOrderFromCart(cartItems: CartItem[], total: number, id: UUID = crypto.randomUUID(), createdAt = new Date().toISOString()) {
    const lines = mergeTableLines([], cartItems.map(i =>
        tableLine(i.name, (i.extras || []).map(e => e.name), null, i.quantity)))
    return { id, total, createdAt, items: journalLines(lines) }
}

// Hàng lạc quan chưa được server xác nhận vẫn giữ lại cho tới khi fetch có đúng id đó.
export function mergeFetchedOrders(prev: Row[], fetchedOrders: Row[]) {
    const fetchedIds = new Set(fetchedOrders.map(o => o.id))
    const stillPending = prev.filter(o => o._optimistic && !fetchedIds.has(o.id))
    return [...stillPending, ...fetchedOrders]
}

// ---- Gửi đơn: số liệu + hàng lạc quan ----

export interface SubmitTotals {
    costPerItem: CostPerItem
    cartCost: number
    itemTotal: number
    countableQty: number
    discountApplied: number
    netTotal: number
    programDiscount: number
    /** discountApplied + programDiscount — số hiện trên hàng lạc quan */
    totalDiscount: number
    lineDiscount: (item: CartItem) => number
}

// costOf(item) = giá vốn 1 đơn vị của dòng. Giá vốn lạc quan chỉ gồm recipe + extras; server mới là nguồn thật.
export function computeSubmitTotals(cartItems: CartItem[], discountAmountArg: number, products: Row[] | undefined, costOf: (item: CartItem) => number): SubmitTotals {
    const costPerItem: CostPerItem = {}
    const cartCost = cartItems.reduce((sum, item) => {
        const c = costOf(item)
        costPerItem[item.cartItemId] = c
        return sum + c * item.quantity
    }, 0)
    const itemTotal = cartTotal(cartItems)
    const productById = new Map((products || []).map(p => [p.id, p]))
    const countableQty = cartItems.reduce((sum, item) =>
        productById.get(item.productId)?.count_as_cup === false ? sum : sum + item.quantity, 0)
    // Số tiền thực thu = gộp trừ chiết khấu; server tính lại y hệt (bulk_create_orders).
    const discountApplied = Math.min(Math.round(discountAmountArg) || 0, itemTotal)
    const netTotal = itemTotal - discountApplied
    // Giảm theo chương trình: giỏ mang sẵn GIÁ ĐÃ GIẢM ở basePrice nên phần chênh so với products.price
    // không nằm trong discountApplied. Chỉ mirror cho hàng lạc quan — KHÔNG gửi lên RPC (server tự cộng).
    const programLineDiscount = (item: CartItem) => Math.max(0, (productById.get(item.productId)?.price ?? item.basePrice) - item.basePrice) * item.quantity
    const programDiscount = cartItems.reduce((sum, item) => sum + programLineDiscount(item), 0)
    const lineDiscount = (item: CartItem) => manualLineDiscount(item) + programLineDiscount(item)
    return { costPerItem, cartCost, itemTotal, countableQty, discountApplied, netTotal, programDiscount, totalDiscount: discountApplied + programDiscount, lineDiscount }
}

const idsOf = (xs?: { id: string }[]) => (xs || []).map(x => x.id).filter(Boolean)
const addonNames = (it: CartItem) => [...(it.extras || []), ...(it.toppings || [])].map(e => e.name)

// Dòng nhãn dùng cho đợt lạc quan của bàn lẫn phiếu bếp (kèm topping + ghi chú).
export const submitLines = (cartItems: CartItem[]): TableLine[] => mergeTableLines([], cartItems.map(it =>
    tableLine(it.name, addonNames(it), it.note, it.quantity)))

// Cộng đợt vừa gửi vào danh sách bàn đang mở. tableName null = đơn mang đi (bucket name === null).
export function appendRoundToTables(prev: OpenTable[], tableName: string | null, round: TableRound, openedAt: string): OpenTable[] {
    const i = prev.findIndex(t => t.name === tableName)
    if (i === -1) return [...prev, { name: tableName, total: round.total, rounds: [round], openedAt, lines: round.lines }]
    const next = [...prev]
    next[i] = {
        ...next[i],
        total: next[i].total + round.total,
        rounds: [...next[i].rounds, round],
        lines: mergeTableLines(next[i].lines, round.lines),
    }
    return next
}

// Đợt lạc quan: chưa có order_no / printCount / staff (server cấp), orderId null khi offline.
export function buildOptimisticRound(cartItems: CartItem[], t: SubmitTotals, orderId: UUID | null, createdAt: string, lines: TableLine[]) {
    return {
        id: orderId, createdAt, total: t.netTotal, servedAt: null, lines,
        discountAmount: t.totalDiscount,
        items: cartItems.map(it => ({
            productId: it.productId, qty: it.quantity, discountAmount: t.lineDiscount(it),
            extraIds: idsOf(it.extras),
            toppingIds: idsOf(it.toppings),
            note: it.note || null,
        })),
    } as unknown as TableRound
}

// Hàng /history lạc quan (shape fetchTodayOrders). Bị thay NGUYÊN CẢ ĐƠN khi fetch thật về, nên id
// order_items chỉ là placeholder.
export function buildOptimisticOrder(cartItems: CartItem[], t: SubmitTotals, o: { orderId: UUID; createdAt: string; staffName: string | null; tableName: string | null }): Row {
    return {
        _optimistic: true,
        id: o.orderId,
        total: t.netTotal,
        discount_amount: t.totalDiscount,
        total_cost: Math.round(t.cartCost),
        created_at: o.createdAt,
        staff_name: o.staffName,
        table_name: o.tableName || null,
        deleted_at: null,
        deleted_by: null,
        payment_method: null,
        order_items: cartItems.map(item => ({
            id: item.cartItemId,
            quantity: item.quantity,
            options: addonNames(item).join(', ') || null,
            product_id: item.productId,
            unit_cost: Math.round(t.costPerItem[item.cartItemId] || 0),
            extra_ids: idsOf(item.extras),
            topping_ids: idsOf(item.toppings),
            discount_amount: t.lineDiscount(item),
            note: item.note || null,
            products: { name: item.name },
        })),
    }
}

// ---- Sửa đợt: nạp ngược đợt đã gọi vào giỏ ----

export type ReopenResult = { ok: false } | { ok: true; items: CartItem[]; programDeltas: number[] }

// Dựng lại các dòng giỏ từ một đợt. Món đã xoá khỏi menu thì không dựng được (không còn giá) → ok:false,
// phải dừng TRƯỚC khi xoá đợt cũ. programDeltas = phần chương trình giảm của từng dòng.
export function cartItemsFromRound(
    round: Row, products: Row[], productExtras: Record<string, CartExtra[]>, productToppings: Record<string, CartTopping[]>,
    productDiscounts: Record<string, DiscountProgram[]>, newId: () => UUID = () => crypto.randomUUID(),
): ReopenResult {
    const items: CartItem[] = []
    const programDeltas: number[] = []
    for (const it of round.items) {
        const p = products.find(x => x.id === it.productId)
        if (!p) return { ok: false }
        // Giá chương trình như lúc chạm món mới — nạp lại nguyên giá gốc thì dòng hiện đắt hơn giá khách đã trả.
        const basePrice = resolveDiscountedPrice(p.price, productDiscounts[p.id]) ?? p.price
        programDeltas.push((p.price - basePrice) * it.qty)
        items.push({
            cartItemId: newId(),
            productId: p.id,
            name: p.name,
            basePrice,
            quantity: it.qty,
            extras: (productExtras[p.id] || []).filter(e => it.extraIds.includes(e.id)),
            toppings: (productToppings[p.id] || []).filter(t => (it.toppingIds || []).includes(t.id)),
            note: it.note,
            edit: { orderNo: round.orderNo ?? null }, // phiếu bếp in "HỦY #số cũ"
        })
    }
    return { ok: true, items, programDeltas }
}

const asDiscount = (subtotal: number, amount: number): Discount => {
    const { pct, exact } = discountToPercent(subtotal, amount)
    return exact ? { type: 'percent', value: pct } : { type: 'amount', value: amount }
}

// Gán lại giảm giá TAY của đợt cũ lên từng dòng (đổi số đ đã giảm về % nếu tròn). Sửa tại chỗ `items`.
// Đợt CŨ chưa có discount theo dòng thì dồn cả cục vào dòng cuối như trước.
export function seedRoundDiscounts(items: CartItem[], round: Row, programDeltas: number[]): void {
    const itemDiscountSum = round.items.reduce((sum: number, it: Row) => sum + (it.discountAmount || 0), 0)
    if (itemDiscountSum > 0) {
        round.items.forEach((it: Row, idx: number) => {
            // Phần chương trình cũng nằm trong it.discountAmount nhưng basePrice đã là giá chương trình —
            // trừ ra, không thì bấm Tạo đơn lại là giảm hai lần.
            const manual = (it.discountAmount || 0) - programDeltas[idx]
            if (manual > 0) items[idx].discount = asDiscount(cartLineSubtotal(items[idx]), manual)
        })
    } else if (round.discountAmount > 0 && items.length > 0) {
        items[items.length - 1].discount = asDiscount(round.total + round.discountAmount, round.discountAmount)
    }
}
