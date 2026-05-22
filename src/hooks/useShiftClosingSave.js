import { useState, useCallback } from 'react'
import {
    insertShiftClosing, updateShiftClosing,
    invalidateDailyContext,
} from '../services/orderService'
import { shiftFinalizedKey } from '../constants/storageKeys'

// Save logic shared between /shift-closing (full close) and /daily-report (inline cash/transfer).
//
// `save(payload, { existingId? })`:
//   - existingId provided → updateShiftClosing
//   - else → insertShiftClosing
// Both paths set the shift_finalized_<addr>_<today> localStorage flag and invalidate the
// daily-context cache so consumers refetch fresh data.
//
// Phasing out: previously this auto-injected fixed_costs templates as expenses on
// first-time close. Removed — system is now "thực chi only": every expense is a
// real recorded spend, no template projection or auto-injection.
export function useShiftClosingSave(addressId) {
    const [isSaving, setIsSaving] = useState(false)

    const save = useCallback(async (payload, { existingId } = {}) => {
        if (isSaving) return null
        setIsSaving(true)
        try {
            const saved = existingId
                ? await updateShiftClosing(existingId, payload)
                : await insertShiftClosing(payload)

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
