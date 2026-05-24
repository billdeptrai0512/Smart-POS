import { useState, useCallback } from 'react'
import {
    insertShiftClosing, updateShiftClosing,
    invalidateDailyContext,
} from '../services/orderService'

// Save logic shared between /shift-closing (full close) and /daily-report (inline cash/transfer).
//
// `save(payload, { existingId? })`:
//   - existingId provided → updateShiftClosing
//   - else → insertShiftClosing
// The shift_finalized flag is NOT touched here — it's derived purely from
// persisted shift_closing data on DailyReportPage (all Cuối kỳ counted + cash
// + transfer both entered), and only synced to localStorage for HistoryPage to
// classify subsequent expenses as "Sau ca".
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
            return saved
        } finally {
            setIsSaving(false)
        }
    }, [addressId, isSaving])

    return { save, isSaving }
}
