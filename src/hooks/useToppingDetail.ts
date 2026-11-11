import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useConfirm } from '../contexts/ConfirmContext'
import { useProductLinks } from './useProductLinks'
import { getIngredientUnit, normalizeIngredientKey, ingredientLabel } from '../utils/ingredients'
import {
    updateToppingName, updateToppingPrice, deleteTopping,
    fetchToppingIngredients, fetchProductToppingLinks, setToppingProductLinks,
    deleteIngredientCost, fetchIngredientStocks,
} from '../services/orderService'
import { isIngredientReferenced } from '../utils/toppingStock'
import { updateToppingSource, type ToppingSource } from '../services/toppingService'

export interface ToppingIng { topping_id: string; ingredient: string; amount: number; unit?: string | null }

// Dữ liệu + thao tác của 1 topping cho trang chi tiết công thức (RecipeIngredientPage dùng chung trang với món/thành phẩm).
// Topping chỉ là trung gian: 1 nguồn tồn kho (nguyên liệu / thành phẩm) + lượng mỗi phần. Tự nấu → tạo thành phẩm riêng rồi trỏ vào.
// toppingId = null → không phải topping, hook không làm gì (hook không được gọi có điều kiện).
// withSaving: bọc thao tác của trang (cùng cờ "Đang lưu…" và hiển thị lỗi).
export function useToppingDetail(toppingId: string | null, withSaving: (label: string, fn: () => Promise<void>) => Promise<unknown>, backUrl: string, showSaved: () => void) {
    const navigate = useNavigate()
    const confirm = useConfirm()
    const { toppings, ingredientCosts, recipes, extraIngredients, batchKeys, batchProducts, refreshProducts } = useProducts()
    const { addressId } = useAddress()
    const links = useProductLinks()
    const topping = toppingId ? toppings.find(t => t.id === toppingId) : undefined
    // Topping tự nấu kiểu cũ = thành phẩm cùng tên (chung khoá tồn kho) → tên khoá theo thành phẩm.
    const ownKey = topping ? normalizeIngredientKey(topping.name) : ''
    const batch = ownKey ? batchProducts.find(p => normalizeIngredientKey(p.name) === ownKey) : undefined
    const source: ToppingSource | null = topping?.source_ingredient ? { ingredient: topping.source_ingredient, amount: Number(topping.source_amount) } : null

    useEffect(() => {
        if (!toppingId) return
        let cancelled = false
        fetchProductToppingLinks([toppingId]).then(linkRows => { if (!cancelled) links.reset(new Set(linkRows.map(l => l.product_id))) })
        return () => { cancelled = true }
    }, [toppingId, links.reset])

    // Dòng tồn cùng tên topping: bỏ được không (không món / thành phẩm / topping khác dùng) + cảnh báo nếu đang còn tồn.
    const ownRow = async () => {
        const others = toppings.filter(t => t.id !== toppingId).map(t => t.id)
        const [otherIngs, stocks] = await Promise.all([fetchToppingIngredients(others), fetchIngredientStocks(addressId)])
        const drop = ownKey in ingredientCosts && !isIngredientReferenced(ownKey, { recipes, extraIngredients, batchKeys, toppingIngredients: otherIngs as Record<string, ToppingIng[]>, excludeId: toppingId! })
        const stock = drop ? stocks?.find((r: { ingredient: string; current_stock?: number }) => r.ingredient === ownKey)?.current_stock ?? 0 : 0
        return { drop, detail: stock > 0 ? `Còn tồn ${Math.round(stock * 10) / 10} ${getIngredientUnit(ownKey)} (${ingredientLabel(ownKey)}); bỏ sẽ mất luôn số tồn này.` : undefined }
    }

    const run = (label: string, fn: () => Promise<void>) => toppingId ? withSaving(label, fn) : Promise.resolve()

    return {
        topping, source, links, batch,
        // Rời khỏi dòng tồn cùng tên (topping mua sẵn → chuyển sang trỏ thành phẩm) → hỏi bỏ dòng đó, kẻo Kiểm kê lại hiện 2 dòng.
        saveSource: async (next: ToppingSource | null) => {
            const leaving = source?.ingredient === ownKey && next?.ingredient !== ownKey
            const { drop, detail } = leaving ? await ownRow() : { drop: false, detail: undefined }
            const dropIt = drop && await confirm({ title: `Bỏ "${ingredientLabel(ownKey)}" khỏi kho?`, detail: detail ?? 'Topping không còn trừ dòng này nên nó chỉ nằm thừa ở Lưu trữ và Kiểm kê.', danger: true, confirmLabel: 'Bỏ', cancelLabel: 'Giữ lại' })
            await run('Lưu nguồn tồn kho', async () => {
                await updateToppingSource(toppingId!, next)
                if (dropIt) await deleteIngredientCost(ownKey, addressId)
                await refreshProducts()
            })
        },
        saveName: (name: string) => name.trim() ? run('Lưu tên topping', async () => { await updateToppingName(toppingId!, name.trim()); await refreshProducts() }) : Promise.resolve(),
        savePrice: (price: number) => run('Lưu giá topping', async () => { await updateToppingPrice(toppingId!, price); await refreshProducts() }),
        saveLinks: () => run('Lưu danh sách món dùng topping', async () => {
            await setToppingProductLinks(toppingId!, [...links.selected])
            links.markSaved()
            await refreshProducts()
            showSaved()
        }),
        deleteSelf: async () => {
            if (!topping) return
            const { drop, detail } = await ownRow()
            if (!await confirm({ title: `Xoá topping "${topping.name}"?`, detail: detail ?? (batchKeys.has(ownKey) ? 'Thành phẩm cùng tên (công thức nấu) vẫn được giữ; xoá riêng ở trang thành phẩm nếu không cần.' : undefined), danger: true, confirmLabel: 'Xoá' })) return
            await run('Xoá topping', async () => {
                await deleteTopping(toppingId!)
                if (drop) await deleteIngredientCost(ownKey, addressId)
                await refreshProducts()
                navigate(backUrl)
            })
        },
    }
}
