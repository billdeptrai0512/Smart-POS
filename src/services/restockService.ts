import { supabase } from '../lib/supabaseClient'
import * as localRepo from './localRepository'
import { insertExpense } from './expenseService'
import { invalidateReportCache } from './cache'
import { upsertIngredientCost } from './ingredientCostService'
import { roundStock } from './ingredientStockService'
import type { UUID, Row } from '../types/domain'

// Manual stock adjustment (kiểm kê / hao hụt / seed initial).
// Tạo 1 expense `is_refill=true, amount=0, metadata.adjustment=true, qty=delta` —
// được sum vào Σrefill_qty của fetchIngredientStocks → warehouse +delta.
// Không động unit_cost (giá vốn giữ nguyên). Filter `metadata.adjustment` ra khỏi tab Đi chợ ở client.
//
// opts.beforeStock: warehouse stock the user saw when initiating the edit. Stored
// in metadata as `before_stock` + derived `after_stock = before + delta` so the
// Nhật ký card can render "Tồn X → Y" honestly. Best-effort — two concurrent
// edits would race, but for a 1–3 staff coffee cart that's an acceptable
// approximation. Caller passes `null` / omits when the value isn't known.
export async function adjustIngredientStock(addressId: UUID | null, ingredient: string, delta: number, staffName: string | null, opts: Row = {}) {
    if (!Number.isFinite(delta) || delta === 0) return null
    const displayName = `Hiệu chỉnh tồn ${ingredient}`
    const meta: Row = { ingredient, qty: delta, adjustment: true }
    if (Number.isFinite(opts?.beforeStock)) {
        // 1-decimal round matches the Tồn kho display, so the snapshot reads
        // identically to what the user saw on the row when they opened edit.
        const before = roundStock(Number(opts.beforeStock))
        meta.before_stock = before
        meta.after_stock = roundStock(before + delta)
    }
    if (localRepo.isGuest()) {
        return await insertExpense(displayName, 0, addressId, false, staffName, true, 'cash', meta)
    }
    if (!supabase) throw new Error('No Supabase connection')
    return await insertExpense(displayName, 0, addressId, false, staffName, true, 'cash', meta)
}

// Đặt tồn QUẦY (counter) = số đếm tuyệt đối, bằng cách ghi `remaining` của NVL vào
// phiếu chốt ca MỚI NHẤT — cùng nguồn dữ liệu mà card Hao hụt đọc/ghi, nên số ở
// /ingredients và số chốt ca luôn khớp nhau. Trả null nếu chưa có phiếu chốt nào.
export async function setCounterStock(addressId: UUID | null, ingredient: string, newRemaining: number) {
    if (!ingredient) return null
    if (!Number.isFinite(newRemaining) || newRemaining < 0) return null
    const remaining = roundStock(newRemaining)
    const applyToReport = (report: Row[] | null) => {
        const arr = Array.isArray(report) ? report : []
        let found = false
        const next = arr.map((item: Row) => {
            if (item?.ingredient === ingredient) { found = true; return { ...item, remaining } }
            return item
        })
        if (!found) next.push({ ingredient, remaining })
        return next
    }

    if (localRepo.isGuest()) {
        const latest = localRepo.fetchAllLocalShiftClosings(addressId)
            .filter((c: Row) => c.inventory_report != null)
            .sort((a: Row, b: Row) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
        if (!latest) return null
        invalidateReportCache(addressId)
        return localRepo.upsertLocalShiftClosing({ ...latest, inventory_report: applyToReport(latest.inventory_report) })
    }
    if (!supabase) throw new Error('No Supabase connection')

    let latestQ = supabase.from('shift_closings').select('id, inventory_report')
    latestQ = addressId ? latestQ.eq('address_id', addressId) : latestQ.is('address_id', null)
    const { data: latest, error } = await latestQ
        .not('inventory_report', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    if (error) throw error

    if (!latest) {
        // Mẫu mặc định chưa từng chốt ca — không bắt admin đi qua /daily-report trước,
        // tự tạo phiếu chốt ca đầu tiên để làm "Đầu kỳ" cho template.
        if (addressId !== null) return null
        const { data: created, error: insErr } = await supabase
            .from('shift_closings')
            .insert({ address_id: null, inventory_report: applyToReport(null) })
            .select()
            .single()
        if (insErr) throw insErr
        invalidateReportCache(addressId)
        return created
    }

    const { data: row, error: upErr } = await supabase
        .from('shift_closings')
        .update({ inventory_report: applyToReport(latest.inventory_report) })
        .eq('id', latest.id)
        .select()
        .single()
    if (upErr) throw upErr
    invalidateReportCache(addressId)
    return row
}

// Process a restock: updates COGS, ghi nhận invoice + (optional) payment.
//
// opts: {
//   subtotal:        Tổng tiền hàng (giá × qty trước giảm)
//   discount:        Giảm giá (đã quy ra VND ở FE)
//   extraCost:       Chi phí nhập (ship, vận chuyển)
//   paid:            Số tiền trả ngay (default = amountDue = subtotal - discount + extraCost)
//   paymentMethod:   'cash' | 'transfer' cho payment kèm
//   purchaseDate:    ISO string khi user backdate, null = NOW() server
// }
//
// Server tự tính `amount = subtotal − discount + extra`, WAC dùng amount này.
// Trả full mặc định khi `paid` không được truyền (backward-compat với callers cũ).
export async function processIngredientRestock(addressId: UUID | null, ingredient: string, qty: number, staffName: string | null, opts: Row = {}) {
    const {
        subtotal = 0, discount = 0, extraCost = 0,
        paid = null, paymentMethod = 'cash', purchaseDate = null,
        beforeStock = null, cashPhase = 'post_close',
    } = opts
    // Cờ phân loại dòng tiền lưu cố định trên phiếu. Chỉ 'in_shift' (tiền mặt mua trước
    // chốt ca tiền) mới cộng vào Thực thu; mọi giá trị khác → 'post_close'.
    const phase = cashPhase === 'in_shift' ? 'in_shift' : 'post_close'
    const amountDue = Math.max(0, Number(subtotal) - Number(discount) + Number(extraCost))
    const paidAmount = paid == null ? amountDue : Math.max(0, Math.min(Number(paid), amountDue))
    // Snapshot only on non-RPC paths (guest / default-address). The address RPC
    // computes its own authoritative snapshot inside the same transaction.
    const buildSnapshotMeta = (base: Row) => {
        if (!Number.isFinite(Number(beforeStock))) return base
        const b = roundStock(Number(beforeStock))
        return { ...base, before_stock: b, after_stock: roundStock(b + Number(qty || 0)) }
    }

    let result
    if (localRepo.isGuest()) {
        // 1. Update unit cost (WAC dùng amountDue)
        const unitCost = Number(qty) > 0 ? Math.round(amountDue / Number(qty)) : 0
        await upsertIngredientCost(ingredient, unitCost, addressId)
        // 2. Insert invoice expense (giữ created_at = purchaseDate nếu có)
        const displayName = `Đi chợ: ${ingredient}`
        const invoice = await insertExpense(
            displayName, amountDue, addressId, false, staffName, true, paymentMethod,
            buildSnapshotMeta({ ingredient, qty, subtotal, cash_phase: phase }),
            null, purchaseDate,
            { discount_amount: discount, extra_cost: extraCost }
        )
        // 3. Insert payment nếu có trả tiền
        if (paidAmount > 0 && invoice?.id) {
            await localRepo.insertLocalExpensePayment({
                expense_id: invoice.id,
                address_id: addressId,
                amount: paidAmount,
                payment_method: paymentMethod,
                staff_name: staffName,
                paid_at: purchaseDate || new Date().toISOString(),
            })
        }
        // FIX: Cascade after_stock khi backdate — cộng qty vào before/after_stock
        // của phiếu refill SAU phiếu vừa tạo (cùng ingredient, chưa cancelled).
        if (purchaseDate && invoice?.id) {
            const invoiceCreatedAt = new Date(purchaseDate).getTime()
            const allAfter = localRepo.fetchAllLocalExpenses(addressId)
                .filter((e: Row) => e.is_refill && e.metadata?.ingredient === ingredient
                    && !e.metadata?.cancelled && e.metadata?.after_stock != null
                    && e.id !== invoice.id
                    && new Date(e.created_at).getTime() > invoiceCreatedAt)
            for (const e of allAfter) {
                const oldBefore = Number(e.metadata?.before_stock) || 0
                const oldAfter = Number(e.metadata?.after_stock) || 0
                localRepo.updateLocalExpense(e.id, {
                    metadata: {
                        ...e.metadata,
                        before_stock: roundStock(oldBefore + Number(qty)),
                        after_stock: roundStock(oldAfter + Number(qty)),
                    },
                })
            }
        }
        result = { success: true, expense_id: invoice?.id, amount: amountDue, paid: paidAmount, owing: amountDue - paidAmount }
    } else {
        if (!supabase) throw new Error('No Supabase connection')
        if (addressId) {
            const params: Row = {
                p_address_id: addressId,
                p_ingredient: ingredient,
                p_qty: qty,
                p_subtotal: subtotal,
                p_staff_name: staffName,
                p_discount: discount,
                p_extra_cost: extraCost,
                p_initial_payment: paidAmount,
                p_payment_method: paymentMethod,
                p_cash_phase: phase,
            }
            if (purchaseDate) {
                params.p_created_at = purchaseDate
                params.p_paid_at = purchaseDate
            }
            let { data, error } = await supabase.rpc('process_ingredient_restock', params)
            // Pre-migration: RPC chưa có p_cash_phase → PostgREST không khớp overload
            // (PGRST202). Retry bỏ param để nhập kho vẫn chạy (phiếu sẽ thiếu cờ → sau chốt).
            if (error && (error.code === 'PGRST202' || /cash_phase/i.test(error.message || ''))) {
                const retry = { ...params }
                delete retry.p_cash_phase
                ;({ data, error } = await supabase.rpc('process_ingredient_restock', retry))
            }
            if (error) throw error
            result = data
        } else {
            // Default address (template). RPC requires UUID — do the two writes manually so
            // admins can exercise the full restock flow on the global template.
            const unitCost = Number(qty) > 0 ? Math.round(amountDue / Number(qty)) : 0
            await upsertIngredientCost(ingredient, unitCost, null)
            const displayName = `Đi chợ: ${ingredient}`
            const invoice = await insertExpense(
                displayName, amountDue, null, false, staffName, true, paymentMethod,
                buildSnapshotMeta({ ingredient, qty, subtotal, cash_phase: phase }),
                null, purchaseDate,
                { discount_amount: discount, extra_cost: extraCost }
            )
            // Mirror the RPC contract: paid portion lands in expense_payments so the
            // owing math reads the same on the template as on a real address.
            if (paidAmount > 0 && invoice?.id && supabase) {
                // Backdated restock: created_at must match paid_at, else the
                // chk_payment_paid_at_not_before_created constraint rejects the row
                // (created_at would default to NOW() while paid_at is in the past).
                const paidAtISO = purchaseDate || new Date().toISOString()
                await supabase.from('expense_payments').insert({
                    expense_id: invoice.id,
                    address_id: null,
                    amount: paidAmount,
                    payment_method: paymentMethod,
                    staff_name: staffName,
                    paid_at: paidAtISO,
                    created_at: paidAtISO,
                })
            }
            result = { success: true, expense_id: invoice?.id, amount: amountDue, paid: paidAmount, owing: amountDue - paidAmount }
        }
    }
    invalidateReportCache(addressId)
    return result
}

// Sửa một phiếu nhập kho tại chỗ (RPC edit_ingredient_restock)
export async function editIngredientRestock(addressId: UUID, expenseId: UUID, opts: Row = {}) {
    const {
        qty,
        subtotal,
        discount = 0,
        extraCost = 0,
        paid = null,
        paymentMethod = 'cash',
        purchaseDate = null,
        cashPhase = 'post_close',
        staffName = null
    } = opts

    const amountDue = Math.max(0, Number(subtotal) - Number(discount) + Number(extraCost))
    const paidAmount = paid == null ? amountDue : Math.max(0, Math.min(Number(paid), amountDue))
    const phase = cashPhase === 'in_shift' ? 'in_shift' : 'post_close'

    let result
    if (localRepo.isGuest()) {
        const all = localRepo.fetchAllLocalExpenses(addressId)
        const target = all.find((e: Row) => e.id === expenseId)
        if (!target || !target.is_refill) {
            throw new Error('Không phải phiếu nhập kho hợp lệ')
        }
        if (target.metadata?.cancelled) throw new Error('Phiếu đã bị hủy')
        if (target.metadata?.adjustment) throw new Error('Không thể sửa phiếu hiệu chỉnh')

        const ingredient = target.metadata?.ingredient
        const beforeStock = Number(target.metadata?.before_stock) || 0
        const afterStock = beforeStock + Number(qty)
        const qtyDelta = Number(qty) - (Number(target.metadata?.qty) || 0)

        // 1. Update expense local
        localRepo.updateLocalExpense(expenseId, {
            amount: amountDue,
            discount_amount: discount,
            extra_cost: extraCost,
            payment_method: paymentMethod,
            created_at: purchaseDate || target.created_at,
            metadata: {
                ...target.metadata,
                qty: Number(qty),
                subtotal: Number(subtotal),
                cash_phase: phase,
                after_stock: afterStock
            }
        })

        // Cascade delta to subsequent refills
        if (qtyDelta !== 0) {
            const targetCreatedAt = new Date(purchaseDate || target.created_at).getTime()
            const allAfter = localRepo.fetchAllLocalExpenses(addressId)
                .filter((e: Row) => e.is_refill && e.metadata?.ingredient === ingredient
                    && !e.metadata?.cancelled && e.metadata?.after_stock != null
                    && e.id !== expenseId
                    && new Date(e.created_at).getTime() > targetCreatedAt)
            for (const e of allAfter) {
                const oldBefore = Number(e.metadata?.before_stock) || 0
                const oldAfter = Number(e.metadata?.after_stock) || 0
                localRepo.updateLocalExpense(e.id, {
                    metadata: {
                        ...e.metadata,
                        before_stock: roundStock(oldBefore + qtyDelta),
                        after_stock: roundStock(oldAfter + qtyDelta),
                    },
                })
            }
        }

        // 2. Xóa & insert payments local
        localRepo.deleteLocalExpensePaymentsByExpense(expenseId)
        if (paidAmount > 0) {
            await localRepo.insertLocalExpensePayment({
                expense_id: expenseId,
                address_id: addressId,
                amount: paidAmount,
                payment_method: paymentMethod,
                staff_name: staffName,
                paid_at: purchaseDate || target.created_at,
                cash_phase: phase
            })
        }

        // 3. Tính lại WAC local
        const remaining = localRepo.fetchAllLocalExpenses(addressId)
            .filter((e: Row) => e.is_refill && e.metadata?.ingredient === ingredient
                && !e.metadata?.adjustment && !e.metadata?.cancelled && e.amount > 0)
        const totalQty = remaining.reduce((s: number, e: Row) => s + (Number(e.metadata?.qty) || 0), 0)
        const totalCost = remaining.reduce((s: number, e: Row) => s + (Number(e.amount) || 0), 0)

        let newUnitCost = null
        if (totalQty > 0) {
            newUnitCost = Math.round(totalCost / totalQty)
            await upsertIngredientCost(ingredient, newUnitCost, addressId)

            // Cập nhật lại new_unit_cost trong metadata
            const updatedTarget = localRepo.fetchAllLocalExpenses(addressId).find((e: Row) => e.id === expenseId)
            if (updatedTarget) {
                localRepo.updateLocalExpense(expenseId, {
                    metadata: {
                        ...updatedTarget.metadata,
                        new_unit_cost: newUnitCost
                    }
                })
            }
        }

        result = { success: true, expense_id: expenseId, amount: amountDue, paid: paidAmount, owing: amountDue - paidAmount, new_unit_cost: newUnitCost }
    } else {
        if (!supabase) throw new Error('No Supabase connection')
        const params: Row = {
            p_address_id: addressId,
            p_expense_id: expenseId,
            p_qty: qty,
            p_subtotal: subtotal,
            p_discount: discount,
            p_extra_cost: extraCost,
            p_initial_payment: paidAmount,
            p_payment_method: paymentMethod,
            p_cash_phase: phase,
            p_created_at: purchaseDate || new Date().toISOString(),
            p_staff_name: staffName
        }

        let { data, error } = await supabase.rpc('edit_ingredient_restock', params)
        if (error && (error.code === 'PGRST202' || /cash_phase/i.test(error.message || ''))) {
            const retry = { ...params }
            delete retry.p_cash_phase
            ;({ data, error } = await supabase.rpc('edit_ingredient_restock', retry))
        }
        if (error) throw error
        result = data
    }
    invalidateReportCache(addressId)
    return result
}

// Ghi nhận 1 lần trả nợ cho invoice đã tồn tại (từ Tab Nhật ký của ingredient).
// `paidAt` ISO string — default NOW server-side.
// `cashPhase` 'in_shift' | 'post_close' — phân loại tiền mặt của LẦN TRẢ này
// (độc lập với cờ cash_phase trên hoá đơn gốc lúc nhập kho).
export async function recordInvoicePayment(addressId: UUID | null, expenseId: UUID, amount: number, paymentMethod = 'cash', staffName: string | null = null, paidAt: string | null = null, cashPhase: string | null = null) {
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
        throw new Error('amount must be > 0')
    }
    let result
    if (localRepo.isGuest()) {
        result = await localRepo.insertLocalExpensePayment({
            expense_id: expenseId,
            address_id: addressId,
            amount: Number(amount),
            payment_method: paymentMethod,
            staff_name: staffName,
            paid_at: paidAt || new Date().toISOString(),
            cash_phase: cashPhase,
        })
    } else {
        if (!supabase) throw new Error('No Supabase connection')
        const params: Row = {
            p_expense_id: expenseId,
            p_amount: amount,
            p_payment_method: paymentMethod,
        }
        if (staffName) params.p_staff_name = staffName
        if (paidAt) params.p_paid_at = paidAt
        if (cashPhase) params.p_cash_phase = cashPhase
        const { data, error } = await supabase.rpc('record_invoice_payment', params)
        if (error) throw error
        result = data
    }
    invalidateReportCache(addressId)
    return result
}

// Hủy một phiếu nhập kho HOẶC phiếu hiệu chỉnh tồn → hoàn lại tồn + tiền + giá vốn
// (xem migration cancel_restock). Xóa expense (CASCADE xóa payments → đảo cash-out),
// tính lại WAC từ các phiếu mua thật còn lại, và ghi 1 dòng audit qty=0. Không nhận
// các dòng cancel-marker (metadata.cancel_restock).
export async function cancelRestock(addressId: UUID | null, expenseId: UUID, staffName: string | null = null) {
    if (!expenseId) throw new Error('expenseId is required')
    let result
    if (localRepo.isGuest()) {
        const all = localRepo.fetchAllLocalExpenses(addressId)
        const target = all.find((e: Row) => e.id === expenseId)
        if (!target || !target.is_refill) {
            throw new Error('Không phải phiếu nhập kho / hiệu chỉnh hợp lệ')
        }
        if (target.metadata?.cancelled) throw new Error('Phiếu đã bị hủy')
        const ingredient = target.metadata?.ingredient
        const cancelledQty = Number(target.metadata?.qty) || 0
        const cancelledAmount = Number(target.amount) || 0
        const wasAdjustment = !!target.metadata?.adjustment
        // 1. Zero-out tại chỗ + cờ cancelled (giữ dòng trong nhật ký). Số gốc cất trong metadata.
        //    FIX: xóa after_stock/before_stock để anchor không đọc neo "chết".
        const { after_stock: _as, before_stock: _bs, ...metaWithoutSnapshot } = target.metadata || {}
        localRepo.updateLocalExpense(expenseId, {
            amount: 0,
            metadata: {
                ...metaWithoutSnapshot,
                qty: 0,
                cancelled: true,
                cancelled_at: new Date().toISOString(),
                cancelled_by: staffName,
                cancelled_qty: cancelledQty,
                cancelled_amount: cancelledAmount,
            },
        })
        // FIX: Cascade trừ qty khỏi before_stock/after_stock của phiếu refill SAU phiếu bị hủy.
        if (cancelledQty !== 0) {
            const targetCreatedAt = new Date(target.created_at).getTime()
            const allAfter = localRepo.fetchAllLocalExpenses(addressId)
                .filter((e: Row) => e.is_refill && e.metadata?.ingredient === ingredient
                    && !e.metadata?.cancelled && e.metadata?.after_stock != null
                    && e.id !== expenseId
                    && new Date(e.created_at).getTime() > targetCreatedAt)
            for (const e of allAfter) {
                const oldBefore = Number(e.metadata?.before_stock) || 0
                const oldAfter = Number(e.metadata?.after_stock) || 0
                localRepo.updateLocalExpense(e.id, {
                    metadata: {
                        ...e.metadata,
                        before_stock: roundStock(oldBefore - cancelledQty),
                        after_stock: roundStock(oldAfter - cancelledQty),
                    },
                })
            }
        }
        // 2. Xóa payments của phiếu (đảo cash-out).
        localRepo.deleteLocalExpensePaymentsByExpense(expenseId)
        // 3. Tính lại WAC từ các phiếu mua thật còn lại (loại adjustment + cancelled + amount 0).
        const remaining = localRepo.fetchAllLocalExpenses(addressId)
            .filter((e: Row) => e.is_refill && e.metadata?.ingredient === ingredient
                && !e.metadata?.adjustment && !e.metadata?.cancelled && e.amount > 0)
        const totalQty = remaining.reduce((s: number, e: Row) => s + (Number(e.metadata?.qty) || 0), 0)
        const totalCost = remaining.reduce((s: number, e: Row) => s + (Number(e.amount) || 0), 0)
        if (totalQty > 0) {
            await upsertIngredientCost(ingredient, Math.round(totalCost / totalQty), addressId)
        }
        result = { success: true, ingredient, cancelled_qty: cancelledQty, was_adjustment: wasAdjustment }
    } else {
        if (!supabase) throw new Error('No Supabase connection')
        const params: Row = { p_address_id: addressId, p_expense_id: expenseId }
        if (staffName) params.p_staff_name = staffName
        const { data, error } = await supabase.rpc('cancel_restock', params)
        if (error) throw error
        result = data
    }
    invalidateReportCache(addressId)
    return result
}
