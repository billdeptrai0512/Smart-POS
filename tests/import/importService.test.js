// Nhập liệu hàng loạt từ Excel — chỉ test resolveImportPlan (hàm thuần, không gọi mạng).
// Nguồn: src/services/importService.ts

import { describe, it, expect } from 'vitest'
import { parseWorkbook, resolveImportPlan, buildBulkPayload } from '../../src/services/importService'

const EMPTY_EXISTING = { products: [], toppings: [], ingredientCosts: {}, extras: [], discountPrograms: [] }

function parsed(overrides = {}) {
    return {
        products: [], ingredients: [], recipes: [], toppings: [], toppingIngredients: [], toppingLinks: [], extras: [], extraIngredients: [],
        ...overrides,
    }
}

describe('resolveImportPlan', () => {
    it('tạo sản phẩm + nguyên liệu + công thức mới, bỏ qua sản phẩm đã tồn tại', () => {
        const existing = { products: [{ id: 'p-existing', name: 'Trà Đá' }], toppings: [], ingredientCosts: {}, extras: [], discountPrograms: [] }
        const { plan, blockingErrors, warnings } = resolveImportPlan(parsed({
            products: [{ 'Tên món': 'Trà Đá', 'Giá bán': 10000 }, { 'Tên món': 'Cà Phê Sữa', 'Giá bán': 20000 }],
            ingredients: [{ 'Tên nguyên liệu': 'Sữa đặc', 'Đơn vị': 'ml', 'Giá vốn/đơn vị': 100, 'Loại': 'chính' }],
            recipes: [{ 'Tên món': 'Cà Phê Sữa', 'Tên nguyên liệu': 'Sữa đặc', 'Số lượng': 30, 'Đơn vị': 'ml' }],
        }), existing)

        expect(blockingErrors).toEqual([])
        expect(warnings).toEqual([])
        expect(plan.products).toEqual([{ name: 'Cà Phê Sữa', price: 20000 }])
        expect(plan.ingredients).toEqual([{ key: 'sữa_đặc', unitCost: 100, unit: 'ml', category: 'main' }])
        expect(plan.recipes).toEqual([{ productName: 'Cà Phê Sữa', ingredient: 'sữa_đặc', amount: 30, unit: 'ml' }])
    })

    it('chặn cứng khi thiếu ô bắt buộc hoặc số không hợp lệ', () => {
        const { blockingErrors } = resolveImportPlan(parsed({
            products: [{ 'Tên món': '', 'Giá bán': 10000 }, { 'Tên món': 'Trà Đá', 'Giá bán': 'abc' }],
        }), EMPTY_EXISTING)
        expect(blockingErrors).toHaveLength(2)
        expect(blockingErrors[0]).toMatch(/thiếu Tên món/)
        expect(blockingErrors[1]).toMatch(/Giá bán không hợp lệ/)
    })

    it('chặn cứng khi trùng tên trong cùng 1 sheet', () => {
        const { blockingErrors } = resolveImportPlan(parsed({
            products: [{ 'Tên món': 'Trà Đá', 'Giá bán': 10000 }, { 'Tên món': 'trà đá', 'Giá bán': 12000 }],
        }), EMPTY_EXISTING)
        expect(blockingErrors).toHaveLength(1)
        expect(blockingErrors[0]).toMatch(/bị lặp/)
    })

    it('bỏ qua + cảnh báo khi công thức trỏ tới món không tồn tại, không chặn cả file', () => {
        const { plan, blockingErrors, warnings } = resolveImportPlan(parsed({
            recipes: [{ 'Tên món': 'Món Không Tồn Tại', 'Tên nguyên liệu': 'Đường', 'Số lượng': 10, 'Đơn vị': 'g' }],
        }), EMPTY_EXISTING)
        expect(blockingErrors).toEqual([])
        expect(plan.recipes).toEqual([])
        expect(warnings).toHaveLength(1)
        expect(warnings[0]).toMatch(/Món Không Tồn Tại/)
    })

    it('tự đăng ký nguyên liệu chỉ xuất hiện trong Công thức (chưa có ở sheet Nguyên liệu)', () => {
        const existing = { products: [{ id: 'p1', name: 'Trà Đá' }], toppings: [], ingredientCosts: {}, extras: [], discountPrograms: [] }
        const { plan, blockingErrors } = resolveImportPlan(parsed({
            recipes: [{ 'Tên món': 'Trà Đá', 'Tên nguyên liệu': 'Đá viên', 'Số lượng': 5, 'Đơn vị': 'viên' }],
        }), existing)
        expect(blockingErrors).toEqual([])
        expect(plan.ingredients).toEqual([{ key: 'đá_viên', unitCost: 0, unit: 'viên', category: 'main' }])
    })

    it('gom Topping áp dụng món theo topping thay vì tạo 1 dòng/liên kết', () => {
        const existing = { products: [{ id: 'p1', name: 'Trà Sữa' }, { id: 'p2', name: 'Cà Phê Đen' }], toppings: [{ id: 't1', name: 'Trân Châu' }], ingredientCosts: {}, extras: [], discountPrograms: [] }
        const { plan, blockingErrors } = resolveImportPlan(parsed({
            toppingLinks: [
                { 'Tên topping': 'Trân Châu', 'Tên món': 'Trà Sữa' },
                { 'Tên topping': 'Trân Châu', 'Tên món': 'Cà Phê Đen' },
            ],
        }), existing)
        expect(blockingErrors).toEqual([])
        expect(plan.toppingLinks).toEqual([{ toppingName: 'Trân Châu', productNames: ['Trà Sữa', 'Cà Phê Đen'] }])
    })

    it('map Loại về đúng 2 giá trị main/packaging, không bao giờ trả về tools', () => {
        const { plan } = resolveImportPlan(parsed({
            ingredients: [
                { 'Tên nguyên liệu': 'Ly nhựa', 'Đơn vị': 'cái', 'Giá vốn/đơn vị': 500, 'Loại': 'Bao bì' },
                { 'Tên nguyên liệu': 'Đường', 'Đơn vị': 'g', 'Giá vốn/đơn vị': 20, 'Loại': 'tools' },
                { 'Tên nguyên liệu': 'Sữa', 'Đơn vị': 'ml', 'Giá vốn/đơn vị': 30, 'Loại': '' },
            ],
        }), EMPTY_EXISTING)
        expect(plan.ingredients.map(i => i.category)).toEqual(['packaging', 'packaging', 'main'])
    })
})

describe('cột Nhóm (sheet Nguyên liệu)', () => {
    it('có cột → gửi group (ô trống = bỏ nhóm); không có cột → không gửi key group (giữ nhóm cũ)', () => {
        const { plan } = resolveImportPlan(parsed({
            ingredients: [
                { 'Tên nguyên liệu': 'Sữa tươi', 'Đơn vị': 'ml', 'Giá vốn/đơn vị': 30, 'Loại': 'chính', 'Nhóm': ' Sữa ' },
                { 'Tên nguyên liệu': 'Ly 500', 'Đơn vị': 'cái', 'Giá vốn/đơn vị': 900, 'Loại': 'bao bì', 'Nhóm': 'Ly' },
                { 'Tên nguyên liệu': 'Đường', 'Đơn vị': 'g', 'Giá vốn/đơn vị': 20, 'Loại': 'chính', 'Nhóm': '' },
            ],
        }), EMPTY_EXISTING)
        const p = buildBulkPayload(plan, EMPTY_EXISTING)
        expect(p.ingredients.map(i => i.group)).toEqual(['Sữa', 'Ly', ''])

        const { plan: noCol } = resolveImportPlan(parsed({
            ingredients: [{ 'Tên nguyên liệu': 'Sữa tươi', 'Đơn vị': 'ml', 'Giá vốn/đơn vị': 30, 'Loại': 'chính' }],
        }), EMPTY_EXISTING)
        expect(JSON.parse(JSON.stringify(buildBulkPayload(noCol, EMPTY_EXISTING))).ingredients[0]).not.toHaveProperty('group')
    })
})

describe('buildBulkPayload', () => {
    it('đổi tên → id: món/topping/tùy chọn mới có id sinh sẵn, dòng công thức trỏ đúng id', () => {
        const existing = { products: [{ id: 'p-old', name: 'Trà Đá' }], toppings: [], ingredientCosts: {}, extras: [{ id: 'x-old', productName: 'Trà Đá', name: 'Ít đá' }], discountPrograms: [] }
        const { plan } = resolveImportPlan(parsed({
            products: [{ 'Tên món': 'Cà Phê', 'Giá bán': 20000 }],
            toppings: [{ 'Tên topping': 'Trân châu', 'Giá bán': 5000, 'Đơn vị': 'g' }],
            toppingLinks: [{ 'Tên topping': 'Trân châu', 'Tên món': 'Cà Phê' }, { 'Tên topping': 'Trân châu', 'Tên món': 'Trà Đá' }],
            extras: [{ 'Tên món': 'Trà Đá', 'Tên tùy chọn': 'Ít đá', 'Giá': 0 }, { 'Tên món': 'Cà Phê', 'Tên tùy chọn': 'Ít đường', 'Giá': 0 }],
        }), existing)
        const p = buildBulkPayload(plan, existing)
        const cf = p.products[0].id
        expect(cf).toMatch(/^[0-9a-f-]{36}$/)
        expect(p.toppingLinks[0].productIds.sort()).toEqual([cf, 'p-old'].sort())
        expect(p.toppingLinks[0].toppingId).toBe(p.toppings[0].id)
        expect(p.extras[0].productId).toBe(cf)
        expect(p.extraUpdates.map(e => e.id)).toContain('x-old')
    })
})

describe('Danh mục + thứ tự menu', () => {
    const existing = {
        products: [{ id: 'd-old', name: 'Trà', is_divider: true }, { id: 'p1', name: 'Trà Đá' }],
        toppings: [], ingredientCosts: {}, extras: [], discountPrograms: [],
    }
    const sp = (name, cat) => ({ 'Tên món': name, 'Giá bán': 10000, 'Danh mục': cat })

    it('nhóm theo danh mục (mới + đã có), món không danh mục đứng đầu, thứ tự theo dòng', () => {
        const { plan } = resolveImportPlan(parsed({
            products: [sp('Trà Đá', 'Trà'), sp('Cà Phê', 'Cà phê'), sp('Nước lọc', ''), sp('Trà Sữa', 'Trà')],
        }), existing)
        expect(plan.dividers).toEqual(['Cà phê']) // "Trà" đã có
        expect(plan.layout.map(l => l.name)).toEqual(['Nước lọc', 'Trà', 'Trà Đá', 'Trà Sữa', 'Cà phê', 'Cà Phê'])
        const p = buildBulkPayload(plan, existing)
        expect(p.layout[1]).toBe('d-old')
        expect(p.layout[2]).toBe('p1')
        expect(p.dividers[0].id).toBe(p.layout[4])
    })

    it('không cột Danh mục → không đổi thứ tự', () => {
        const { plan } = resolveImportPlan(parsed({ products: [{ 'Tên món': 'A', 'Giá bán': 1 }] }), existing)
        expect(plan.layout).toEqual([])
        expect(plan.dividers).toEqual([])
    })
})

describe('Ghi đè theo sheet có trong file', () => {
    const existing = {
        products: [{ id: 'p1', name: 'Trà Đá' }, { id: 'p2', name: 'Trà Nóng' }, { id: 'd1', name: 'Cacao', is_divider: true }],
        toppings: [{ id: 't1', name: 'Trân châu' }], ingredientCosts: {},
        extras: [{ id: 'x1', productName: 'Trà Nóng', name: 'Ít đá' }], discountPrograms: [],
    }

    it('sheet có mặt → liệt kê món/danh mục/topping/tùy chọn sẽ xoá; công thức trỏ món ngoài file bị bỏ qua', () => {
        const { plan, warnings } = resolveImportPlan(parsed({
            sheets: ['Sản phẩm', 'Topping', 'Tùy chọn thêm', 'Công thức'],
            products: [{ 'Tên món': 'Trà Đá', 'Giá bán': 5000, 'Danh mục': 'TRÀ' }],
            recipes: [{ 'Tên món': 'Trà Nóng', 'Tên nguyên liệu': 'Trà', 'Số lượng': 1 }],
        }), existing)
        expect(plan.replace.products).toBe(true)
        expect(plan.replace.extraIngredients).toBe(false)
        expect(plan.removals).toEqual({ products: ['Trà Nóng'], dividers: ['Cacao'], toppings: ['Trân châu'], extras: ['Trà Nóng / Ít đá'], discounts: [] })
        expect(plan.recipes).toEqual([])
        expect(warnings).toHaveLength(1)
    })

    it('không có danh sách sheet (file cũ / thiếu sheet) → không xoá gì', () => {
        const { plan } = resolveImportPlan(parsed({ products: [{ 'Tên món': 'Trà Đá', 'Giá bán': 5000 }] }), existing)
        expect(Object.values(plan.replace).some(Boolean)).toBe(false)
        expect(plan.removals).toEqual({ products: [], dividers: [], toppings: [], extras: [], discounts: [] })
    })
})

describe('Giảm giá', () => {
    const existing = {
        products: [{ id: 'p1', name: 'Trà Đá' }, { id: 'p2', name: 'Cacao' }],
        toppings: [], ingredientCosts: {}, extras: [],
        discountPrograms: [{ id: 'd-old', name: 'Happy hour' }, { id: 'd-gone', name: 'Cũ' }],
    }

    it('parse kiểu/thứ/ngày; trùng tên → cập nhật; ghi đè → liệt kê chương trình sẽ xoá', () => {
        const { plan, blockingErrors } = resolveImportPlan(parsed({
            sheets: ['Giảm giá', 'Giảm giá áp dụng món'],
            discounts: [
                { 'Tên chương trình': 'Happy hour', 'Kiểu': 'Giảm %', 'Giá trị': 20, 'Thứ áp dụng': 't2, CN', 'Từ ngày': '', 'Đến ngày': '2026-12-31', 'Bật': 'có' },
                { 'Tên chương trình': 'Đồng giá 10k', 'Kiểu': 'Đồng giá', 'Giá trị': 10000, 'Thứ áp dụng': '', 'Từ ngày': 46023, 'Đến ngày': '', 'Bật': '' },
            ],
            discountLinks: [{ 'Tên chương trình': 'Happy hour', 'Tên món': 'Trà Đá' }],
        }), existing)
        expect(blockingErrors).toEqual([])
        expect(plan.discountUpdates).toEqual([{ name: 'Happy hour', type: 'percent', value: 20, days: [0, 1], startDate: null, endDate: '2026-12-31', enabled: true }])
        expect(plan.discounts).toEqual([{ name: 'Đồng giá 10k', type: 'fixed', value: 10000, days: [], startDate: '2026-01-01', endDate: null, enabled: false }])
        // sheet liên kết có mặt → chương trình không có dòng nào vẫn được set rỗng
        expect(plan.discountLinks).toEqual([
            { programName: 'Đồng giá 10k', productNames: [] },
            { programName: 'Happy hour', productNames: ['Trà Đá'] },
        ])
        expect(plan.removals.discounts).toEqual(['Cũ'])
    })

    it('chặn cứng kiểu/thứ/ngày/% sai; cảnh báo khi liên kết trỏ chương trình không có', () => {
        const { blockingErrors, warnings } = resolveImportPlan(parsed({
            discounts: [
                { 'Tên chương trình': 'A', 'Kiểu': 'lạ', 'Giá trị': 1 },
                { 'Tên chương trình': 'B', 'Kiểu': 'Giảm %', 'Giá trị': 150 },
                { 'Tên chương trình': 'C', 'Kiểu': 'Giảm tiền', 'Giá trị': 1, 'Thứ áp dụng': 'T9' },
                { 'Tên chương trình': 'D', 'Kiểu': 'Giảm tiền', 'Giá trị': 1, 'Từ ngày': 'mai' },
            ],
            discountLinks: [{ 'Tên chương trình': 'Không có', 'Tên món': 'Trà Đá' }],
        }), existing)
        expect(blockingErrors).toHaveLength(4)
        expect(warnings).toHaveLength(1)
    })
})

describe('Quy cách & tồn tối thiểu của nguyên liệu', () => {
    const ing = (extra) => parsed({ ingredients: [{ 'Tên nguyên liệu': 'Sữa', 'Đơn vị': 'ml', 'Giá vốn/đơn vị': 1, 'Loại': 'chính', ...extra }] })

    it('chỉ cột CÓ trong sheet mới vào attrs; ô trống = null (xoá)', () => {
        const { plan, blockingErrors } = resolveImportPlan(ing({ 'Quy cách': 1286, 'Đơn vị quy cách': 'ml', 'Quy cách 2': '', 'Tồn kho tối thiểu': 2 }), EMPTY_EXISTING)
        expect(blockingErrors).toEqual([])
        expect(plan.ingredients[0].attrs).toEqual({ packSize: 1286, packUnit: 'ml', pack2Size: null, minStock: 2 })
    })

    it('file không có cột nào → không có attrs (giữ nguyên dữ liệu cũ)', () => {
        expect(resolveImportPlan(ing({}), EMPTY_EXISTING).plan.ingredients[0]).not.toHaveProperty('attrs')
    })

    it('chặn cứng số âm / không phải số', () => {
        const { blockingErrors } = resolveImportPlan(ing({ 'Tồn quầy tối thiểu': 'abc' }), EMPTY_EXISTING)
        expect(blockingErrors[0]).toMatch(/Tồn quầy tối thiểu không hợp lệ/)
        expect(resolveImportPlan(ing({ 'Quy cách': -1 }), EMPTY_EXISTING).blockingErrors).toHaveLength(1)
    })
})

describe('File mẫu public/templates/mau-nhap-lieu.xlsx', () => {
    it('đọc được hết, không lỗi cứng, có đủ nhóm / quy cách / giảm giá', async () => {
        const { readFileSync } = await import('node:fs')
        const buf = readFileSync('public/templates/mau-nhap-lieu.xlsx')
        const { plan, blockingErrors, warnings } = resolveImportPlan(
            parseWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
            { ...EMPTY_EXISTING, discountPrograms: [] },
        )
        expect(blockingErrors).toEqual([])
        expect(warnings).toEqual([])
        expect(plan.ingredients[0]).toMatchObject({ group: 'Cà phê & sữa', attrs: { packSize: 500, packUnit: 'bịch', pack2Size: 20, pack2Unit: 'thùng', minStock: 1000, minCounterStock: 200 } })
        expect(plan.discounts).toEqual([{ name: 'Happy hour thứ 2', type: 'percent', value: 20, days: [1], startDate: null, endDate: null, enabled: false }])
        expect(plan.discountLinks).toEqual([{ programName: 'Happy hour thứ 2', productNames: ['Cà Phê Sữa'] }])
    })
})
