// Centralized localStorage keys.
// Static keys are constants; dynamic keys are factory functions.

export const STORAGE_KEYS = {
    // Address / auth
    SELECTED_ADDRESS: 'pos_selected_address',
    SELECTED_ADDRESS_OBJ: 'pos_selected_address_obj', // full object → hydrate POS instantly, no network gate
    ACTIVE_USER_ID: 'pos_active_user_id',
    IS_GUEST: 'pos_is_guest',
    // Cached auth user/profile → render through the loading gate on cold start
    // without waiting for (or being logged out by) a flaky launch-time refresh.
    AUTH_USER: 'pos_auth_user',
    AUTH_PROFILE: 'pos_auth_profile',

    // POS session state
    CART: 'pos_cart',
    REVENUE: 'pos_revenue',
    TOTAL_COST: 'pos_total_cost',
    CUPS: 'pos_cups',
    INVENTORY: 'pos_inventory',
    CURRENT_DATE: 'pos_current_date',

    // Offline sync
    PENDING_ORDERS: 'coffee_pending_orders',

    // PWA
    PWA_PROMPT_DISMISSED: 'pwa_prompt_dismissed',

    // Guest-mode data (mirror of Supabase tables)
    GUEST_ADDRESSES: 'guest_addresses',
    GUEST_PRODUCTS: 'guest_products',
    GUEST_RECIPES: 'guest_recipes',
    GUEST_INGREDIENT_COSTS: 'guest_ingredient_costs',
    GUEST_PRODUCT_EXTRAS: 'guest_product_extras',
    GUEST_EXTRA_INGREDIENTS: 'guest_extra_ingredients',
    GUEST_ORDERS: 'guest_orders',
    GUEST_EXPENSES: 'guest_expenses',
    GUEST_SHIFT_CLOSINGS: 'guest_shift_closings',
    GUEST_FIXED_COSTS: 'guest_fixed_costs',
    GUEST_INGREDIENT_SORT: 'guest_ingredient_sort_order',
    GUEST_EXPENSE_PAYMENTS: 'guest_expense_payments',
}

// Per-address cache keys used by ProductContext / AddressSelectPage.
// `name` is one of: products, recipes, costs, units, configs, extras, extra_ingredients.
export const cacheKey = (addressId, name) => `cache_${name}_${addressId}`

// Shift finalization flag, scoped to (addressId, dateYYYYMMDD).
export const shiftFinalizedKey = (addressId, dateStr) =>
    `shift_finalized_${addressId}_${dateStr}`

// Cash closing flag, scoped to (addressId, dateYYYYMMDD).
export const cashClosedKey = (addressId, dateStr) =>
    `cash_closed_${addressId}_${dateStr}`

// Ingredient key-sync warning dismissal, per address.
export const keySyncDismissedKey = (addressId) => `key_sync_dismissed_${addressId}`

// Per-address list of orphan ingredient keys the user has chosen to ignore
// permanently. Filtered out of `orphan*Keys` in detectKeyMismatches.
export const orphanIgnoredKey = (addressId) => `orphan_ignored_${addressId}`
