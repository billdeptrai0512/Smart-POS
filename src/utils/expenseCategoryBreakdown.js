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
// Returns { operatingRows, overheadRows, inventoryRows, *Total } — mỗi mảng gồm
// các nhãn active của nhóm (kể cả amount=0 nếu là nhãn mặc định; nhãn tự tạo
// amount=0 bị lọc bớt cho gọn), sắp theo sort_order asc. Nhóm non_operating
// KHÔNG trả về (không nằm trong báo cáo lợi nhuận).
export function buildCategoryBreakdown({ expenses = [], expenseCategories = [] }) {
    const catById = new Map(expenseCategories.map(c => [c.id, c]))
    const fallbackOther =
        expenseCategories.find(c => c.is_default && c.group_section === 'operating' && c.name === 'Chi phí khác')
        || expenseCategories.find(c => c.group_section === 'operating')

    const totals = new Map() // category_id → amount
    const accumulate = (cid, amount) => {
        if (!amount) return
        const cat = cid ? catById.get(cid) : null
        // Ngoài kinh doanh: bỏ hẳn khỏi lợi nhuận (không trừ, không hiện).
        if (cat?.group_section === 'non_operating') return
        const targetId = cat ? cid : fallbackOther?.id
        if (!targetId) return  // no categories at all → drop silently
        totals.set(targetId, (totals.get(targetId) || 0) + amount)
    }

    for (const e of expenses) {
        if (e.is_refill && !e.metadata?.free_form) continue
        if (e.metadata?.adjustment) continue
        accumulate(e.category_id, e.amount || 0)
    }

    const operatingRows = []
    const overheadRows = []
    const inventoryRows = []
    let operatingTotal = 0
    let overheadTotal = 0
    let inventoryTotal = 0

    for (const c of expenseCategories) {
        const amount = totals.get(c.id) || 0
        const row = { id: c.id, name: c.name, amount, sort_order: c.sort_order }
        if (c.group_section === 'operating') {
            if (amount > 0 || c.is_default) operatingRows.push(row)
            operatingTotal += amount
        } else if (c.group_section === 'overhead') {
            if (amount > 0 || c.is_default) overheadRows.push(row)
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
