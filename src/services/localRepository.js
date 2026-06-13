/**
 * localRepository.js
 * Manages all "Guest Mode" data in LocalStorage.
 * Mimics Supabase CRUD operations for products, recipes, orders, etc.
 */
import { dateStringVN, startOfDayVN } from '../utils/dateVN'

const generateId = () => crypto.randomUUID();

const KEYS = {
    ADDRESSES: 'guest_addresses',
    PRODUCTS: 'guest_products',
    RECIPES: 'guest_recipes',
    INGREDIENT_COSTS: 'guest_ingredient_costs',
    PRODUCT_EXTRAS: 'guest_product_extras',
    EXTRA_INGREDIENTS: 'guest_extra_ingredients',
    ORDERS: 'guest_orders',
    EXPENSES: 'guest_expenses',
    SHIFT_CLOSINGS: 'guest_shift_closings',
    FIXED_COSTS: 'guest_fixed_costs',
    EXPENSE_CATEGORIES: 'guest_expense_categories',
    EXPENSE_PAYMENTS: 'guest_expense_payments',
    IS_GUEST: 'pos_is_guest'
};

const get = (key, fallback = []) => {
    try {
        const val = localStorage.getItem(key);
        return val ? JSON.parse(val) : fallback;
    } catch {
        return fallback;
    }
};

const set = (key, val) => localStorage.setItem(key, JSON.stringify(val));

// --- Auth / State ---
export const setIsGuest = (val) => localStorage.setItem(KEYS.IS_GUEST, val ? 'true' : 'false');
export const isGuest = () => localStorage.getItem(KEYS.IS_GUEST) === 'true';

// --- Addresses ---
const DEMO_ADDRESS_ID = 'demo-address-uuid-123';
const KEY_GUEST_INGREDIENT_SORT = 'guest_ingredient_sort_order';

export const getGuestIngredientSortOrder = () => {
    try {
        const raw = localStorage.getItem(KEY_GUEST_INGREDIENT_SORT);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
};

export const setGuestIngredientSortOrder = (arr) => {
    localStorage.setItem(KEY_GUEST_INGREDIENT_SORT, JSON.stringify(arr || []));
};

export const getDemoAddress = () => ({
    id: DEMO_ADDRESS_ID,
    name: 'Quán Demo của tôi',
    manager_id: 'guest',
    ingredient_sort_order: getGuestIngredientSortOrder() || [],
    created_at: new Date().toISOString()
});

// --- Seeding ---
export const initializeGuestFromGlobal = (data) => {
    const addressId = DEMO_ADDRESS_ID;

    if (data.ingredients) {
        set(KEYS.INGREDIENT_COSTS, data.ingredients.map(i => ({ ...i, address_id: addressId })));
    }
    if (data.products) {
        set(KEYS.PRODUCTS, data.products.map(p => ({ ...p, owner_address_id: addressId, is_active: true })));
    }
    if (data.recipes) {
        set(KEYS.RECIPES, data.recipes.map(r => ({ ...r, address_id: addressId })));
    }
    if (data.extras) {
        set(KEYS.PRODUCT_EXTRAS, data.extras.map(e => ({ ...e, address_id: addressId })));
    }
    if (data.extraIngredients) {
        set(KEYS.EXTRA_INGREDIENTS, data.extraIngredients.map(i => ({ ...i })));
    }

    set(KEYS.ORDERS, []);

    // Seed expenses with synthetic refill rows so the playground inherits the default's
    // on-hand stock — fetchLocalIngredientStocks reads Σ refill_qty to compute warehouse.
    // Each seeded refill has amount=0 (no fake cash impact on P&L) and metadata.seeded=true
    // so it can be filtered out of the Đi chợ tab if we want to hide them later.
    const seededExpenses = (data.stocks || [])
        .filter(s => s && s.ingredient && Number(s.current_stock) > 0)
        .map(s => ({
            id: generateId(),
            name: `Tồn ban đầu: ${s.ingredient}`,
            amount: 0,
            address_id: addressId,
            is_fixed: false,
            is_refill: true,
            payment_method: 'cash',
            staff_name: null,
            metadata: { ingredient: s.ingredient, qty: Number(s.current_stock), totalCost: 0, seeded: true },
            created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        }));
    set(KEYS.EXPENSES, seededExpenses);

    set(KEYS.SHIFT_CLOSINGS, []);
    // fixed_costs seed removed — "thực chi" model no longer uses templates.
};

// --- CRUD Helpers ---

export const fetchLocalProducts = (addressId) => {
    const list = get(KEYS.PRODUCTS).filter(p => p.owner_address_id === addressId && p.is_active);
    list.sort((a, b) => {
        const aSort = a.sort_order ?? 999999;
        const bSort = b.sort_order ?? 999999;
        if (aSort !== bSort) return aSort - bSort;
        return (a.name || '').localeCompare(b.name || '');
    });
    return list;
};
export const insertLocalProduct = (payload) => {
    const products = get(KEYS.PRODUCTS);
    const newProd = { id: generateId(), is_active: true, ...payload, created_at: new Date().toISOString() };
    products.push(newProd);
    set(KEYS.PRODUCTS, products);
    return newProd;
};

export const fetchLocalRecipes = (addressId) => get(KEYS.RECIPES).filter(r => r.address_id === addressId);
export const upsertLocalRecipe = (payload) => {
    const recipes = get(KEYS.RECIPES);
    const idx = recipes.findIndex(r => r.product_id === payload.product_id && r.ingredient === payload.ingredient && r.address_id === payload.address_id);
    if (idx >= 0) recipes[idx] = { ...recipes[idx], ...payload };
    else recipes.push(payload);
    set(KEYS.RECIPES, recipes);
};

export const fetchLocalIngredientCosts = (addressId) => {
    const list = get(KEYS.INGREDIENT_COSTS).filter(i => i.address_id === addressId || i.address_id === null);
    return list.map(item => ({
        ingredient: item.ingredient,
        unit: item.unit || 'đv',
        unit_cost: item.unit_cost !== undefined ? item.unit_cost : item.unitCost,
        pack_size: item.pack_size !== undefined ? item.pack_size : item.packSize,
        pack_unit: item.pack_unit !== undefined ? item.pack_unit : item.packUnit,
        min_stock: item.min_stock !== undefined ? item.min_stock : item.minStock,
        category: item.category,
        count_in_audit: item.count_in_audit !== undefined ? item.count_in_audit : (item.countInAudit !== undefined ? item.countInAudit : true)
    }));
};

export const upsertLocalIngredientCost = (payload) => {
    const items = get(KEYS.INGREDIENT_COSTS);
    const idx = items.findIndex(i => i.ingredient === payload.ingredient && i.address_id === payload.address_id);
    
    const mapped = {
        ingredient: payload.ingredient,
        unit_cost: payload.unit_cost !== undefined ? payload.unit_cost : payload.unitCost,
        address_id: payload.address_id,
        unit: payload.unit,
    };
    
    const packSize = payload.pack_size !== undefined ? payload.pack_size : payload.packSize;
    if (packSize !== undefined) mapped.pack_size = packSize;
    
    const packUnit = payload.pack_unit !== undefined ? payload.pack_unit : payload.packUnit;
    if (packUnit !== undefined) mapped.pack_unit = packUnit;
    
    const minStock = payload.min_stock !== undefined ? payload.min_stock : payload.minStock;
    if (minStock !== undefined) mapped.min_stock = minStock;
    
    if (payload.category !== undefined) mapped.category = payload.category;
    
    const countInAudit = payload.count_in_audit !== undefined ? payload.count_in_audit : payload.countInAudit;
    if (countInAudit !== undefined) mapped.count_in_audit = countInAudit;

    if (idx >= 0) items[idx] = { ...items[idx], ...mapped };
    else items.push(mapped);
    set(KEYS.INGREDIENT_COSTS, items);
};

export const fetchLocalProductExtras = (addressId) => {
    const list = get(KEYS.PRODUCT_EXTRAS).filter(e => e.address_id === addressId);
    // Match Supabase path: order by sort_order ASC, nulls last.
    list.sort((a, b) => {
        const aSort = a.sort_order ?? 999999;
        const bSort = b.sort_order ?? 999999;
        if (aSort !== bSort) return aSort - bSort;
        return (a.name || '').localeCompare(b.name || '');
    });
    const map = {};
    list.forEach(ex => {
        if (!map[ex.product_id]) map[ex.product_id] = [];
        map[ex.product_id].push({ id: ex.id, name: ex.name, price: ex.price, is_sticky: ex.is_sticky });
    });
    return map;
};

export const fetchLocalExtraIngredients = (extraIds = null) => {
    let list = get(KEYS.EXTRA_INGREDIENTS);
    if (extraIds) {
        list = list.filter(i => extraIds.includes(i.extra_id));
    }
    const map = {};
    list.forEach(i => {
        if (!map[i.extra_id]) map[i.extra_id] = [];
        map[i.extra_id].push(i);
    });
    return map;
};

export const submitLocalOrder = (order) => {
    const orders = get(KEYS.ORDERS);
    const newOrder = {
        id: generateId(),
        ...order,
        created_at: order.created_at || new Date().toISOString()
    };
    orders.push(newOrder);
    set(KEYS.ORDERS, orders);
    return newOrder;
};

export const fetchLocalOrders = (addressId, dateStr = null) => {
    let orders = get(KEYS.ORDERS).filter(o => o.address_id === addressId);
    const d = dateStr ? dateStringVN(new Date(dateStr)) : dateStringVN();
    orders = orders.filter(o => dateStringVN(new Date(o.created_at)) === d);
    // Maintain compatibility with both 'items' and 'order_items'
    return orders.map(o => ({ ...o, order_items: o.order_items || o.items }));
};

export const fetchLocalExpenses = (addressId, dateStr = null) => {
    let list = get(KEYS.EXPENSES).filter(e => e.address_id === addressId);
    const d = dateStr ? dateStringVN(new Date(dateStr)) : dateStringVN();
    list = list.filter(e => dateStringVN(new Date(e.created_at)) === d);
    return list;
};

export const fetchAllLocalOrders = (addressId) => get(KEYS.ORDERS).filter(o => o.address_id === addressId).map(o => ({ ...o, order_items: o.order_items || o.items }));
export const fetchAllLocalExpenses = (addressId) => get(KEYS.EXPENSES).filter(e => e.address_id === addressId);
export const fetchAllLocalShiftClosings = (addressId) => get(KEYS.SHIFT_CLOSINGS).filter(s => s.address_id === addressId);

export const insertLocalExpense = (payload) => {
    const list = get(KEYS.EXPENSES);
    // payload.created_at có thể được truyền khi user backdate (RestockModal). Fallback now() khi không có.
    const newItem = { id: generateId(), created_at: new Date().toISOString(), discount_amount: 0, extra_cost: 0, ...payload };
    list.push(newItem);
    set(KEYS.EXPENSES, list);
    return newItem;
};

// expense_payments mirror — same fallback shape as remote table.
export const fetchAllLocalExpensePayments = (addressId) =>
    get(KEYS.EXPENSE_PAYMENTS).filter(p => p.address_id === addressId);

// Remove every payment linked to an expense (mirrors the DB's ON DELETE CASCADE
// on expense_payments.expense_id, used when cancelling a restock in guest mode).
export const deleteLocalExpensePaymentsByExpense = (expenseId) => {
    set(KEYS.EXPENSE_PAYMENTS, get(KEYS.EXPENSE_PAYMENTS).filter(p => p.expense_id !== expenseId));
    return true;
};

export const insertLocalExpensePayment = (payload) => {
    const list = get(KEYS.EXPENSE_PAYMENTS);
    const paidAt = payload.paid_at || new Date().toISOString();
    const newItem = {
        id: generateId(),
        created_at: paidAt,
        paid_at: paidAt,
        ...payload
    };
    list.push(newItem);
    set(KEYS.EXPENSE_PAYMENTS, list);
    return newItem;
};

export const fetchLocalShiftClosing = (addressId, dateStr) => {
    const list = get(KEYS.SHIFT_CLOSINGS);
    const d = dateStringVN(new Date(dateStr));
    return list.find(s => s.address_id === addressId && dateStringVN(new Date(s.created_at)) === d);
};

export const fetchLocalYesterdayShiftClosing = (addressId) => {
    const list = get(KEYS.SHIFT_CLOSINGS).filter(s => s.address_id === addressId);
    const today = startOfDayVN();

    // Find the latest closing before today
    const past = list
        .filter(s => new Date(s.created_at) < today)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return past[0] || null;
};

export const fetchLocalIngredientStocks = (addressId) => {
    const expenses = get(KEYS.EXPENSES).filter(e => e.address_id === addressId && e.is_refill);
    const closings = get(KEYS.SHIFT_CLOSINGS).filter(s => s.address_id === addressId).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const latestClosing = closings[0];

    const ingredients = new Set();
    expenses.forEach(e => { if (e.metadata?.ingredient) ingredients.add(e.metadata.ingredient) });
    if (latestClosing?.inventory_report) {
        latestClosing.inventory_report.forEach(item => { if (item.ingredient) ingredients.add(item.ingredient) });
    }

    // Walk closings DESC for the most-recent non-null `remaining` per ingredient.
    // null = staff didn't count this ingredient that shift; we carry the previous
    // count forward instead of resetting counter_stock to 0.
    const counterByIngredient = {};
    closings.forEach(closing => {
        (closing.inventory_report || []).forEach(item => {
            if (item?.ingredient && item.remaining != null && counterByIngredient[item.ingredient] === undefined) {
                counterByIngredient[item.ingredient] = Number(item.remaining);
            }
        });
    });

    return Array.from(ingredients).map(ing => {
        // Σ refill
        const totalRefill = expenses
            .filter(e => e.metadata?.ingredient === ing)
            .reduce((sum, e) => sum + (Number(e.metadata?.qty) || 0), 0);

        // Σ restock
        const totalRestock = closings
            .reduce((sum, s) => {
                const item = (s.inventory_report || []).find(i => i.ingredient === ing);
                return sum + (Number(item?.restock) || 0);
            }, 0);

        const warehouse = Math.max(0, totalRefill - totalRestock);
        const item = (latestClosing?.inventory_report || []).find(i => i.ingredient === ing);
        const counter = counterByIngredient[ing] ?? 0;

        return {
            ingredient: ing,
            current_stock: warehouse + counter,
            restocked_qty: Number(item?.restock) || 0,
            warehouse_stock: warehouse,
            counter_stock: counter
        };
    });
};

// Rename (or merge) an ingredient key across the same 4 stores the sync_ingredient_key
// RPC touches: ingredient_costs, recipes, shift_closings.inventory_report, expenses.metadata.
// Always-merge mode: if newKey already exists in ingredient_costs for this address, the
// oldKey cost row is dropped (newKey kept canonical) — mirrors migration 20260519/20260520.
// Scoped by address_id like every other guest helper. Returns the same shape as the RPC.
export const renameLocalIngredient = (addressId, oldKey, newKey) => {
    if (!oldKey || !newKey) {
        return { recipes_updated: 0, closings_updated: 0, expenses_updated: 0, costs_action: 'none' };
    }
    if (oldKey === newKey) {
        return { recipes_updated: 0, closings_updated: 0, expenses_updated: 0, costs_action: 'noop' };
    }

    // 1. ingredient_costs — rename or merge
    const costs = get(KEYS.INGREDIENT_COSTS);
    const oldIdx = costs.findIndex(c => c.ingredient === oldKey && c.address_id === addressId);
    const newExists = costs.some(c => c.ingredient === newKey && c.address_id === addressId);
    let costsAction = 'none';
    if (oldIdx >= 0 && newExists) {
        costs.splice(oldIdx, 1);          // merge: drop old, keep newKey as canonical
        costsAction = 'merged';
    } else if (oldIdx >= 0) {
        costs[oldIdx] = { ...costs[oldIdx], ingredient: newKey };
        costsAction = 'renamed';
    }
    set(KEYS.INGREDIENT_COSTS, costs);

    // 2. recipes — straight rename
    const recipes = get(KEYS.RECIPES);
    let recipesUpdated = 0;
    recipes.forEach(r => {
        if (r.address_id === addressId && r.ingredient === oldKey) {
            r.ingredient = newKey;
            recipesUpdated++;
        }
    });
    set(KEYS.RECIPES, recipes);

    // 3. shift_closings.inventory_report (array of { ingredient, remaining, restock, ... })
    const closings = get(KEYS.SHIFT_CLOSINGS);
    let closingsUpdated = 0;
    closings.forEach(sc => {
        if (sc.address_id !== addressId || !Array.isArray(sc.inventory_report)) return;
        let touched = false;
        sc.inventory_report.forEach(elem => {
            if (elem && elem.ingredient === oldKey) { elem.ingredient = newKey; touched = true; }
        });
        if (touched) closingsUpdated++;
    });
    set(KEYS.SHIFT_CLOSINGS, closings);

    // 4. expenses.metadata.ingredient (refill rows reference the ingredient by key)
    const expenses = get(KEYS.EXPENSES);
    let expensesUpdated = 0;
    expenses.forEach(e => {
        if (e.address_id === addressId && e.metadata && e.metadata.ingredient === oldKey) {
            e.metadata = { ...e.metadata, ingredient: newKey };
            expensesUpdated++;
        }
    });
    set(KEYS.EXPENSES, expenses);

    return {
        recipes_updated: recipesUpdated,
        closings_updated: closingsUpdated,
        expenses_updated: expensesUpdated,
        costs_action: costsAction,
    };
};

// Local fixed_costs CRUD removed — see expenseService.js comment.

// --- Expense Categories (tags for the profit report) ---
// Default seed matches the Supabase migration so guest and signed-in users see
// the same starter set. Categories are scoped per address.
const DEFAULT_EXPENSE_CATEGORIES = [
    { name: 'Lương nhân viên',     group_section: 'operating', sort_order: 10 },
    { name: 'Thuê mặt bằng',       group_section: 'operating', sort_order: 20 },
    { name: 'Điện nước',           group_section: 'operating', sort_order: 30 },
    { name: 'Marketing',           group_section: 'operating', sort_order: 40 },
    { name: 'Phần mềm / Hệ thống', group_section: 'operating', sort_order: 50 },
    { name: 'Chi phí khác',        group_section: 'operating', sort_order: 999 },
    { name: 'Lương quản lý',       group_section: 'overhead',  sort_order: 10 },
    { name: 'Khấu hao máy móc',    group_section: 'overhead',  sort_order: 20 },
    { name: 'Chi phí tài chính',   group_section: 'overhead',  sort_order: 30 },
    { name: 'Chi phí khác',        group_section: 'overhead',  sort_order: 999 },
    { name: 'Mua nguyên liệu',     group_section: 'inventory', sort_order: 10 },
    { name: 'Mua bao bì',          group_section: 'inventory', sort_order: 20 },
    { name: 'Chi phí khác',        group_section: 'non_operating', sort_order: 999 },
];

const seedLocalExpenseCategoriesIfNeeded = (addressId) => {
    const list = get(KEYS.EXPENSE_CATEGORIES);
    const hasAny = list.some(c => c.address_id === addressId && c.is_default);
    if (hasAny) return list;
    const seeded = DEFAULT_EXPENSE_CATEGORIES.map(d => ({
        id: generateId(),
        address_id: addressId,
        is_active: true,
        is_default: true,
        created_at: new Date().toISOString(),
        ...d,
    }));
    const next = [...list, ...seeded];
    set(KEYS.EXPENSE_CATEGORIES, next);
    return next;
};

export const fetchLocalExpenseCategories = (addressId) => {
    const list = seedLocalExpenseCategoriesIfNeeded(addressId);
    return list
        .filter(c => c.address_id === addressId && c.is_active)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
};

export const insertLocalExpenseCategory = (payload) => {
    const list = get(KEYS.EXPENSE_CATEGORIES);
    const newItem = {
        id: generateId(),
        is_active: true,
        is_default: false,
        sort_order: 100,
        created_at: new Date().toISOString(),
        ...payload,
    };
    list.push(newItem);
    set(KEYS.EXPENSE_CATEGORIES, list);
    return newItem;
};

export const updateLocalExpenseCategory = (id, updates) => {
    const list = get(KEYS.EXPENSE_CATEGORIES);
    const idx = list.findIndex(c => c.id === id);
    if (idx >= 0) {
        list[idx] = { ...list[idx], ...updates, updated_at: new Date().toISOString() };
        set(KEYS.EXPENSE_CATEGORIES, list);
        return list[idx];
    }
    return null;
};

export const deleteLocalExpenseCategory = (id) => {
    const list = get(KEYS.EXPENSE_CATEGORIES);
    const idx = list.findIndex(c => c.id === id);
    if (idx >= 0) {
        list[idx].is_active = false;
        list[idx].updated_at = new Date().toISOString();
        set(KEYS.EXPENSE_CATEGORIES, list);
    }
    return true;
};

export const upsertLocalShiftClosing = (payload) => {
    const list = get(KEYS.SHIFT_CLOSINGS);
    const dateStr = dateStringVN();
    const idx = list.findIndex(s => s.address_id === payload.address_id && dateStringVN(new Date(s.created_at)) === dateStr);
    if (idx >= 0) {
        list[idx] = { ...list[idx], ...payload };
    } else {
        list.push({ ...payload, id: generateId(), created_at: new Date().toISOString() });
    }
    set(KEYS.SHIFT_CLOSINGS, list);
};

// --- Sync Helper ---
export const getGuestDataForSync = () => {
    return {
        products: get(KEYS.PRODUCTS),
        recipes: get(KEYS.RECIPES),
        ingredients: get(KEYS.INGREDIENT_COSTS),
        extras: get(KEYS.PRODUCT_EXTRAS),
        extraIngredients: get(KEYS.EXTRA_INGREDIENTS)
    };
};

export const clearGuestData = () => {
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    // KEY_GUEST_INGREDIENT_SORT lives outside KEYS, so clear it explicitly — otherwise a
    // stale guest sort order leaks into the next guest session or a real account.
    localStorage.removeItem(KEY_GUEST_INGREDIENT_SORT);
};

// --- Missing Product & Order Helpers ---
export const updateLocalProductPrice = (productId, price) => {
    const products = get(KEYS.PRODUCTS);
    const p = products.find(p => p.id === productId);
    if (p) { p.price = price; set(KEYS.PRODUCTS, products); }
};

export const updateLocalProductCountAsCup = (productId, countAsCup) => {
    const products = get(KEYS.PRODUCTS);
    const p = products.find(p => p.id === productId);
    if (p) { p.count_as_cup = countAsCup; set(KEYS.PRODUCTS, products); }
};

export const updateLocalProductSortOrder = (orderedProductIds) => {
    const products = get(KEYS.PRODUCTS);
    orderedProductIds.forEach((id, index) => {
        const p = products.find(p => p.id === id);
        if (p) p.sort_order = index;
    });
    set(KEYS.PRODUCTS, products);
};

// Soft-delete a product (mirror of the remote `is_active = false` write). Lives here so
// callers never reach into localStorage with an out-of-module key constant.
export const deleteLocalProduct = (productId) => {
    const products = get(KEYS.PRODUCTS);
    const idx = products.findIndex(p => p.id === productId);
    if (idx >= 0) {
        products[idx].is_active = false;
        set(KEYS.PRODUCTS, products);
    }
    return true;
};

export const updateLocalExpense = (id, updates) => {
    const list = get(KEYS.EXPENSES);
    const idx = list.findIndex(e => e.id === id);
    if (idx >= 0) {
        list[idx] = { ...list[idx], ...updates, updated_at: new Date().toISOString() };
        set(KEYS.EXPENSES, list);
        return list[idx];
    }
    return null;
};

export const deleteLocalExpense = (expenseId) => {
    let expenses = get(KEYS.EXPENSES);
    expenses = expenses.filter(e => e.id !== expenseId);
    set(KEYS.EXPENSES, expenses);
    return true;
};

export const deleteLocalOrder = (orderId, staffName) => {
    const orders = get(KEYS.ORDERS);
    const o = orders.find(o => o.id === orderId);
    if (o) {
        o.deleted_at = new Date().toISOString();
        o.deleted_by = staffName;
        set(KEYS.ORDERS, orders);
    }
    return true;
};

export const deleteLocalRecipeRow = (productId, ingredient) => {
    let recipes = get(KEYS.RECIPES);
    recipes = recipes.filter(r => !(r.product_id === productId && r.ingredient === ingredient));
    set(KEYS.RECIPES, recipes);
};

export const deleteLocalIngredientCost = (ingredient) => {
    let costs = get(KEYS.INGREDIENT_COSTS);
    costs = costs.filter(c => c.ingredient !== ingredient);
    set(KEYS.INGREDIENT_COSTS, costs);
};

// --- Missing Extras Helpers ---
export const insertLocalProductExtra = (payload) => {
    const extras = get(KEYS.PRODUCT_EXTRAS);
    const maxSort = extras.filter(e => e.product_id === payload.product_id).reduce((max, e) => Math.max(max, e.sort_order || -1), -1);
    const newExtra = { id: generateId(), sort_order: maxSort + 1, is_sticky: false, ...payload };
    extras.push(newExtra);
    set(KEYS.PRODUCT_EXTRAS, extras);
    return newExtra;
};

export const updateLocalProductExtraName = (extraId, name) => {
    const extras = get(KEYS.PRODUCT_EXTRAS);
    const e = extras.find(e => e.id === extraId);
    if (e) { e.name = name; set(KEYS.PRODUCT_EXTRAS, extras); }
};

export const updateLocalProductExtraPrice = (extraId, price) => {
    const extras = get(KEYS.PRODUCT_EXTRAS);
    const e = extras.find(e => e.id === extraId);
    if (e) { e.price = price; set(KEYS.PRODUCT_EXTRAS, extras); }
};

export const updateLocalProductExtraSticky = (extraId, isSticky) => {
    const extras = get(KEYS.PRODUCT_EXTRAS);
    const e = extras.find(e => e.id === extraId);
    if (e) { e.is_sticky = isSticky; set(KEYS.PRODUCT_EXTRAS, extras); }
};

export const updateLocalExtrasSortOrder = (orderedExtraIds) => {
    const extras = get(KEYS.PRODUCT_EXTRAS);
    orderedExtraIds.forEach((id, index) => {
        const e = extras.find(e => e.id === id);
        if (e) e.sort_order = index;
    });
    set(KEYS.PRODUCT_EXTRAS, extras);
};

export const duplicateLocalProductExtra = (extraId, newName, addressId) => {
    const extras = get(KEYS.PRODUCT_EXTRAS);
    const src = extras.find(e => e.id === extraId);
    if (!src) return null;
    
    const maxSort = extras.filter(e => e.product_id === src.product_id).reduce((max, e) => Math.max(max, e.sort_order || -1), -1);
    const newExtra = { id: generateId(), product_id: src.product_id, name: newName, price: src.price, address_id: addressId, sort_order: maxSort + 1, is_sticky: false };
    extras.push(newExtra);
    set(KEYS.PRODUCT_EXTRAS, extras);

    const extraIngs = get(KEYS.EXTRA_INGREDIENTS);
    const srcIngs = extraIngs.filter(i => i.extra_id === extraId);
    srcIngs.forEach(i => {
        extraIngs.push({ ...i, id: generateId(), extra_id: newExtra.id });
    });
    set(KEYS.EXTRA_INGREDIENTS, extraIngs);

    return newExtra;
};

export const deleteLocalProductExtra = (extraId) => {
    let extras = get(KEYS.PRODUCT_EXTRAS);
    extras = extras.filter(e => e.id !== extraId);
    set(KEYS.PRODUCT_EXTRAS, extras);
    
    let extraIngs = get(KEYS.EXTRA_INGREDIENTS);
    extraIngs = extraIngs.filter(i => i.extra_id !== extraId);
    set(KEYS.EXTRA_INGREDIENTS, extraIngs);
    return true;
};

export const upsertLocalExtraIngredient = (payload) => {
    const extraIngs = get(KEYS.EXTRA_INGREDIENTS);
    const idx = extraIngs.findIndex(i => i.extra_id === payload.extra_id && i.ingredient === payload.ingredient);
    if (idx >= 0) {
        extraIngs[idx] = { ...extraIngs[idx], ...payload };
    } else {
        extraIngs.push({ id: generateId(), ...payload });
    }
    set(KEYS.EXTRA_INGREDIENTS, extraIngs);
};

export const deleteLocalExtraIngredient = (extraId, ingredient) => {
    let extraIngs = get(KEYS.EXTRA_INGREDIENTS);
    extraIngs = extraIngs.filter(i => !(i.extra_id === extraId && i.ingredient === ingredient));
    set(KEYS.EXTRA_INGREDIENTS, extraIngs);
    return true;
};
