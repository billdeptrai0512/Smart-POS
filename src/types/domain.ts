// Core domain types shared across services and contexts.
// Incremental TS adoption: import these into .ts files as they are converted.

export type UUID = string

/** An extra/topping selected on a cart line (mirrors the `extras` table shape used in the cart). */
export interface CartExtra {
    id: string
    name: string
    price: number
    is_sticky?: boolean
}

/** A single line in the POS cart (see POSContext.handleAddItem). */
export interface CartItem {
    cartItemId: string
    productId: UUID
    name: string
    basePrice: number
    quantity: number
    extras: CartExtra[]
    /** Present only on enriched offline-queue items. */
    unitCost?: number
    extraIds?: string[]
}

export type DiscountType = 'percent' | 'amount'

/** Per-order discount state (single source of truth: utils/money.computeDiscount). */
export interface Discount {
    type: DiscountType
    value: number
}

export interface DiscountResult {
    discountAmount: number
    finalTotal: number
}

/** One item inside a bulk_create_orders RPC payload. */
export interface OrderItemPayload {
    product_id: UUID
    quantity: number
    options: string | null
    unit_cost: number
    extra_ids: string[]
}

/** A single order in the bulk_create_orders RPC payload. */
export interface OrderPayload {
    total: number
    total_cost: number
    discount_amount: number
    payment_method: string | null
    address_id: UUID | null
    staff_name: string | null
    created_at?: string
    items: OrderItemPayload[]
}

/** Aggregated daily stats returned by the get_today_stats RPC. */
export interface TodayStats {
    revenue: number
    cups: number
}

/** Map of cartItemId → snapshot unit COGS for an order. */
export type CostPerItem = Record<string, number>
