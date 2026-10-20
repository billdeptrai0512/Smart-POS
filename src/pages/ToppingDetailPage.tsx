import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { useConfirm } from '../contexts/ConfirmContext'
import { useToast } from '../hooks/useToast'
import { useSavingAction } from '../hooks/useSavingAction'
import { useProductLinks } from '../hooks/useProductLinks'
import Toast from '../components/POSPage/Toast'
import EditableEntityHeader from '../components/common/EditableEntityHeader'
import ProductLinksSection from '../components/common/ProductLinksSection'
import FastIngredientFill, { type CustomIngredient } from '../components/RecipeIngredientPage/FastIngredientFill'
import { capitalizeWords } from '../utils'
import { getIngredientUnit, makeCategoryOf, registerNewIngredients } from '../utils/ingredients'
import {
    updateToppingName, updateToppingPrice, deleteTopping,
    fetchToppingIngredients, upsertToppingIngredient, deleteToppingIngredient,
    fetchProductToppingLinks, setToppingProductLinks,
    upsertIngredientCost,
} from '../services/orderService'
import { ICON_BTN_DANGER } from '../components/common/ModalShell'

interface ToppingIng { topping_id: string; ingredient: string; amount: number; unit?: string | null }

export default function ToppingDetailPage() {
    const navigate = useNavigate()
    const { toppingId } = useParams() as { toppingId: string }
    const { toppings, products, ingredientCosts, ingredientUnits, ingredientConfigs, refreshProducts } = useProducts()
    const { addressId } = useAddress()
    const { isManager, isAdmin } = useAuth()
    const canEdit = isManager || isAdmin
    const { toast, showToast, showError } = useToast()
    const confirm = useConfirm()

    const topping = toppings.find(t => t.id === toppingId)

    const { saving, withSaving } = useSavingAction(showError)
    const [toppingIngs, setToppingIngs] = useState<ToppingIng[]>([])
    const productLinks = useProductLinks()

    useEffect(() => {
        let cancelled = false
        async function load() {
            const [ingsMap, links] = await Promise.all([
                fetchToppingIngredients([toppingId]),
                fetchProductToppingLinks([toppingId]),
            ])
            if (cancelled) return
            setToppingIngs((ingsMap[toppingId] || []) as ToppingIng[])
            productLinks.reset(new Set(links.map(l => l.product_id)))
        }
        load()
        return () => { cancelled = true }
    }, [toppingId, productLinks.reset])

    const categoryOf = useMemo(() => makeCategoryOf(ingredientConfigs), [ingredientConfigs])

    const dbIngredients = useMemo(() => Object.keys(ingredientCosts || {}), [ingredientCosts])

    async function saveName(name: string) {
        if (!name.trim()) return
        await withSaving('Lưu tên topping', async () => {
            await updateToppingName(toppingId, name.trim())
            await refreshProducts()
        })
    }

    async function savePrice(price: number) {
        await withSaving('Lưu giá topping', async () => {
            await updateToppingPrice(toppingId, price)
            await refreshProducts()
        })
    }

    // ─── Công thức topping (mirrors RecipeIngredientPage's base-recipe handlers) ───
    async function setIngredientAmount(ingredient: string, amount: number, unit: string) {
        await withSaving('Lưu công thức topping', async () => {
            await upsertToppingIngredient(toppingId, ingredient, amount, unit)
            setToppingIngs(prev => {
                const exists = prev.some(r => r.ingredient === ingredient)
                if (exists) return prev.map(r => r.ingredient === ingredient ? { ...r, amount } : r)
                return [...prev, { topping_id: toppingId, ingredient, amount, unit: unit || getIngredientUnit(ingredient) }]
            })
        })
    }

    async function removeIngredient(ingredient: string) {
        await withSaving('Xoá nguyên liệu khỏi công thức', async () => {
            await deleteToppingIngredient(toppingId, ingredient)
            setToppingIngs(prev => prev.filter(r => r.ingredient !== ingredient))
        })
    }

    async function addCustomIngredients(custom: CustomIngredient) {
        await withSaving('Thêm nguyên liệu vào công thức', async () => {
            const existingKeys = new Set(toppingIngs.map(r => r.ingredient))
            const fresh = await registerNewIngredients([custom], { existingKeys, ingredientCosts, addressId, upsertIngredientCost })
            for (const { key, unit } of fresh) {
                await upsertToppingIngredient(toppingId, key, 0, unit)
            }
            setToppingIngs(prev => [...prev, ...fresh.map(({ key, unit }) => ({ topping_id: toppingId, ingredient: key, amount: 0, unit: unit || getIngredientUnit(key) }))])
            await refreshProducts()
        })
    }

    if (!topping) {
        return (
            <div className="flex flex-col h-full bg-bg items-center justify-center gap-3 px-6">
                <p className="text-text-secondary text-[13px] text-center">Không tìm thấy topping này (có thể đã bị xoá).</p>
                <button onClick={() => navigate('/category/recipes?kind=topping')} className="text-primary text-[13px] font-bold">Về danh sách topping</button>
            </div>
        )
    }

    async function saveLinks() {
        await withSaving('Lưu danh sách món dùng topping', async () => {
            await setToppingProductLinks(toppingId, [...productLinks.selected])
            productLinks.markSaved()
            await refreshProducts()
            showToast('Đã lưu', 'success')
        })
    }

    async function handleDelete() {
        if (!await confirm({ title: `Xoá topping "${topping!.name}"?`, danger: true, confirmLabel: 'Xoá' })) return
        await withSaving('Xoá topping', async () => {
            await deleteTopping(toppingId)
            await refreshProducts()
            navigate('/category/recipes?kind=topping')
        })
    }

    return (
        <div className="flex flex-col h-full bg-bg">
            <Toast toast={toast} />

            <EditableEntityHeader
                name={topping.name}
                nameTransform={capitalizeWords}
                canEdit={canEdit}
                onBack={() => navigate('/category/recipes?kind=topping')}
                onSaveName={saveName}
                price={topping.price}
                priceLabel="Giá cộng thêm:"
                onSavePrice={savePrice}
                action={canEdit && (
                    <button
                        onClick={handleDelete}
                        className={ICON_BTN_DANGER}
                        title="Xoá topping"
                    >
                        <Trash2 size={20} strokeWidth={2.5} />
                    </button>
                )}
            />

            <main className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-bg">
                <section>
                    <span className="block text-[13px] font-black text-text uppercase tracking-wide mb-3">Công thức</span>
                    <FastIngredientFill
                        entries={toppingIngs}
                        dbIngredients={dbIngredients}
                        getUnit={(k) => getIngredientUnit(k, ingredientUnits?.[k], ingredientUnits)}
                        categoryOf={categoryOf}
                        ingredientCosts={ingredientCosts}
                        canEdit={canEdit}
                        showCost
                        onSetAmount={setIngredientAmount}
                        onRemove={removeIngredient}
                        onAddCustom={addCustomIngredients}
                    />
                </section>

                <ProductLinksSection links={productLinks} products={products} canEdit={canEdit} saving={saving} onSave={saveLinks} />
            </main>
        </div>
    )
}
