import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useConfirm } from '../contexts/ConfirmContext'
import { useProductLinks } from './useProductLinks'
import { getIngredientUnit, registerNewIngredients, normalizeIngredientKey, ingredientLabel } from '../utils/ingredients'
import type { CustomIngredient } from '../components/RecipeIngredientPage/FastIngredientFill'
import {
    updateToppingName, updateToppingPrice, deleteTopping,
    fetchToppingIngredients, upsertToppingIngredient, deleteToppingIngredient,
    fetchProductToppingLinks, setToppingProductLinks,
    upsertIngredientCost, deleteIngredientCost, fetchIngredientStocks, insertProduct,
    upsertRecipes, deleteRecipeRow, updateProductBatchYield,
} from '../services/orderService'
import { isIngredientReferenced } from '../utils/toppingStock'
import { toppingSyncPlan } from '../utils/toppingSync'
import { updateToppingSource, type ToppingSource } from '../services/toppingService'

export interface ToppingIng { topping_id: string; ingredient: string; amount: number; unit?: string | null }

// Dữ liệu + thao tác của 1 topping cho trang chi tiết công thức (RecipeIngredientPage dùng chung trang với món/thành phẩm).
// toppingId = null → không phải topping, hook không làm gì (hook không được gọi có điều kiện).
// withSaving: bọc thao tác của trang (cùng cờ "Đang lưu…" và hiển thị lỗi).
export function useToppingDetail(toppingId: string | null, withSaving: (label: string, fn: () => Promise<void>) => Promise<unknown>, backUrl: string, showSaved: () => void) {
    const navigate = useNavigate()
    const confirm = useConfirm()
    const { toppings, ingredientCosts, recipes, extraIngredients, batchKeys, batchProducts, refreshProducts } = useProducts()
    const { addressId } = useAddress()
    const [ings, setIngs] = useState<ToppingIng[]>([])
    // draft: số vừa gõ ở ô "1 mẻ ra" / "mỗi phần trừ", chưa đủ điều kiện lưu (rỗng = dùng giá trị đã lưu).
    const [draft, setDraft] = useState<{ yield?: string; serving?: string }>({})
    const links = useProductLinks()
    const topping = toppingId ? toppings.find(t => t.id === toppingId) : undefined
    // Topping tự nấu = thành phẩm cùng tên (chung khoá tồn kho); nguồn của nó là chính khoá đó.
    const ownKey = topping ? normalizeIngredientKey(topping.name) : ''
    const batch = ownKey ? batchProducts.find(p => normalizeIngredientKey(p.name) === ownKey) : undefined
    const source: ToppingSource | null = topping?.source_ingredient ? { ingredient: topping.source_ingredient, amount: Number(topping.source_amount) } : null
    const selfSource = source?.ingredient === ownKey
    const asRow = (r: { ingredient: string; amount: number | string; unit?: string | null }): ToppingIng => ({ topping_id: toppingId!, ingredient: r.ingredient, amount: Number(r.amount), unit: r.unit })
    // Danh sách hiển thị: công thức đã lưu ở topping > công thức mẻ (đã tự nấu) > nguồn mua sẵn (1 dòng).
    const rows = ings.length ? ings : selfSource && batch ? recipes.filter(r => r.product_id === batch.id).map(asRow) : source && !selfSource ? [asRow(source)] : []
    const yieldStr = draft.yield ?? (batch?.batch_yield != null ? String(batch.batch_yield) : '')
    const servingStr = draft.serving ?? (selfSource ? String(source!.amount) : '')

    useEffect(() => {
        if (!toppingId) return
        let cancelled = false
        Promise.all([fetchToppingIngredients([toppingId]), fetchProductToppingLinks([toppingId])]).then(([ingsMap, linkRows]) => {
            if (cancelled) return
            setIngs((ingsMap[toppingId] || []) as ToppingIng[])
            links.reset(new Set(linkRows.map(l => l.product_id)))
        })
        return () => { cancelled = true }
    }, [toppingId, links.reset])

    const run = (label: string, fn: () => Promise<void>) => toppingId ? withSaving(label, fn) : Promise.resolve()

    // Nguyên liệu → nguồn tồn kho. 1 dòng = mua sẵn: trừ thẳng nguyên liệu đó (lượng/phần). ≥2 dòng = tự nấu: thành phẩm CÙNG TÊN giữ công thức
    // (lượng/mẻ, sản lượng y) và nguồn của topping là chính khoá đó (s/phần); chưa đủ y, s thì giữ nguồn cũ.
    // ponytail: danh sách này là nơi sửa duy nhất — sửa công thức ở trang thành phẩm sẽ bị ghi đè lần lưu kế; đổi tên / xoá topping không kéo theo thành phẩm.
    const sync = async (next: ToppingIng[], y: number, s: number) => {
        const plan = toppingSyncPlan(next, y, s, !!source)
        if (plan.kind === 'clear') await updateToppingSource(toppingId!, null)
        else if (plan.kind === 'direct') await updateToppingSource(toppingId!, plan.source)
        else if (plan.kind === 'cook') {
            const b = batch ?? await insertProduct(topping!.name, 0, addressId, false, y)
            if (batch && Number(batch.batch_yield) !== y) await updateProductBatchYield(b.id, y)
            await upsertRecipes(next.map(r => ({ productId: b.id, ingredient: r.ingredient, amount: r.amount, addressId, unit: r.unit })))
            for (const r of recipes) if (r.product_id === b.id && !next.some(x => x.ingredient === r.ingredient)) await deleteRecipeRow(b.id, r.ingredient, addressId)
            const cost = next.reduce((sum, r) => sum + r.amount * (ingredientCosts[r.ingredient] || 0), 0)
            await upsertIngredientCost(ownKey, Math.round(cost / y), addressId, null)
            await updateToppingSource(toppingId!, { ingredient: ownKey, amount: s })
            setDraft({})
        }
        await refreshProducts()
    }
    const persist = async (next: ToppingIng[]) => {
        for (const r of rows) if (!next.some(x => x.ingredient === r.ingredient)) await deleteToppingIngredient(toppingId!, r.ingredient)
        for (const r of next) await upsertToppingIngredient(toppingId!, r.ingredient, r.amount, r.unit ?? null)
        setIngs(next)
        await sync(next, Number(yieldStr), Number(servingStr))
    }

    return {
        topping, rows, links, batch, ownKey,
        cook: {
            yield: yieldStr, serving: servingStr,
            setYield: (v: string) => setDraft(d => ({ ...d, yield: v })),
            setServing: (v: string) => setDraft(d => ({ ...d, serving: v })),
            commit: () => run('Lưu thông tin mẻ', () => sync(rows, Number(yieldStr), Number(servingStr))),
        },
        saveName: (name: string) => name.trim() ? run('Lưu tên topping', async () => { await updateToppingName(toppingId!, name.trim()); await refreshProducts() }) : Promise.resolve(),
        savePrice: (price: number) => run('Lưu giá topping', async () => { await updateToppingPrice(toppingId!, price); await refreshProducts() }),
        setAmount: (ingredient: string, amount: number, unit: string) => run('Lưu công thức topping', () => persist(
            rows.some(r => r.ingredient === ingredient)
                ? rows.map(r => r.ingredient === ingredient ? { ...r, amount } : r)
                : [...rows, asRow({ ingredient, amount, unit: unit || getIngredientUnit(ingredient) })])),
        remove: (ingredient: string) => run('Xoá nguyên liệu khỏi công thức', () => persist(rows.filter(r => r.ingredient !== ingredient))),
        addCustom: (custom: CustomIngredient) => run('Thêm nguyên liệu vào công thức', async () => {
            const fresh = await registerNewIngredients([custom], { existingKeys: new Set(rows.map(r => r.ingredient)), ingredientCosts, addressId, upsertIngredientCost })
            await persist([...rows, ...fresh.map(({ key, unit }) => asRow({ ingredient: key, amount: 0, unit: unit || getIngredientUnit(key) }))])
        }),
        saveLinks: () => run('Lưu danh sách món dùng topping', async () => {
            await setToppingProductLinks(toppingId!, [...links.selected])
            links.markSaved()
            await refreshProducts()
            showSaved()
        }),
        // Xoá topping + dọn dòng tồn kho cùng tên (nếu không ai khác dùng khoá đó) để khỏi còn "mồ côi" trong Kiểm kê.
        // Đang còn tồn thì nói rõ trong hộp xác nhận vì số tồn đó mất theo.
        deleteSelf: async () => {
            if (!topping) return
            const key = normalizeIngredientKey(topping.name)
            const others = toppings.filter(t => t.id !== toppingId).map(t => t.id)
            const [otherIngs, stocks] = await Promise.all([fetchToppingIngredients(others), fetchIngredientStocks(addressId)])
            const dropStockRow = key in ingredientCosts && !isIngredientReferenced(key, { recipes, extraIngredients, batchKeys, toppingIngredients: otherIngs as Record<string, ToppingIng[]>, excludeId: toppingId! })
            const stock = dropStockRow ? stocks?.find((r: { ingredient: string; current_stock?: number }) => r.ingredient === key)?.current_stock ?? 0 : 0
            const detail = stock > 0 ? `Topping còn tồn ${Math.round(stock * 10) / 10} ${getIngredientUnit(key)} (${ingredientLabel(key)}); xoá sẽ mất luôn số tồn này.` : batchKeys.has(key) ? 'Thành phẩm cùng tên (công thức nấu) vẫn được giữ; xoá riêng ở trang thành phẩm nếu không cần.' : undefined
            if (!await confirm({ title: `Xoá topping "${topping.name}"?`, detail, danger: true, confirmLabel: 'Xoá' })) return
            await run('Xoá topping', async () => {
                await deleteTopping(toppingId!)
                if (dropStockRow) await deleteIngredientCost(key, addressId)
                await refreshProducts()
                navigate(backUrl)
            })
        },
    }
}
