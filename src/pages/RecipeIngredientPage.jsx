import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useProducts } from '../contexts/ProductContext'
import { useAuth } from '../contexts/AuthContext'
import { useAddress } from '../contexts/AddressContext'
import {
    upsertRecipe,
    upsertProductPrice,
    updateProductCountAsCup,
    insertProductExtra,
    updateProductExtraName,
    updateProductExtraPrice,
    updateProductExtraSticky,
    duplicateProductExtra,
    updateExtrasSortOrder,
    deleteProductExtra,
    removeProductFromAddress,
    upsertExtraIngredient,
    deleteExtraIngredient,
    upsertIngredientCost,
    deleteRecipeRow,
    fetchIngredientStocks,
} from '../services/orderService'
import { sortIngredients, ingredientLabel, getIngredientUnit } from '../components/common/recipeUtils'
import { useToast } from '../hooks/useToast'
import Toast from '../components/POSPage/Toast'
import RecipeHeader from '../components/RecipeIngredientPage/RecipeHeader'
import BaseRecipeSection from '../components/RecipeIngredientPage/BaseRecipeSection'
import ExtrasSection from '../components/RecipeIngredientPage/ExtrasSection'

export default function RecipeIngredientPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const { productId } = useParams()
    const {
        products, recipes: allRecipes,
        ingredientCosts: contextCosts, ingredientUnits: contextUnits,
        productExtras: contextExtras, extraIngredients: contextExtraIngs,
        refreshProducts,
    } = useProducts()
    const { selectedAddress } = useAddress()
    const { isManager, isAdmin } = useAuth()
    const { toast, showError } = useToast()
    const canEdit = isManager || isAdmin

    const [ingredientCosts, setIngredientCosts] = useState(contextCosts || {})
    const [ingredientUnits, setIngredientUnits] = useState(contextUnits || {})
    const [recipes, setRecipes] = useState(allRecipes || [])
    const [extras, setExtras] = useState([])
    const [extraIngs, setExtraIngs] = useState(contextExtraIngs || {})
    const [saving, setSaving] = useState(false)
    const [ingredientStocks, setIngredientStocks] = useState({})

    const product = useMemo(() => products.find(p => p.id === productId), [products, productId])

    useEffect(() => {
        if (!selectedAddress?.id) return
        fetchIngredientStocks(selectedAddress.id).then(stocks => {
            const map = {}
            stocks.forEach(s => map[s.ingredient] = s.current_stock)
            setIngredientStocks(map)
        }).catch(console.error)
    }, [selectedAddress?.id])

    // Fetch fresh data on mount to avoid showing stale localStorage cache
    useEffect(() => { refreshProducts?.() }, [])

    // Sync from context when it updates
    useEffect(() => { setRecipes(allRecipes) }, [allRecipes])
    useEffect(() => { setIngredientCosts(contextCosts) }, [contextCosts])
    useEffect(() => { setIngredientUnits(contextUnits || {}) }, [contextUnits])
    useEffect(() => { setExtras(contextExtras?.[productId] || []) }, [contextExtras, productId])
    useEffect(() => { setExtraIngs(contextExtraIngs || {}) }, [contextExtraIngs])

    const prodRecipes = useMemo(
        () => recipes
            .filter(r => r.product_id === productId)
            .sort((a, b) => sortIngredients(a.ingredient, b.ingredient, selectedAddress?.ingredient_sort_order)),
        [recipes, productId, selectedAddress?.ingredient_sort_order]
    )

    const dbIngredients = useMemo(
        () => Object.keys(ingredientCosts)
            .sort((a, b) => sortIngredients(a, b, selectedAddress?.ingredient_sort_order)),
        [ingredientCosts, selectedAddress?.ingredient_sort_order]
    )
    const baseIngredients = prodRecipes.map(r => r.ingredient)
    const availableBaseIngredients = dbIngredients.filter(i => !baseIngredients.includes(i))

    // Wraps an async action with saving=true/false + error toast
    const withSaving = async (errorContext, fn) => {
        setSaving(true)
        try { await fn() }
        catch (err) { showError(err, errorContext) }
        finally { setSaving(false) }
    }

    // ─── Base recipe handlers ─────────────────────────────────────────
    async function handleDeleteRecipeIngredient(ingredient) {
        if (!window.confirm(`Xóa "${ingredientLabel(ingredient)}" khỏi công thức?`)) return
        await withSaving('Xóa nguyên liệu khỏi công thức', async () => {
            await deleteRecipeRow(productId, ingredient, selectedAddress?.id)
            setRecipes(prev => prev.filter(r => !(r.product_id === productId && r.ingredient === ingredient)))
        })
    }

    async function saveAmount(ingredient, newAmount) {
        await withSaving('Lưu lượng nguyên liệu', async () => {
            await upsertRecipe(productId, ingredient, newAmount, selectedAddress?.id)
            setRecipes(prev => prev.map(r =>
                r.product_id === productId && r.ingredient === ingredient
                    ? { ...r, amount: newAmount }
                    : r
            ))
        })
    }

    async function saveProductPrice(newPrice) {
        if (!selectedAddress?.id) return
        await withSaving('Lưu giá bán sản phẩm', async () => {
            await upsertProductPrice(productId, selectedAddress.id, newPrice)
            refreshProducts?.()
        })
    }

    async function toggleCountAsCup() {
        const next = product?.count_as_cup === false
        await withSaving('Cập nhật cờ đếm ly', async () => {
            await updateProductCountAsCup(productId, next)
            refreshProducts?.()
        })
    }

    async function handleAddBaseIngredients({ keys, custom }) {
        const toAdd = keys.map(key => ({ key, unit: null }))
        if (custom) toAdd.push(custom)
        if (toAdd.length === 0) return
        await withSaving('Thêm nguyên liệu vào công thức', async () => {
            for (const { key, unit } of toAdd) {
                await upsertRecipe(productId, key, 0, selectedAddress?.id, unit)
                // Register custom ingredients into ingredient_costs so they appear in /ingredients
                if (unit !== null) {
                    await upsertIngredientCost(key, 0, selectedAddress?.id, unit)
                }
            }
            setRecipes(prev => [
                ...prev,
                ...toAdd.map(({ key, unit }) => ({
                    product_id: productId, ingredient: key, amount: 0,
                    unit: unit || getIngredientUnit(key),
                })),
            ])
            refreshProducts?.()
        })
    }

    async function handleDeleteFromMenu() {
        const addrId = selectedAddress?.id || null
        if (!addrId && !isAdmin) return
        const targetName = addrId ? 'của chi nhánh này' : 'mặc định của hệ thống'
        if (!window.confirm(`Xóa "${product.name}" khỏi menu ${targetName}?`)) return
        await withSaving('Xóa món khỏi menu', async () => {
            await removeProductFromAddress(productId, addrId)
            refreshProducts?.()
            navigate('/recipes', { state: location.state })
        })
    }

    // ─── Extras handlers ──────────────────────────────────────────────
    async function handleAddExtra(name, price) {
        await withSaving('Thêm tùy chọn', async () => {
            const newExtra = await insertProductExtra(productId, name, price, selectedAddress?.id)
            setExtras(prev => [...prev, { id: newExtra.id, name: newExtra.name, price: newExtra.price }])
            refreshProducts?.()
        })
    }

    async function saveExtraName(extraId, newName) {
        const trimmed = newName.trim()
        if (!trimmed) return
        await withSaving('Lưu tên tùy chọn', async () => {
            await updateProductExtraName(extraId, trimmed)
            setExtras(prev => prev.map(e => e.id === extraId ? { ...e, name: trimmed } : e))
            refreshProducts?.()
        })
    }

    async function saveExtraPrice(extraId, newPrice) {
        await withSaving('Lưu giá tùy chọn', async () => {
            await updateProductExtraPrice(extraId, newPrice)
            setExtras(prev => prev.map(e => e.id === extraId ? { ...e, price: newPrice } : e))
            refreshProducts?.()
        })
    }

    async function toggleExtraSticky(extraId, nextValue) {
        try {
            await updateProductExtraSticky(extraId, nextValue)
            setExtras(prev => prev.map(e => e.id === extraId ? { ...e, is_sticky: nextValue } : e))
            refreshProducts?.()
        } catch (err) {
            showError(err, 'Cập nhật sticky')
        }
    }

    async function deleteExtra(extraId, extraName) {
        if (!window.confirm(`Xóa tùy chọn "${extraName}"?`)) return
        await withSaving('Xóa tùy chọn', async () => {
            await deleteProductExtra(extraId)
            setExtras(prev => prev.filter(e => e.id !== extraId))
            refreshProducts?.()
        })
    }

    async function duplicateExtra(extraId, newName) {
        await withSaving('Nhân bản tùy chọn', async () => {
            await duplicateProductExtra(extraId, newName, selectedAddress?.id)
            refreshProducts?.()
        })
    }

    async function saveExtrasSortOrder(orderedIds) {
        await withSaving('Lưu thứ tự tùy chọn', async () => {
            await updateExtrasSortOrder(orderedIds)
            await refreshProducts?.()
        })
    }

    async function handleAddExtraIngredients(extraId, { keys, custom }) {
        const toAdd = keys.map(key => ({ key, unit: null }))
        if (custom) toAdd.push(custom)
        if (toAdd.length === 0) return
        await withSaving('Thêm nguyên liệu vào tùy chọn', async () => {
            for (const { key, unit } of toAdd) {
                await upsertExtraIngredient(extraId, key, 0, unit)
            }
            setExtraIngs(prev => ({
                ...prev,
                [extraId]: [
                    ...(prev[extraId] || []),
                    ...toAdd.map(({ key, unit }) => ({
                        extra_id: extraId, ingredient: key, amount: 0,
                        unit: unit || getIngredientUnit(key),
                    })),
                ],
            }))
            refreshProducts?.()
        })
    }

    async function saveExtraAmount(extraId, ingredient, newAmount) {
        await withSaving('Lưu lượng nguyên liệu tùy chọn', async () => {
            await upsertExtraIngredient(extraId, ingredient, newAmount)
            setExtraIngs(prev => ({
                ...prev,
                [extraId]: (prev[extraId] || []).map(ei =>
                    ei.ingredient === ingredient ? { ...ei, amount: newAmount } : ei
                ),
            }))
            refreshProducts?.()
        })
    }

    async function deleteExtraIng(extraId, ingredient) {
        if (!window.confirm(`Xóa tác động nguyên liệu này?`)) return
        await withSaving('Xóa nguyên liệu khỏi tùy chọn', async () => {
            await deleteExtraIngredient(extraId, ingredient)
            setExtraIngs(prev => ({
                ...prev,
                [extraId]: (prev[extraId] || []).filter(ei => ei.ingredient !== ingredient),
            }))
            refreshProducts?.()
        })
    }

    if (!product) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-bg px-6 gap-4">
                <span className="text-text-secondary text-[14px]">Không tìm thấy món này.</span>
                <button onClick={() => navigate('/recipes', { state: location.state })} className="text-primary font-bold text-[14px] underline">
                    ← Quay lại
                </button>
            </div>
        )
    }

    const extraHandlers = {
        saveName: saveExtraName,
        savePrice: saveExtraPrice,
        toggleSticky: toggleExtraSticky,
        deleteExtra,
        saveExtraAmount,
        deleteExtraIngredient: deleteExtraIng,
        addExtraIngredients: handleAddExtraIngredients,
        duplicate: duplicateExtra,
    }

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative">
            <Toast toast={toast} />

            <RecipeHeader
                product={product}
                canEdit={canEdit}
                onBack={() => navigate('/recipes', { state: location.state })}
                onSavePrice={saveProductPrice}
                onDeleteFromMenu={handleDeleteFromMenu}
                onTabSelect={(key) => {
                    if (key === 'ingredients') navigate('/ingredients', { state: location.state, replace: true })
                    // 'recipes' tab is already active for this page — clicking it goes back to the list
                    else navigate('/recipes', { state: location.state, replace: true })
                }}
            />

            <main className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-bg">
                <BaseRecipeSection
                    prodRecipes={prodRecipes}
                    ingredientCosts={ingredientCosts}
                    ingredientUnits={ingredientUnits}
                    availableBaseIngredients={availableBaseIngredients}
                    dbIngredients={dbIngredients}
                    canEdit={canEdit}
                    onSaveAmount={saveAmount}
                    onDeleteIngredient={handleDeleteRecipeIngredient}
                    onAddIngredients={handleAddBaseIngredients}
                    ingredientStocks={ingredientStocks}
                />

                {canEdit && (
                    <div className="mt-4 pt-4 border-t border-border/40">
                        <label className="flex items-center justify-between gap-3 bg-surface border border-border/60 rounded-[14px] px-4 py-3 cursor-pointer select-none">
                            <span className="flex flex-col min-w-0">
                                <span className="text-[13px] font-bold text-text">Cộng vào tổng số ly bán/ngày</span>
                            </span>
                            <input
                                type="checkbox"
                                checked={product?.count_as_cup !== false}
                                onChange={toggleCountAsCup}
                                disabled={saving}
                                className="w-5 h-5 accent-primary cursor-pointer shrink-0"
                            />
                        </label>
                    </div>
                )}

                <ExtrasSection
                    extras={extras}
                    extraIngs={extraIngs}
                    ingredientUnits={ingredientUnits}
                    dbIngredients={dbIngredients}
                    canEdit={canEdit}
                    saving={saving}
                    onAddExtra={handleAddExtra}
                    onSaveSortOrder={saveExtrasSortOrder}
                    extraHandlers={extraHandlers}
                    ingredientStocks={ingredientStocks}
                />
            </main>

            {saving && (
                <div className="fixed bottom-4 right-4 z-50 pointer-events-none">
                    <span className="text-text-secondary text-[11px] animate-pulse">Đang lưu...</span>
                </div>
            )}
        </div>
    )
}
