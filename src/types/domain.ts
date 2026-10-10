// Core domain types shared across services and contexts.
// Incremental TS adoption: import these into .ts files as they are converted.

export type UUID = string

// Loosely-shaped JSON from Supabase/localStorage — precise interfaces for every
// RPC/table shape is a much bigger effort than incremental adoption warrants yet;
// `Record` keeps call sites honest about "unknown shape" instead of pretending via `any`.
export type Row = Record<string, any>

/** Một dòng bảng `addresses` (chi nhánh). */
export type Address = {
    id: UUID
    name: string
    manager_id?: UUID | null
    ingredient_sort_order?: string[] | null
    tables?: string[] | null
    warehouse_group_id?: UUID | null
    counter_printer_ip?: string | null
    kitchen_printer_ip?: string | null
    created_at?: string
} & Row

/** Địa chỉ đang chọn: id = null là "Mẫu mặc định" của admin (hợp lệ, KHÁC với chưa chọn = null cả object). */
export type SelectedAddress = Address | (Omit<Address, 'id'> & { id: null })

/** Một dòng bảng `expense_categories` (nhãn chi phí). */
export interface ExpenseCategory {
    id: UUID
    name: string
    group_section?: string | null
    sort_order?: number | null
    is_default?: boolean
}

/** Một nguyên liệu trong danh mục (dòng ingredientConfigs: giá vốn, đơn vị, quy cách, tồn tối thiểu…). */
export type IngredientConfig = Row & { ingredient: string }

/** Nhóm nguyên liệu (ingredient_groups) — section 'main' | 'packaging' quyết định dòng "Mua bao bì" ở dòng tiền. */
export interface IngredientGroup { id: UUID; name: string; section?: string; sort_order: number }

/** Nhóm kho tổng dùng chung giữa các địa chỉ của một manager. */
export interface WarehouseGroup { id: UUID; manager_id: UUID; name: string; created_at: string }

/** Một dòng bảng `users` (profile của người đăng nhập). Các cột khác đọc qua Row. */
export type Profile = {
    id: string
    name: string
    role: 'admin' | 'manager' | 'co-manager' | 'staff' | string
    email?: string | null
    username?: string
} & Row

/** An extra option (size/đường/đá...) selected on a cart line — a `product_extras` row. */
export interface CartExtra {
    id: string
    name: string
    price: number
    is_sticky?: boolean
}

/** A topping selected on a cart line — a `toppings` row (global entity, own id space,
 *  attached to many products via `product_toppings`; separate from CartExtra). */
export type CartTopping = Omit<CartExtra, 'is_sticky'>

/** A single line in the POS cart (see POSContext.handleAddItem). */
export interface CartItem {
    cartItemId: string
    productId: UUID
    name: string
    basePrice: number
    quantity: number
    extras: CartExtra[]
    toppings: CartTopping[]
    /** Present only on enriched offline-queue items. */
    unitCost?: number
    extraIds?: string[]
    toppingIds?: string[]
    /** Per-line discount, set via the cart list's per-item discount modal. */
    discount?: Discount
    /** Per-line kitchen note, set via CartNoteModal. */
    note?: string | null
    /** Set on lines reloaded by "Sửa" (reopenRoundIntoCart) — kitchen ticket prints "HỦY #<old no>". */
    edit?: { orderNo: number | null }
}

type DiscountType = 'percent' | 'amount'

/** Per-order discount state (single source of truth: utils/money.computeDiscount). */
export interface Discount {
    type: DiscountType
    value: number
}

export interface DiscountResult {
    discountAmount: number
    finalTotal: number
}

/** One item inside a bulk_create_orders RPC payload. Declares WHAT was bought
 *  only — price and cost are looked up server-side from products/recipes, the
 *  client is not trusted to state its own total (see 20260708 migration). */
interface OrderItemPayload {
    product_id: UUID
    quantity: number
    extra_ids: string[]
    topping_ids: string[]
    /** Resolved đ giảm cho riêng dòng này — cùng dạng resolved-amount như
     *  OrderPayload.discount_amount, không phải %/đ đã chọn lúc áp. */
    discount_amount?: number
    /** Ghi chú riêng dòng (in lên phiếu bếp). NULL = không có. */
    note?: string | null
}

/** A single order in the bulk_create_orders RPC payload. */
export interface OrderPayload {
    /** Client-generated — becomes the real orders.id so optimistic UI and the
     *  DB row share one identity from creation, no post-hoc matching needed. */
    id?: UUID | null
    discount_amount: number
    payment_method: string | null
    address_id: UUID | null
    staff_name: string | null
    /** Nhãn bàn. NULL/'' = đơn mang đi (RPC tự chuẩn hoá về NULL). */
    table_name?: string | null
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

/** `error` của một phản hồi supabase-js (PostgREST) — chỉ phần code/message mà service soi tới. */
export type SupabaseError = { code?: string; message?: string } | null
