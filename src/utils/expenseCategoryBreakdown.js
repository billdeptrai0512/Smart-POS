// Group expenses by category for the FinanceCards P&L breakdown.
//
// Inputs:
//   - expenses: raw rows from /history or report RPCs
//   - expenseCategories: address's active tag list
//
// Skip rules:
//   - is_refill=true AND NOT free_form  → NVL refill (lives in COGS, not here)
//   - metadata.adjustment=true          → inventory bookkeeping (no cash impact)
//   - category group_section='non_operating' → ngoài hoạt động KD: KHÔNG vào lợi nhuận
//
// Fallback: when expense.category_id misses the category list (orphan from
// soft-deleted tag, or null for legacy/uncategorized), the amount goes to
// "Chi phí khác" of the operating section.
//
// Returns { operatingRows, overheadRows, inventoryRows, *Total } — operating +
// overhead gồm MỌI nhãn active của nhóm (kể cả amount=0) để báo cáo phản ánh đúng
// cấu hình từng địa chỉ. inventory chỉ liệt kê nhãn có chi (>0) cho gọn. Sắp theo
// sort_order asc. Nhóm non_operating KHÔNG trả về (không nằm trong báo cáo lợi nhuận).
export function buildCategoryBreakdown({ expenses = [], expenseCategories = [] }) {
    const catById = new Map(expenseCategories.map(c => [c.id, c]))
    const fallbackOther =
        expenseCategories.find(c => c.is_default && c.group_section === 'operating' && c.name === 'Chi phí khác')
        || expenseCategories.find(c => c.group_section === 'operating')

    const totals = new Map() // category_id → amount
    const entriesByCat = new Map() // category_id → [{ id, name, amount, created_at }] (cho dòng xổ chi tiết)
    const accumulate = (e, amount) => {
        if (!amount) return
        const cat = e.category_id ? catById.get(e.category_id) : null
        // Ngoài kinh doanh: bỏ hẳn khỏi lợi nhuận (không trừ, không hiện).
        if (cat?.group_section === 'non_operating') return
        const targetId = cat ? e.category_id : fallbackOther?.id
        if (!targetId) return  // no categories at all → drop silently
        totals.set(targetId, (totals.get(targetId) || 0) + amount)
        let arr = entriesByCat.get(targetId)
        if (!arr) { arr = []; entriesByCat.set(targetId, arr) }
        arr.push({ id: e.id, name: e.name, amount, created_at: e.created_at })
    }

    for (const e of expenses) {
        if (e.is_refill && !e.metadata?.free_form) continue
        if (e.metadata?.adjustment) continue
        accumulate(e, e.amount || 0)
    }

    const operatingRows = []
    const overheadRows = []
    const inventoryRows = []
    let operatingTotal = 0
    let overheadTotal = 0
    let inventoryTotal = 0

    for (const c of expenseCategories) {
        const amount = totals.get(c.id) || 0
        const row = { id: c.id, name: c.name, amount, sort_order: c.sort_order, entries: entriesByCat.get(c.id) || [] }
        if (c.group_section === 'operating') {
            // Hiện MỌI nhãn active (default + nhãn manager tự tạo) → báo cáo phản ánh
            // đúng cấu hình từng địa chỉ, dù kỳ này chưa phát sinh.
            operatingRows.push(row)
            operatingTotal += amount
        } else if (c.group_section === 'overhead') {
            overheadRows.push(row)
            overheadTotal += amount
        } else if (c.group_section === 'inventory') {
            // Tồn kho: chỉ hiện nhãn có chi (không nhồi nhãn mặc định amount=0 cho gọn).
            if (amount > 0) inventoryRows.push(row)
            inventoryTotal += amount
        }
        // non_operating: bỏ qua hoàn toàn.
    }

    const bySort = (a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999)
    operatingRows.sort(bySort)
    overheadRows.sort(bySort)
    inventoryRows.sort(bySort)

    return { operatingRows, overheadRows, inventoryRows, operatingTotal, overheadTotal, inventoryTotal }
}
