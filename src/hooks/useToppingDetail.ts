import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useConfirm } from '../contexts/ConfirmContext'
import { useProductLinks } from './useProductLinks'
import { getIngredientUnit, registerNewIngredients } from '../utils/ingredients'
import type { CustomIngredient } from '../components/RecipeIngredientPage/FastIngredientFill'
import {
    updateToppingName, updateToppingPrice, deleteTopping,
    fetchToppingIngredients, upsertToppingIngredient, deleteToppingIngredient,
    fetchProductToppingLinks, setToppingProductLinks,
    upsertIngredientCost,
} from '../services/orderService'
import { fetchToppingSource, updateToppingSource, type ToppingSource } from '../services/toppingService'

export interface ToppingIng { topping_id: string; ingredient: string; amount: number; unit?: string | null }

// Dữ liệu + thao tác của 1 topping cho trang chi tiết công thức (RecipeIngredientPage dùng chung trang với món/thành phẩm).
// toppingId = null → không phải topping, hook không làm gì (hook không được gọi có điều kiện).
// withSaving: bọc thao tác của trang (cùng cờ "Đang lưu…" và hiển thị lỗi).
export function useToppingDetail(toppingId: string | null, withSaving: (label: string, fn: () => Promise<void>) => Promise<unknown>, backUrl: string, showSaved: () => void) {
    const navigate = useNavigate()
    const confirm = useConfirm()
    const { toppings, ingredientCosts, refreshProducts } = useProducts()
    const { addressId } = useAddress()
    const [ings, setIngs] = useState<ToppingIng[]>([])
    const [source, setSource] = useState<ToppingSource | null>(null)
    const links = useProductLinks()
    const topping = toppingId ? toppings.find(t => t.id === toppingId) : undefined

    useEffect(() => {
        if (!toppingId) return
        let cancelled = false
        Promise.all([fetchToppingIngredients([toppingId]), fetchProductToppingLinks([toppingId]), fetchToppingSource(toppingId)]).then(([ingsMap, linkRows, src]) => {
            if (cancelled) return
            setSource(src)
            setIngs((ingsMap[toppingId] || []) as ToppingIng[])
            links.reset(new Set(linkRows.map(l => l.product_id)))
        })
        return () => { cancelled = true }
    }, [toppingId, links.reset])

    const run = (label: string, fn: () => Promise<void>) => toppingId ? withSaving(label, fn) : Promise.resolve()

    return {
        topping, ings, links, source,
        saveSource: (next: ToppingSource | null) => run('Lưu nguồn tồn kho topping', async () => {
            await updateToppingSource(toppingId!, next)
            setSource(next)
            await refreshProducts()
        }),
        saveName: (name: string) => name.trim() ? run('Lưu tên topping', async () => { await updateToppingName(toppingId!, name.trim()); await refreshProducts() }) : Promise.resolve(),
        savePrice: (price: number) => run('Lưu giá topping', async () => { await updateToppingPrice(toppingId!, price); await refreshProducts() }),
        setAmount: (ingredient: string, amount: number, unit: string) => run('Lưu công thức topping', async () => {
            await upsertToppingIngredient(toppingId!, ingredient, amount, unit)
            setIngs(prev => prev.some(r => r.ingredient === ingredient)
                ? prev.map(r => r.ingredient === ingredient ? { ...r, amount } : r)
                : [...prev, { topping_id: toppingId!, ingredient, amount, unit: unit || getIngredientUnit(ingredient) }])
        }),
        remove: (ingredient: string) => run('Xoá nguyên liệu khỏi công thức', async () => {
            await deleteToppingIngredient(toppingId!, ingredient)
            setIngs(prev => prev.filter(r => r.ingredient !== ingredient))
        }),
        addCustom: (custom: CustomIngredient) => run('Thêm nguyên liệu vào công thức', async () => {
            const existingKeys = new Set(ings.map(r => r.ingredient))
            const fresh = await registerNewIngredients([custom], { existingKeys, ingredientCosts, addressId, upsertIngredientCost })
            for (const { key, unit } of fresh) await upsertToppingIngredient(toppingId!, key, 0, unit)
            setIngs(prev => [...prev, ...fresh.map(({ key, unit }) => ({ topping_id: toppingId!, ingredient: key, amount: 0, unit: unit || getIngredientUnit(key) }))])
            await refreshProducts()
        }),
        saveLinks: () => run('Lưu danh sách món dùng topping', async () => {
            await setToppingProductLinks(toppingId!, [...links.selected])
            links.markSaved()
            await refreshProducts()
            showSaved()
        }),
        deleteSelf: async () => {
            if (!topping || !await confirm({ title: `Xoá topping "${topping.name}"?`, danger: true, confirmLabel: 'Xoá' })) return
            await run('Xoá topping', async () => {
                await deleteTopping(toppingId!)
                await refreshProducts()
                navigate(backUrl)
            })
        },
    }
}
