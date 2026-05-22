import { useState, useCallback } from 'react'
import {
    insertShiftClosing, updateShiftClosing,
    fetchFixedCosts, fetchTodayExpenses, insertExpense,
    invalidateDailyContext,
} from '../services/orderService'
import { shiftFinalizedKey } from '../constants/storageKeys'

// Save logic shared between /shift-closing (full close) and /daily-report (inline cash/transfer).
// First-time saves auto-inject fixed costs as expenses, dedup'd by metadata.fixed_cost_id —
// the legacy /shift-closing flow did this inline; pulling it here so /daily-report stays in sync.
//
// `save(payload, { existingId?, onFixedCostError? })`:
//   - existingId provided → updateShiftClosing
//   - else → insertShiftClosing + fixed-cost injection
// Both paths set the shift_finalized_<addr>_<today> localStorage flag and invalidate the
// daily-context cache so consumers refetch fresh data.
export function useShiftClosingSave(addressId) {
    const [isSaving, setIsSaving] = useState(false)

    const save = useCallback(async (payload, { existingId, onFixedCostError } = {}) => {
        if (isSaving) return null
        setIsSaving(true)
        try {
            let saved
            if (existingId) {
                saved = await updateShiftClosing(existingId, payload)
            } else {
                saved = await insertShiftClosing(payload)
                // Auto-inject fixed costs on first-time close. Dedup by metadata.fixed_cost_id
                // so two staff racing on the same first close still only insert one row each.
                try {
                    const [fixed, today] = await Promise.all([
                        fetchFixedCosts(addressId),
                        fetchTodayExpenses(addressId),
                    ])
                    if (fixed.length > 0) {
                        const injectedIds = new Set(
                            today
                                .filter(e => e.is_fixed === true)
                                .map(e => e.metadata?.fixed_cost_id)
                                .filter(Boolean)
                        )
                        const legacyInjected = today.some(e => e.is_fixed === true && !e.metadata?.fixed_cost_id)
                        const missing = legacyInjected ? [] : fixed.filter(fc => !injectedIds.has(fc.id))
                        if (missing.length > 0) {
                            await Promise.all(
                                missing.map(fc =>
                                    insertExpense(`[CĐ] ${fc.name}`, fc.amount, addressId, true, null, false, 'cash', { fixed_cost_id: fc.id })
                                )
                            )
                        }
                    }
                } catch (fixedErr) {
                    // Non-fatal — let caller decide how to surface (toast / log / ignore).
                    onFixedCostError?.(fixedErr)
                }
            }

            invalidateDailyContext(addressId)

            // Mark today's shift as finalized — HistoryPage uses this to classify subsequent
            // operational expenses as "Sau ca" instead of "Trong ca".
            if (addressId) {
                const today = new Date().toISOString().split('T')[0]
                localStorage.setItem(shiftFinalizedKey(addressId, today), Date.now().toString())
            }

            return saved
        } finally {
            setIsSaving(false)
        }
    }, [addressId, isSaving])

    return { save, isSaving }
}
