import * as XLSX from 'xlsx'
import { ingredientLabel, normalizeIngredientKey } from '../utils/ingredients'
import { fetchToppingIngredients } from './toppingService'
import type { UUID } from '../types/domain'

// Xuất TOÀN BỘ thiết lập hiện tại của 1 địa chỉ ra đúng layout mà importService.ts đọc được
// (public/templates/mau-nhap-lieu.xlsx) — sửa trực tiếp trong file này rồi nạp lại qua
// ExcelImportModal sẽ CẬP NHẬT (không tạo trùng) đúng những gì đã sửa.

interface ExportInput {
    addressName?: string | null
    products: Array<{ id: UUID; name: string; price: number; is_divider?: boolean; sort_order?: number | null }>
    toppings: Array<{ id: UUID; name: string; price: number }>
    ingredientConfigs: Array<{
        ingredient: string; unit: string; unit_cost: number; category: string | null; group_id?: UUID | null
        pack_size?: number | null; pack_unit?: string | null; pack2_size?: number | null; pack2_unit?: string | null
        min_stock?: number | null; min_counter_stock?: number | null
    }>
    ingredientGroups?: Array<{ id: UUID; name: string }> // đã sắp theo sort_order
    ingredientUnits: Record<string, string>
    discountPrograms: Array<{ id: UUID; name: string; type: string; value: number; days_of_week: number[]; start_date: string | null; end_date: string | null; enabled: boolean }>
    productDiscounts: Record<UUID, Array<{ id: UUID }>>
    recipes: Array<{ product_id: UUID; ingredient: string; amount: number; unit: string | null }>
    productToppings: Record<UUID, Array<{ id: UUID; name: string }>>
    productExtras: Record<UUID, Array<{ id: UUID; name: string; price: number; is_sticky: boolean }>>
    extraIngredients: Record<UUID, Array<{ ingredient: string; amount: number; unit: string | null }>>
}

export async function downloadCurrentDataExcel(input: ExportInput) {
    const productNameById = new Map(input.products.map(p => [p.id, p.name]))
    const toppingNameById = new Map(input.toppings.map(t => [t.id, t.name]))

    const wb = XLSX.utils.book_new()
    const addSheet = (name: string, rows: Record<string, unknown>[]) => {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name)
    }

    // Dòng "mục" (is_divider) không phải món: thành cột Danh mục của các món đứng sau nó (theo sort_order).
    let category = ''
    const sellable: Record<string, unknown>[] = []
    for (const p of [...input.products].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))) {
        if (p.is_divider) category = p.name
        else sellable.push({ 'Tên món': p.name, 'Giá bán': p.price, 'Danh mục': category })
    }
    addSheet('Sản phẩm', sellable)

    // Sắp theo thứ tự nhóm (nhóm sau cùng: chưa phân nhóm) — import tạo nhóm theo thứ tự xuất hiện
    // trong file nên làm vậy thì nạp lại giữ đúng thứ tự nhóm.
    const groupRank = new Map((input.ingredientGroups ?? []).map((g, i) => [g.id, i]))
    const rank = (c: ExportInput['ingredientConfigs'][number]) => (c.group_id ? groupRank.get(c.group_id) : undefined) ?? 1e9
    const ingredientRows = [...input.ingredientConfigs].sort((a, b) => rank(a) - rank(b))
    addSheet('Nguyên liệu', ingredientRows.map(c => ({
        'Tên nguyên liệu': ingredientLabel(c.ingredient),
        'Đơn vị': c.unit,
        'Giá vốn/đơn vị': c.unit_cost,
        'Loại': c.category === 'packaging' ? 'bao bì' : 'chính',
        'Nhóm': (c.group_id && input.ingredientGroups?.find(g => g.id === c.group_id)?.name) || '',
        'Quy cách': c.pack_size ?? '',
        'Đơn vị quy cách': c.pack_unit ?? '',
        'Quy cách 2': c.pack2_size ?? '',
        'Đơn vị quy cách 2': c.pack2_unit ?? '',
        'Tồn kho tối thiểu': c.min_stock ?? '',
        'Tồn quầy tối thiểu': c.min_counter_stock ?? '',
    })))

    addSheet('Công thức', input.recipes.map(r => ({
        'Tên món': productNameById.get(r.product_id) || '',
        'Tên nguyên liệu': ingredientLabel(r.ingredient),
        'Số lượng': r.amount,
        'Đơn vị': r.unit || '',
    })).filter(r => r['Tên món']))

    addSheet('Topping', input.toppings.map(t => ({
        'Tên topping': t.name,
        'Giá bán': t.price,
        'Đơn vị tồn kho': input.ingredientUnits[normalizeIngredientKey(t.name)] || 'đv',
    })))

    const toppingIngredientsMap = await fetchToppingIngredients(input.toppings.map(t => t.id))
    const toppingIngredientRows: Record<string, unknown>[] = []
    for (const [toppingId, rows] of Object.entries(toppingIngredientsMap)) {
        const toppingName = toppingNameById.get(toppingId)
        if (!toppingName) continue
        for (const r of rows) {
            toppingIngredientRows.push({
                'Tên topping': toppingName,
                'Tên nguyên liệu': ingredientLabel(r.ingredient),
                'Số lượng': r.amount,
                'Đơn vị': r.unit || '',
            })
        }
    }
    addSheet('Công thức Topping', toppingIngredientRows)

    const extrasRows: Record<string, unknown>[] = []
    const extraIngredientRows: Record<string, unknown>[] = []
    for (const [productId, extras] of Object.entries(input.productExtras)) {
        const productName = productNameById.get(productId)
        if (!productName) continue
        for (const extra of extras) {
            extrasRows.push({
                'Tên món': productName,
                'Tên tùy chọn': extra.name,
                'Giá': extra.price,
                'Tự động chọn': extra.is_sticky ? 'có' : '',
            })
            for (const ei of input.extraIngredients[extra.id] || []) {
                extraIngredientRows.push({
                    'Tên món': productName,
                    'Tên tùy chọn': extra.name,
                    'Tên nguyên liệu': ingredientLabel(ei.ingredient),
                    'Số lượng': ei.amount,
                    'Đơn vị': ei.unit || '',
                })
            }
        }
    }
    addSheet('Tùy chọn thêm', extrasRows)
    addSheet('Công thức tùy chọn', extraIngredientRows)

    const toppingLinkRows: Record<string, unknown>[] = []
    for (const [productId, toppingsOfProduct] of Object.entries(input.productToppings)) {
        const productName = productNameById.get(productId)
        if (!productName) continue
        for (const t of toppingsOfProduct) toppingLinkRows.push({ 'Tên topping': t.name, 'Tên món': productName })
    }
    addSheet('Topping áp dụng món', toppingLinkRows)

    const DISCOUNT_TYPE_LABEL: Record<string, string> = { fixed: 'Đồng giá', percent: 'Giảm %', amount: 'Giảm tiền' }
    const DOW_LABEL = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
    addSheet('Giảm giá', input.discountPrograms.map(d => ({
        'Tên chương trình': d.name,
        'Kiểu': DISCOUNT_TYPE_LABEL[d.type] ?? d.type,
        'Giá trị': d.value,
        'Thứ áp dụng': d.days_of_week.map(n => DOW_LABEL[n]).join(', '),
        'Từ ngày': d.start_date ?? '',
        'Đến ngày': d.end_date ?? '',
        'Bật': d.enabled ? 'có' : '',
    })))

    const discountLinkRows: Record<string, unknown>[] = []
    for (const [productId, programs] of Object.entries(input.productDiscounts)) {
        const productName = productNameById.get(productId)
        if (!productName) continue
        for (const p of programs) {
            const programName = input.discountPrograms.find(d => d.id === p.id)?.name
            if (programName) discountLinkRows.push({ 'Tên chương trình': programName, 'Tên món': productName })
        }
    }
    addSheet('Giảm giá áp dụng món', discountLinkRows)

    const datePart = new Date().toISOString().slice(0, 10)
    const addressPart = input.addressName ? `-${input.addressName.trim().toLowerCase().replace(/\s+/g, '-')}` : ''
    XLSX.writeFile(wb, `du-lieu${addressPart}-${datePart}.xlsx`)
}
