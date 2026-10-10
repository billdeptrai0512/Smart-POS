import * as XLSX from 'xlsx'
import { normalizeIngredientKey } from '../utils/ingredients'
import { insertProduct, upsertProductPrice, insertProductExtra, updateProductExtraPrice, updateProductExtraSticky, upsertExtraIngredient } from './productService'
import { upsertIngredientCost } from './ingredientCostService'
import { insertTopping, updateToppingPrice, upsertToppingIngredient, setToppingProductLinks } from './toppingService'
import { upsertRecipes } from './recipeService'
import { insertDiscountProgram, updateDiscountProgram, deleteDiscountProgram, setDiscountProgramProducts } from './discountService'
import { supabase } from '../lib/supabaseClient'
import * as localRepo from './localRepository'
import type { UUID } from '../types/domain'

// Nhập liệu hàng loạt từ 1 file Excel (.xlsx) do CHÚNG TA thiết kế layout — khách chỉ điền
// theo mẫu (public/templates/mau-nhap-lieu.xlsx), nên không cần lo parse format tuỳ ý.
// 2 hàm tách bạch: resolveImportPlan (thuần, không gọi mạng — dùng cho màn xem trước) và
// commitImportPlan (gọi service layer có sẵn theo đúng thứ tự phụ thuộc FK).

interface ParsedWorkbook {
    products: Record<string, unknown>[]
    ingredients: Record<string, unknown>[]
    recipes: Record<string, unknown>[]
    toppings: Record<string, unknown>[]
    toppingIngredients: Record<string, unknown>[]
    toppingLinks: Record<string, unknown>[]
    extras: Record<string, unknown>[]
    extraIngredients: Record<string, unknown>[]
    discounts?: Record<string, unknown>[]
    discountLinks?: Record<string, unknown>[]
    sheets?: string[] // tên các sheet CÓ trong file — sheet có mặt = ghi đè toàn bộ phần đó
}

export function parseWorkbook(arrayBuffer: ArrayBuffer): ParsedWorkbook {
    const wb = XLSX.read(arrayBuffer, { type: 'array' })
    const sheet = (name: string) => {
        const ws = wb.Sheets[name]
        return ws ? XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' }) : []
    }
    return {
        products: sheet('Sản phẩm'),
        ingredients: sheet('Nguyên liệu'),
        recipes: sheet('Công thức'),
        toppings: sheet('Topping'),
        toppingIngredients: sheet('Công thức Topping'),
        toppingLinks: sheet('Topping áp dụng món'),
        extras: sheet('Tùy chọn thêm'),
        extraIngredients: sheet('Công thức tùy chọn'),
        discounts: sheet('Giảm giá'),
        discountLinks: sheet('Giảm giá áp dụng món'),
        sheets: wb.SheetNames,
    }
}

function normName(v: unknown): string {
    return String(v ?? '').trim()
}

// Key dùng để so khớp/gộp tên (Set/Map) xuyên suốt file này — KHÔNG dùng cho giá trị hiển thị.
// .normalize('NFC') vì Excel/macOS đôi khi lưu tên có dấu ở dạng tổ hợp (NFD, "a" + dấu rời)
// trong khi dữ liệu đã có trong DB (gõ qua trình duyệt) thường là NFC — thiếu bước này, 2 tên
// NHÌN GIỐNG HỆT NHAU trên Excel/UI sẽ bị coi là khác nhau và tạo trùng thay vì cập nhật/khớp.
function normKey(v: unknown): string {
    return normName(v).normalize('NFC').toLowerCase()
}

function toNumber(v: unknown): number | null {
    if (v === '' || v == null) return null
    const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'))
    return Number.isFinite(n) ? n : null
}

function toBool(v: unknown): boolean {
    const s = normKey(v)
    return s === 'có' || s === 'x' || s === 'true' || s === '1'
}

// Loại chỉ có 2 giá trị thật (main/packaging) — 'tools' là giá trị legacy, không cho import
// tạo ra (mirror normalizeIngredientCategory ở src/utils/ingredients.ts).
function mapCategory(raw: unknown): 'main' | 'packaging' {
    const v = normKey(raw)
    if (v.includes('bao bì') || v.includes('đóng gói') || v === 'packaging' || v === 'tools') return 'packaging'
    return 'main'
}

// Quy cách đóng gói + ngưỡng tồn của nguyên liệu. Key = tên opts của upsertIngredientCost. Chỉ cột nào
// CÓ trong sheet mới vào attrs (ô trống = xoá giá trị); file không có cột nào → giữ nguyên như cũ.
interface IngredientAttrs {
    packSize?: number | null; packUnit?: string | null; pack2Size?: number | null; pack2Unit?: string | null
    minStock?: number | null; minCounterStock?: number | null
}
const INGREDIENT_ATTR_COLUMNS: Array<{ header: string; key: keyof IngredientAttrs; col: string; text?: boolean }> = [
    { header: 'Quy cách', key: 'packSize', col: 'pack_size' },
    { header: 'Đơn vị quy cách', key: 'packUnit', col: 'pack_unit', text: true },
    { header: 'Quy cách 2', key: 'pack2Size', col: 'pack2_size' },
    { header: 'Đơn vị quy cách 2', key: 'pack2Unit', col: 'pack2_unit', text: true },
    { header: 'Tồn kho tối thiểu', key: 'minStock', col: 'min_stock' },
    { header: 'Tồn quầy tối thiểu', key: 'minCounterStock', col: 'min_counter_stock' },
]

// Trả cột lỗi đầu tiên (header) nếu ô số không hợp lệ.
function parseIngredientAttrs(row: Record<string, unknown>): { attrs?: IngredientAttrs; badHeader?: string } {
    const attrs: Record<string, number | string | null> = {}
    for (const { header, key, text } of INGREDIENT_ATTR_COLUMNS) {
        if (!(header in row)) continue
        if (text) { attrs[key] = normName(row[header]) || null; continue }
        const n = toNumber(row[header])
        if ((n == null && normName(row[header]) !== '') || (n != null && n < 0)) return { badHeader: header }
        attrs[key] = n
    }
    return Object.keys(attrs).length ? { attrs } : {}
}

// Chương trình giảm giá (discount_programs) — type/value/lịch như DiscountProgramsPage.
interface DiscountPlan {
    name: string; type: 'fixed' | 'percent' | 'amount'; value: number
    days: number[]; startDate: string | null; endDate: string | null; enabled: boolean
}

const DISCOUNT_TYPE_BY_LABEL: Record<string, DiscountPlan['type']> = {
    'đồng giá': 'fixed', 'giảm %': 'percent', 'giảm tiền': 'amount',
}
const DOW_BY_LABEL: Record<string, number> = { cn: 0, t2: 1, t3: 2, t4: 3, t5: 4, t6: 5, t7: 6 }

// Ô "Thứ áp dụng": "T2, T3, CN" → [0,1,2] (EXTRACT(DOW), rỗng = mọi thứ). null nếu có token lạ.
function parseDays(raw: unknown): number[] | null {
    const out = new Set<number>()
    for (const tok of normKey(raw).split(/[\s,;]+/).filter(Boolean)) {
        const d = DOW_BY_LABEL[tok]
        if (d === undefined) return null
        out.add(d)
    }
    return [...out].sort()
}

// Ô ngày: "YYYY-MM-DD" hoặc số serial Excel (ô ngày gõ trong Excel). '' → null; không đọc được → undefined.
function toIsoDate(v: unknown): string | null | undefined {
    if (v === '' || v == null) return null
    const fmt = (y: string | number, m: string | number, d: string | number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    if (typeof v === 'number') {
        const d = XLSX.SSF.parse_date_code(v)
        return d ? fmt(d.y, d.m, d.d) : undefined
    }
    const s = String(v).trim()
    const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
    return iso ? fmt(iso[1], iso[2], iso[3]) : undefined
}

// Ghi đè: sheet nào CÓ trong file thì phần đó trên địa chỉ được thay hoàn toàn bằng nội dung file
// (kể cả sheet rỗng = xoá hết). Sheet KHÔNG có trong file → giữ nguyên, để 1 file thiếu sheet không
// vô tình xoá sạch. Nguyên liệu không bao giờ bị xoá (gắn với tồn kho / lịch sử nhập hàng).
interface ReplaceFlags {
    products: boolean; toppings: boolean; extras: boolean
    recipes: boolean; toppingIngredients: boolean; extraIngredients: boolean; toppingLinks: boolean
    discounts: boolean; discountLinks: boolean
}

interface ImportPlan {
    replace: ReplaceFlags
    removals: { products: string[]; dividers: string[]; toppings: string[]; extras: string[]; discounts: string[] } // chỉ để xem trước
    dividers: string[] // danh mục MỚI (dòng "mục" is_divider) — tạo trước khi xếp thứ tự
    layout: Array<{ name: string; divider: boolean }> // thứ tự mới của món + danh mục; rỗng = không đổi thứ tự
    products: Array<{ name: string; price: number }>
    productUpdates: Array<{ name: string; price: number }>
    // group: có khi sheet có cột "Nhóm" ('' = bỏ nhóm); undefined = giữ nhóm hiện tại
    ingredients: Array<{ key: string; unitCost: number; unit: string; category: 'main' | 'packaging'; group?: string; attrs?: IngredientAttrs }>
    ingredientUpdates: Array<{ key: string; unitCost: number; unit: string; category: 'main' | 'packaging'; group?: string; attrs?: IngredientAttrs }>
    toppings: Array<{ name: string; price: number; unit: string }>
    toppingUpdates: Array<{ name: string; price: number }>
    recipes: Array<{ productName: string; ingredient: string; amount: number; unit: string | null }>
    toppingIngredients: Array<{ toppingName: string; ingredient: string; amount: number; unit: string | null }>
    toppingLinks: Array<{ toppingName: string; productNames: string[] }>
    extras: Array<{ productName: string; name: string; price: number; sticky: boolean }>
    extraUpdates: Array<{ productName: string; name: string; price: number; sticky: boolean }>
    extraIngredients: Array<{ productName: string; extraName: string; ingredient: string; amount: number; unit: string | null }>
    discounts: DiscountPlan[]
    discountUpdates: DiscountPlan[]
    discountLinks: Array<{ programName: string; productNames: string[] }>
}

export interface ExistingData {
    products: Array<{ id: UUID; name: string; is_divider?: boolean }>
    toppings: Array<{ id: UUID; name: string }>
    ingredientCosts: Record<string, unknown>
    extras: Array<{ id: UUID; productName: string; name: string }>
    discountPrograms: Array<{ id: UUID; name: string }>
}

interface ResolveResult {
    plan: ImportPlan
    blockingErrors: string[]
    warnings: string[]
}

// Thuần — không gọi mạng, dùng cho màn xem trước. Khớp tên case-insensitive với dữ liệu
// ĐÃ CÓ (products/toppings truyền vào) — sản phẩm/topping sẽ được tạo trong CÙNG lần import
// này (VD dòng ở sheet Công thức trỏ tới 1 tên nằm trong sheet Sản phẩm) cũng tính là "sẽ có".
export function resolveImportPlan(parsed: ParsedWorkbook, existing: ExistingData): ResolveResult {
    const blockingErrors: string[] = []
    const warnings: string[] = []

    // Dòng "mục" (is_divider) không phải món bán → không khớp tên với dòng Sản phẩm.
    const has = (name: string) => parsed.sheets?.includes(name) ?? false
    const replace: ReplaceFlags = {
        products: has('Sản phẩm'), toppings: has('Topping'), extras: has('Tùy chọn thêm'),
        recipes: has('Công thức'), toppingIngredients: has('Công thức Topping'),
        extraIngredients: has('Công thức tùy chọn'), toppingLinks: has('Topping áp dụng món'),
        discounts: has('Giảm giá'), discountLinks: has('Giảm giá áp dụng món'),
    }
    const existingDiscounts = existing.discountPrograms
    const existingProductNames = new Set(existing.products.filter(p => !p.is_divider).map(p => normKey(p.name)))
    const existingDividerNames = new Set(existing.products.filter(p => p.is_divider).map(p => normKey(p.name)))
    const existingToppingNames = new Set(existing.toppings.map(t => normKey(t.name)))
    const existingIngredientKeys = new Set(Object.keys(existing.ingredientCosts))

    // true nếu name có trong set; ngược lại tự đẩy cảnh báo "bỏ qua" và trả false.
    const requireName = (set: Set<string>, name: string, label: string, sheetName: string, line: string) => {
        if (set.has(normKey(name))) return true
        warnings.push(`Bỏ qua ${line}: không tìm thấy ${label} "${name}" (kiểm tra sheet ${sheetName})`)
        return false
    }

    // ---- Sản phẩm ---- (trùng tên → cập nhật giá, không tạo trùng)
    const products: ImportPlan['products'] = []
    const productUpdates: ImportPlan['productUpdates'] = []
    const seenProductNames = new Set<string>()
    const productRows: Array<{ name: string; category: string }> = [] // thứ tự dòng trong file
    // existing ∪ sẽ-tạo, dùng để resolve Công thức/Topping áp dụng món. Ghi đè → chỉ món trong file.
    const allProductNames = new Set(replace.products ? [] : existingProductNames)
    parsed.products.forEach((row, i) => {
        const name = normName(row['Tên món'])
        const price = toNumber(row['Giá bán'])
        const line = `Sản phẩm dòng ${i + 2}`
        if (!name) { blockingErrors.push(`${line}: thiếu Tên món`); return }
        if (price == null) { blockingErrors.push(`${line} ("${name}"): Giá bán không hợp lệ`); return }
        const key = normKey(name)
        if (seenProductNames.has(key)) { blockingErrors.push(`${line}: tên "${name}" bị lặp trong sheet Sản phẩm`); return }
        seenProductNames.add(key)
        allProductNames.add(key)
        if (existingProductNames.has(key)) productUpdates.push({ name, price })
        else products.push({ name, price })
        productRows.push({ name, category: normName(row['Danh mục']) })
    })

    // Cột "Danh mục" (tuỳ chọn): có ít nhất 1 ô điền → xếp lại menu theo file: món không danh mục
    // đứng đầu, rồi từng danh mục (theo thứ tự xuất hiện đầu tiên) kèm món của nó theo thứ tự dòng.
    const dividers: string[] = []
    const layout: ImportPlan['layout'] = []
    if (replace.products || productRows.some(r => r.category)) {
        const groups = new Map<string, { name: string; items: string[] }>()
        for (const r of productRows) {
            const k = r.category ? normKey(r.category) : ''
            if (!groups.has(k)) groups.set(k, { name: r.category, items: [] })
            groups.get(k)!.items.push(r.name)
        }
        const uncategorized = groups.get('')
        groups.delete('')
        for (const name of uncategorized?.items ?? []) layout.push({ name, divider: false })
        for (const [k, g] of groups) {
            if (!existingDividerNames.has(k)) dividers.push(g.name)
            layout.push({ name: g.name, divider: true })
            for (const name of g.items) layout.push({ name, divider: false })
        }
    }

    // ---- Nguyên liệu ---- (trùng tên → cập nhật giá vốn + đơn vị)
    const ingredients: ImportPlan['ingredients'] = []
    const ingredientUpdates: ImportPlan['ingredientUpdates'] = []
    const seenIngredientKeys = new Set<string>()
    const allIngredientKeys = new Set(existingIngredientKeys) // existing ∪ sẽ-tạo (kể cả tự phát hiện từ công thức, thêm bên dưới)
    parsed.ingredients.forEach((row, i) => {
        const name = normName(row['Tên nguyên liệu'])
        const line = `Nguyên liệu dòng ${i + 2}`
        if (!name) { blockingErrors.push(`${line}: thiếu Tên nguyên liệu`); return }
        const key = normalizeIngredientKey(name)
        if (seenIngredientKeys.has(key)) { blockingErrors.push(`${line}: tên "${name}" bị lặp trong sheet Nguyên liệu`); return }
        seenIngredientKeys.add(key)
        const costRaw = row['Giá vốn/đơn vị']
        const cost = costRaw === '' || costRaw == null ? 0 : toNumber(costRaw)
        if (cost == null) { blockingErrors.push(`${line} ("${name}"): Giá vốn/đơn vị không hợp lệ`); return }
        const entry: ImportPlan['ingredients'][number] = { key, unitCost: cost, unit: normName(row['Đơn vị']) || 'đv', category: mapCategory(row['Loại']) }
        if ('Nhóm' in row) entry.group = normName(row['Nhóm'])
        const { attrs, badHeader } = parseIngredientAttrs(row)
        if (badHeader) { blockingErrors.push(`${line} ("${name}"): ${badHeader} không hợp lệ`); return }
        if (attrs) entry.attrs = attrs
        allIngredientKeys.add(key)
        if (existingIngredientKeys.has(key)) ingredientUpdates.push(entry)
        else ingredients.push(entry)
    })

    // ---- Topping ---- (trùng tên → cập nhật giá bán; đơn vị tồn kho của topping đã có giữ nguyên)
    const toppings: ImportPlan['toppings'] = []
    const toppingUpdates: ImportPlan['toppingUpdates'] = []
    const seenToppingNames = new Set<string>()
    const allToppingNames = new Set(replace.toppings ? [] : existingToppingNames)
    parsed.toppings.forEach((row, i) => {
        const name = normName(row['Tên topping'])
        const price = toNumber(row['Giá bán'])
        const line = `Topping dòng ${i + 2}`
        if (!name) { blockingErrors.push(`${line}: thiếu Tên topping`); return }
        if (price == null) { blockingErrors.push(`${line} ("${name}"): Giá bán không hợp lệ`); return }
        const key = normKey(name)
        if (seenToppingNames.has(key)) { blockingErrors.push(`${line}: tên "${name}" bị lặp trong sheet Topping`); return }
        seenToppingNames.add(key)
        allToppingNames.add(key)
        if (existingToppingNames.has(key)) toppingUpdates.push({ name, price })
        else toppings.push({ name, price, unit: normName(row['Đơn vị tồn kho']) || 'đv' })
    })

    // ---- Tùy chọn thêm ---- (trùng món+tên tùy chọn → cập nhật giá + cờ tự động chọn)
    const extras: ImportPlan['extras'] = []
    const extraUpdates: ImportPlan['extraUpdates'] = []
    const seenExtraKeys = new Set<string>()
    const existingExtraKeys = new Set(existing.extras.map(e => `${normKey(e.productName)}|${normKey(e.name)}`))
    const allExtraKeys = new Set(replace.extras ? [] : existingExtraKeys) // existing ∪ sẽ-tạo, dùng để resolve Công thức tùy chọn
    parsed.extras.forEach((row, i) => {
        const productName = normName(row['Tên món'])
        const name = normName(row['Tên tùy chọn'])
        const price = toNumber(row['Giá'])
        const line = `Tùy chọn thêm dòng ${i + 2}`
        if (!productName) { blockingErrors.push(`${line}: thiếu Tên món`); return }
        if (!name) { blockingErrors.push(`${line}: thiếu Tên tùy chọn`); return }
        if (price == null) { blockingErrors.push(`${line} ("${productName}" / "${name}"): Giá không hợp lệ`); return }
        if (!requireName(allProductNames, productName, 'món', 'Sản phẩm', line)) return
        const key = `${normKey(productName)}|${normKey(name)}`
        if (seenExtraKeys.has(key)) { blockingErrors.push(`${line}: tùy chọn "${name}" bị lặp cho món "${productName}" trong sheet Tùy chọn thêm`); return }
        seenExtraKeys.add(key)
        allExtraKeys.add(key)
        const sticky = toBool(row['Tự động chọn'])
        if (existingExtraKeys.has(key)) extraUpdates.push({ productName, name, price, sticky })
        else extras.push({ productName, name, price, sticky })
    })

    // Nguyên liệu chỉ nhắc tới trong Công thức/Công thức Topping (chưa có dòng riêng ở sheet
    // Nguyên liệu) → tự đăng ký placeholder giá vốn 0, cùng nguyên tắc registerNewIngredients —
    // đơn vị lấy từ chính dòng gặp đầu tiên (không hardcode 'đv'), vì màn chi tiết công thức/
    // topping hiển thị ĐƠN VỊ GỐC của nguyên liệu (ingredient_costs.unit), không phải cột Đơn
    // vị riêng của từng dòng recipes/topping_ingredients.
    function ensureIngredientKey(name: string, unit: string) {
        const key = normalizeIngredientKey(name)
        if (!allIngredientKeys.has(key)) {
            allIngredientKeys.add(key)
            ingredients.push({ key, unitCost: 0, unit: unit || 'đv', category: 'main' })
        }
        return key
    }

    // ---- Công thức ----
    const recipes: ImportPlan['recipes'] = []
    parsed.recipes.forEach((row, i) => {
        const productName = normName(row['Tên món'])
        const ingredientName = normName(row['Tên nguyên liệu'])
        const amount = toNumber(row['Số lượng'])
        const line = `Công thức dòng ${i + 2}`
        if (!productName) { blockingErrors.push(`${line}: thiếu Tên món`); return }
        if (!ingredientName) { blockingErrors.push(`${line}: thiếu Tên nguyên liệu`); return }
        if (amount == null) { blockingErrors.push(`${line} ("${productName}" / "${ingredientName}"): Số lượng không hợp lệ`); return }
        if (!requireName(allProductNames, productName, 'món', 'Sản phẩm', line)) return
        const unit = normName(row['Đơn vị'])
        recipes.push({ productName, ingredient: ensureIngredientKey(ingredientName, unit), amount, unit: unit || null })
    })

    // ---- Công thức Topping ----
    const toppingIngredients: ImportPlan['toppingIngredients'] = []
    parsed.toppingIngredients.forEach((row, i) => {
        const toppingName = normName(row['Tên topping'])
        const ingredientName = normName(row['Tên nguyên liệu'])
        const amount = toNumber(row['Số lượng'])
        const line = `Công thức Topping dòng ${i + 2}`
        if (!toppingName) { blockingErrors.push(`${line}: thiếu Tên topping`); return }
        if (!ingredientName) { blockingErrors.push(`${line}: thiếu Tên nguyên liệu`); return }
        if (amount == null) { blockingErrors.push(`${line} ("${toppingName}" / "${ingredientName}"): Số lượng không hợp lệ`); return }
        if (!requireName(allToppingNames, toppingName, 'topping', 'Topping', line)) return
        const unit = normName(row['Đơn vị'])
        toppingIngredients.push({ toppingName, ingredient: ensureIngredientKey(ingredientName, unit), amount, unit: unit || null })
    })

    // ---- Công thức tùy chọn ----
    const extraIngredientsPlan: ImportPlan['extraIngredients'] = []
    parsed.extraIngredients.forEach((row, i) => {
        const productName = normName(row['Tên món'])
        const extraName = normName(row['Tên tùy chọn'])
        const ingredientName = normName(row['Tên nguyên liệu'])
        const amount = toNumber(row['Số lượng'])
        const line = `Công thức tùy chọn dòng ${i + 2}`
        if (!productName) { blockingErrors.push(`${line}: thiếu Tên món`); return }
        if (!extraName) { blockingErrors.push(`${line}: thiếu Tên tùy chọn`); return }
        if (!ingredientName) { blockingErrors.push(`${line}: thiếu Tên nguyên liệu`); return }
        if (amount == null) { blockingErrors.push(`${line} ("${productName}" / "${extraName}" / "${ingredientName}"): Số lượng không hợp lệ`); return }
        const extraKey = `${normKey(productName)}|${normKey(extraName)}`
        if (!allExtraKeys.has(extraKey)) {
            warnings.push(`Bỏ qua ${line}: không tìm thấy tùy chọn "${extraName}" của món "${productName}" (kiểm tra sheet Tùy chọn thêm)`)
            return
        }
        const unit = normName(row['Đơn vị'])
        extraIngredientsPlan.push({ productName, extraName, ingredient: ensureIngredientKey(ingredientName, unit), amount, unit: unit || null })
    })

    // ---- Topping áp dụng món ---- (gom theo topping — 1 dòng = 1 liên kết)
    const linksByTopping = new Map<string, { toppingName: string; productNames: string[] }>()
    parsed.toppingLinks.forEach((row, i) => {
        const toppingName = normName(row['Tên topping'])
        const productName = normName(row['Tên món'])
        const line = `Topping áp dụng món dòng ${i + 2}`
        if (!toppingName) { blockingErrors.push(`${line}: thiếu Tên topping`); return }
        if (!productName) { blockingErrors.push(`${line}: thiếu Tên món`); return }
        if (!requireName(allToppingNames, toppingName, 'topping', 'Topping', line)) return
        if (!requireName(allProductNames, productName, 'món', 'Sản phẩm', line)) return
        const key = normKey(toppingName)
        if (!linksByTopping.has(key)) linksByTopping.set(key, { toppingName, productNames: [] })
        linksByTopping.get(key)!.productNames.push(productName)
    })

    // ---- Giảm giá ---- (trùng tên → cập nhật; ghi đè → chương trình ngoài file bị xoá, xem commitDiscounts)
    const discounts: DiscountPlan[] = []
    const discountUpdates: DiscountPlan[] = []
    const seenDiscountNames = new Set<string>()
    const existingDiscountNames = new Set(existingDiscounts.map(d => normKey(d.name)))
    const allDiscountNames = new Set(replace.discounts ? [] : existingDiscountNames)
    ;(parsed.discounts ?? []).forEach((row, i) => {
        const name = normName(row['Tên chương trình'])
        const line = `Giảm giá dòng ${i + 2}`
        if (!name) { blockingErrors.push(`${line}: thiếu Tên chương trình`); return }
        const type = DISCOUNT_TYPE_BY_LABEL[normKey(row['Kiểu'])]
        if (!type) { blockingErrors.push(`${line} ("${name}"): Kiểu phải là Đồng giá / Giảm % / Giảm tiền`); return }
        const rawValue = toNumber(row['Giá trị'])
        if (rawValue == null || rawValue < 0 || (type === 'percent' && rawValue > 100)) { blockingErrors.push(`${line} ("${name}"): Giá trị không hợp lệ`); return }
        const days = parseDays(row['Thứ áp dụng'])
        if (!days) { blockingErrors.push(`${line} ("${name}"): Thứ áp dụng chỉ nhận T2..T7, CN (cách nhau bằng dấu phẩy)`); return }
        const startDate = toIsoDate(row['Từ ngày'])
        const endDate = toIsoDate(row['Đến ngày'])
        if (startDate === undefined || endDate === undefined) { blockingErrors.push(`${line} ("${name}"): Ngày phải dạng YYYY-MM-DD`); return }
        const key = normKey(name)
        if (seenDiscountNames.has(key)) { blockingErrors.push(`${line}: tên "${name}" bị lặp trong sheet Giảm giá`); return }
        seenDiscountNames.add(key)
        allDiscountNames.add(key)
        const entry: DiscountPlan = { name, type, value: Math.round(rawValue), days, startDate, endDate, enabled: toBool(row['Bật']) }
        if (existingDiscountNames.has(key)) discountUpdates.push(entry)
        else discounts.push(entry)
    })

    // ---- Giảm giá áp dụng món ---- (có sheet → danh sách món của MỌI chương trình trong file bị thay hoàn toàn)
    const linksByDiscount = new Map<string, { programName: string; productNames: string[] }>()
    if (replace.discountLinks) {
        for (const d of [...discounts, ...discountUpdates]) linksByDiscount.set(normKey(d.name), { programName: d.name, productNames: [] })
    }
    ;(parsed.discountLinks ?? []).forEach((row, i) => {
        const programName = normName(row['Tên chương trình'])
        const productName = normName(row['Tên món'])
        const line = `Giảm giá áp dụng món dòng ${i + 2}`
        if (!programName) { blockingErrors.push(`${line}: thiếu Tên chương trình`); return }
        if (!productName) { blockingErrors.push(`${line}: thiếu Tên món`); return }
        if (!requireName(allDiscountNames, programName, 'chương trình giảm giá', 'Giảm giá', line)) return
        if (!requireName(allProductNames, productName, 'món', 'Sản phẩm', line)) return
        const key = normKey(programName)
        if (!linksByDiscount.has(key)) linksByDiscount.set(key, { programName, productNames: [] })
        linksByDiscount.get(key)!.productNames.push(productName)
    })

    const categoryKeys = new Set(layout.filter(l => l.divider).map(l => normKey(l.name)))
    const removals = {
        products: replace.products ? existing.products.filter(p => !p.is_divider && !seenProductNames.has(normKey(p.name))).map(p => p.name) : [],
        dividers: replace.products ? existing.products.filter(p => p.is_divider && !categoryKeys.has(normKey(p.name))).map(p => p.name) : [],
        toppings: replace.toppings ? existing.toppings.filter(t => !seenToppingNames.has(normKey(t.name))).map(t => t.name) : [],
        extras: replace.extras ? existing.extras.filter(e => !seenExtraKeys.has(`${normKey(e.productName)}|${normKey(e.name)}`)).map(e => `${e.productName} / ${e.name}`) : [],
        discounts: replace.discounts ? existingDiscounts.filter(d => !seenDiscountNames.has(normKey(d.name))).map(d => d.name) : [],
    }

    return {
        plan: {
            replace, removals,
            products, productUpdates,
            ingredients, ingredientUpdates,
            toppings, toppingUpdates,
            recipes, toppingIngredients,
            toppingLinks: [...linksByTopping.values()],
            extras, extraUpdates,
            extraIngredients: extraIngredientsPlan,
            dividers, layout,
            discounts, discountUpdates, discountLinks: [...linksByDiscount.values()],
        },
        blockingErrors,
        warnings,
    }
}

async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
    let i = 0
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (i < items.length) await fn(items[i++])
    }))
}

const CONCURRENCY = 8

// Chạy đúng thứ tự phụ thuộc FK: Sản phẩm → Nguyên liệu → Topping → Tùy chọn thêm → Công thức
// (1 lệnh batch duy nhất) → Công thức Topping → Công thức tùy chọn → Topping áp dụng món. Chỉ
// dùng service function có sẵn, KHÔNG viết logic ghi DB mới — mỗi hàm đã tự lo cả Supabase lẫn
// guest/local mode. Sheet trùng tên (Sản phẩm/Nguyên liệu/Topping/Tùy chọn thêm) đi theo nhánh
// update riêng — cùng map tên→id với nhánh tạo mới nên bước sau (Công thức...) không cần biết
// dòng nào mới/cũ. Mọi so khớp tên dùng chung normKey (NFC + lowercase) với resolveImportPlan.
async function commitImportPlanSequential(plan: ImportPlan, addressId: UUID | null, existing: ExistingData) {
    const productByName = new Map(existing.products.map(p => [normKey(p.name), p.id]))
    const toppingByName = new Map(existing.toppings.map(t => [normKey(t.name), t.id]))

    await runWithConcurrency(plan.products, CONCURRENCY, async (p) => {
        const row = await insertProduct(p.name, p.price, addressId)
        productByName.set(normKey(p.name), row.id)
    })
    await runWithConcurrency(plan.productUpdates, CONCURRENCY, async (p) => {
        await upsertProductPrice(productByName.get(normKey(p.name))!, addressId, p.price)
    })

    await runWithConcurrency([...plan.ingredients, ...plan.ingredientUpdates], CONCURRENCY, async (ing) => {
        await upsertIngredientCost(ing.key, ing.unitCost, addressId, ing.unit, { category: ing.category, ...ing.attrs })
    })

    await runWithConcurrency(plan.toppings, CONCURRENCY, async (t) => {
        const row = await insertTopping(t.name, t.price, addressId, t.unit)
        toppingByName.set(normKey(t.name), row.id)
    })
    await runWithConcurrency(plan.toppingUpdates, CONCURRENCY, async (t) => {
        await updateToppingPrice(toppingByName.get(normKey(t.name))!, t.price)
    })

    // key = `${productId}|${normKey(tên tùy chọn)}` — dùng chung cho extras/extraUpdates/
    // extraIngredients bên dưới, seed từ dữ liệu đã có trước khi tạo/sửa thêm.
    const extraByKey = new Map<string, UUID>()
    for (const ex of existing.extras) {
        const productId = productByName.get(normKey(ex.productName))
        if (productId) extraByKey.set(`${productId}|${normKey(ex.name)}`, ex.id)
    }
    await runWithConcurrency(plan.extras, CONCURRENCY, async (ex) => {
        const productId = productByName.get(normKey(ex.productName))
        const row = await insertProductExtra(productId!, ex.name, ex.price, addressId)
        extraByKey.set(`${productId}|${normKey(ex.name)}`, row.id)
        if (ex.sticky) await updateProductExtraSticky(row.id, true)
    })
    await runWithConcurrency(plan.extraUpdates, CONCURRENCY, async (ex) => {
        const productId = productByName.get(normKey(ex.productName))
        const extraId = extraByKey.get(`${productId}|${normKey(ex.name)}`)
        await updateProductExtraPrice(extraId!, ex.price)
        await updateProductExtraSticky(extraId!, ex.sticky)
    })

    if (plan.recipes.length > 0) {
        await upsertRecipes(plan.recipes.map(r => ({
            productId: productByName.get(normKey(r.productName))!,
            ingredient: r.ingredient,
            amount: r.amount,
            addressId,
            unit: r.unit,
        })))
    }

    await runWithConcurrency(plan.toppingIngredients, CONCURRENCY, async (ti) => {
        const toppingId = toppingByName.get(normKey(ti.toppingName))!
        await upsertToppingIngredient(toppingId, ti.ingredient, ti.amount, ti.unit)
    })

    await runWithConcurrency(plan.extraIngredients, CONCURRENCY, async (ei) => {
        const productId = productByName.get(normKey(ei.productName))
        const extraId = extraByKey.get(`${productId}|${normKey(ei.extraName)}`)
        await upsertExtraIngredient(extraId!, ei.ingredient, ei.amount, ei.unit)
    })

    await runWithConcurrency(plan.toppingLinks, CONCURRENCY, async (link) => {
        const toppingId = toppingByName.get(normKey(link.toppingName))!
        const productIds = link.productNames.map(n => productByName.get(normKey(n))!)
        await setToppingProductLinks(toppingId, productIds)
    })

    await commitDiscounts(plan, addressId, existing, plan.discountLinks.map(l => ({
        programName: l.programName, productIds: l.productNames.map(n => productByName.get(normKey(n))!),
    })))
}

// Quy cách / tồn tối thiểu không nằm trong RPC bulk_import_menu → 1 lệnh upsert theo lô sau khi RPC xong
// (dòng nguyên liệu đã có nên chỉ cập nhật đúng các cột trong attrs; mọi dòng cùng bộ cột vì theo header sheet).
async function commitIngredientAttrs(plan: ImportPlan, addressId: UUID | null) {
    const rows = [...plan.ingredients, ...plan.ingredientUpdates].filter(i => i.attrs).map(i => {
        const row: Record<string, unknown> = { ingredient: i.key, address_id: addressId }
        for (const { key, col } of INGREDIENT_ATTR_COLUMNS) if (key in i.attrs!) row[col] = i.attrs![key]
        return row
    })
    if (!rows.length) return
    const { error } = await supabase.from('ingredient_costs').upsert(rows, { onConflict: 'ingredient,address_id' })
    if (error) throw error
}

// Giảm giá ghi qua discountService (không nằm trong RPC bulk_import_menu) — chạy SAU khi món đã có
// id thật. Idempotent theo tên: lỗi giữa chừng thì nhập lại file, phần đã ghi rơi vào nhánh cập nhật.
// links đã resolve sang id món (RPC path lấy từ buildBulkPayload, sequential path tự dựng).
async function commitDiscounts(
    plan: ImportPlan, addressId: UUID | null, existing: ExistingData,
    links: Array<{ programName: string; productIds: UUID[] }>,
) {
    const programByName = new Map(existing.discountPrograms.map(d => [normKey(d.name), d.id]))
    const fields = (d: DiscountPlan) => ({
        type: d.type, value: d.value, days_of_week: d.days, start_date: d.startDate, end_date: d.endDate, enabled: d.enabled,
    })
    await runWithConcurrency(plan.discounts, CONCURRENCY, async (d) => {
        const row = await insertDiscountProgram({ name: d.name, address_id: addressId, ...fields(d) })
        programByName.set(normKey(d.name), row.id)
    })
    await runWithConcurrency(plan.discountUpdates, CONCURRENCY, async (d) => {
        await updateDiscountProgram(programByName.get(normKey(d.name))!, fields(d))
    })
    if (plan.replace.discounts) {
        const keep = new Set([...plan.discounts, ...plan.discountUpdates].map(d => normKey(d.name)))
        await runWithConcurrency(existing.discountPrograms.filter(d => !keep.has(normKey(d.name))), CONCURRENCY, async (d) => {
            await deleteDiscountProgram(d.id)
        })
    }
    await runWithConcurrency(links, CONCURRENCY, async (l) => {
        await setDiscountProgramProducts(programByName.get(normKey(l.programName))!, l.productIds)
    })
}

// Thuần — đổi plan (theo TÊN) sang payload theo ID cho RPC bulk_import_menu. Id món/topping/tùy
// chọn mới sinh ở client để SQL không phải khớp tên (tránh lệch NFC/lowercase giữa JS và Postgres).
export function buildBulkPayload(plan: ImportPlan, existing: ExistingData) {
    const productId = new Map(existing.products.filter(p => !p.is_divider).map(p => [normKey(p.name), p.id as string]))
    const dividerId = new Map(existing.products.filter(p => p.is_divider).map(p => [normKey(p.name), p.id as string]))
    const newDividers = plan.dividers.map(name => {
        const id = crypto.randomUUID()
        dividerId.set(normKey(name), id)
        return { id, name }
    })
    const toppingId = new Map(existing.toppings.map(t => [normKey(t.name), t.id as string]))
    const newProducts = plan.products.map(p => {
        const id = crypto.randomUUID()
        productId.set(normKey(p.name), id)
        return { id, name: p.name, price: p.price }
    })
    const newToppings = plan.toppings.map(t => {
        const id = crypto.randomUUID()
        toppingId.set(normKey(t.name), id)
        return { id, name: t.name, price: t.price, unit: t.unit, ingredientKey: normalizeIngredientKey(t.name) }
    })
    const extraId = new Map<string, string>() // `${productId}|${normKey(tên)}`
    for (const ex of existing.extras) {
        const pid = productId.get(normKey(ex.productName))
        if (pid) extraId.set(`${pid}|${normKey(ex.name)}`, ex.id)
    }
    const extraKey = (productName: string, name: string) => `${productId.get(normKey(productName))}|${normKey(name)}`
    const newExtras = plan.extras.map(ex => {
        const id = crypto.randomUUID()
        extraId.set(extraKey(ex.productName, ex.name), id)
        return { id, productId: productId.get(normKey(ex.productName)), name: ex.name, price: ex.price, sticky: ex.sticky }
    })
    return {
        replace: plan.replace,
        products: newProducts,
        dividers: newDividers,
        layout: plan.layout.map(l => (l.divider ? dividerId : productId).get(normKey(l.name))),
        productUpdates: plan.productUpdates.map(p => ({ id: productId.get(normKey(p.name)), price: p.price })),
        ingredients: [...plan.ingredients, ...plan.ingredientUpdates].map(i => ({ key: i.key, unitCost: i.unitCost, unit: i.unit, category: i.category, group: i.group })), // group undefined → JSON bỏ key → RPC giữ nhóm cũ
        toppings: newToppings,
        toppingUpdates: plan.toppingUpdates.map(t => ({ id: toppingId.get(normKey(t.name)), price: t.price })),
        extras: newExtras,
        extraUpdates: plan.extraUpdates.map(ex => ({ id: extraId.get(extraKey(ex.productName, ex.name)), price: ex.price, sticky: ex.sticky })),
        recipes: plan.recipes.map(r => ({ productId: productId.get(normKey(r.productName)), ingredient: r.ingredient, amount: r.amount, unit: r.unit })),
        toppingIngredients: plan.toppingIngredients.map(t => ({ toppingId: toppingId.get(normKey(t.toppingName)), ingredient: t.ingredient, amount: t.amount, unit: t.unit })),
        extraIngredients: plan.extraIngredients.map(e => ({ extraId: extraId.get(extraKey(e.productName, e.extraName)), ingredient: e.ingredient, amount: e.amount, unit: e.unit })),
        toppingLinks: plan.toppingLinks.map(l => ({ toppingId: toppingId.get(normKey(l.toppingName)), productIds: l.productNames.map(n => productId.get(normKey(n))) })),
        // Không do RPC xử lý — commitImportPlan ghi qua commitDiscounts sau khi RPC xong (cần id món đã resolve ở đây).
        discountLinks: plan.discountLinks.map(l => ({ programName: l.programName, productIds: l.productNames.map(n => productId.get(normKey(n))!) })),
    }
}

// Ghi cả plan bằng 1 RPC (1 transaction — lỗi thì không ghi gì, khác bản tuần tự cũ). Guest mode
// (localStorage, không có mạng) vẫn đi đường tuần tự cũ.
export async function commitImportPlan(plan: ImportPlan, addressId: UUID | null, existing: ExistingData) {
    if (localRepo.isGuest()) return commitImportPlanSequential(plan, addressId, existing)
    const payload = buildBulkPayload(plan, existing)
    const { error } = await supabase.rpc('bulk_import_menu', { p_address_id: addressId, p_plan: payload })
    if (error) throw error
    await commitIngredientAttrs(plan, addressId)
    await commitDiscounts(plan, addressId, existing, payload.discountLinks)
}
