import { useState, useCallback } from 'react'

// Wraps an async action with saving=true/false + error toast — cùng logic
// trước đây hand-roll giống hệt nhau ở RecipeIngredientPage/ToppingDetailPage/
// DiscountProgramDetailPage.
export function useSavingAction(showError) {
    const [saving, setSaving] = useState(false)
    const withSaving = useCallback(async (errorContext, fn) => {
        setSaving(true)
        try { await fn() }
        catch (err) { showError(err, errorContext) }
        finally { setSaving(false) }
    }, [showError])
    // setSaving exposed for callers whose catch needs custom recovery (e.g. rolling
    // back an optimistic update) instead of the generic showError(err, ctx) above.
    return { saving, withSaving, setSaving }
}
