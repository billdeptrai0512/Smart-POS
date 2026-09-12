import { useState, useEffect, useCallback, useMemo } from 'react'
import { fetchIngredientCostsWithUnits } from '../services/orderService'
import { sortIngredients } from '../utils/ingredients'

// Danh mục nguyên liệu (giá vốn + đơn vị), sắp theo thứ tự cấu hình của địa chỉ.
// Tách khỏi useShiftInventoryState vì đây là dữ liệu MASTER, không liên quan gì
// tới state kiểm kê/baseline/đồng bộ đa thiết bị của 1 ca — reload độc lập,
// không đọc/ghi baseline.
export function useIngredientCatalog(addressId, ingredientSortOrder) {
    const [rawList, setRawList] = useState([])
    const [isLoadingIngredients, setIsLoadingIngredients] = useState(true)

    const reloadIngredients = useCallback(() => {
        if (addressId === undefined) { setIsLoadingIngredients(false); return Promise.resolve() }
        setIsLoadingIngredients(true)
        return fetchIngredientCostsWithUnits(addressId).then(list => {
            // Loại nguyên liệu được tắt "kiểm kê hao hụt" (count_in_audit === false).
            // Thiếu cờ (phiếu cũ / chưa migrate) → mặc định hiện.
            setRawList(list.filter(r => r.count_in_audit !== false))
        }).finally(() => setIsLoadingIngredients(false))
    }, [addressId])

    // Sắp xếp tách khỏi fetch: ingredient_sort_order đi kèm object địa chỉ, mà AddressContext
    // thay object đó sau khi fetch addresses xong (cold start seed từ localStorage trước) —
    // để array này trong deps của reloadIngredients thì mỗi lần thay là một round-trip thừa.
    const ingredientsList = useMemo(
        () => [...rawList].sort((a, b) => sortIngredients(a.ingredient, b.ingredient, ingredientSortOrder)),
        [rawList, ingredientSortOrder],
    )

    // Fetch-on-mount + refetch-on-dep-change; reloadIngredients sets isLoading=true
    // synchronously before the async fetch so the very first render already shows
    // loading state. Same intentional pattern as useHistoryRangeFetch.js.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { reloadIngredients() }, [reloadIngredients])

    return { ingredientsList, isLoadingIngredients, reloadIngredients }
}
