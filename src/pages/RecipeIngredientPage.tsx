import { useState, useEffect, useMemo } from 'react'
import { Trash2 } from 'lucide-react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useProducts } from '../contexts/ProductContext'
import { useAuth } from '../contexts/AuthContext'
import { useAddress } from '../contexts/AddressContext'
import { useOnboardingProgressPersist } from '../hooks/useOnboardingProgressPersist'
import { readOnboardingState, DEFAULT_ONBOARDING_STATE } from '../utils/onboardingStorage'
import { norm } from '../utils/onboardingHint'
import { RECIPE_TARGET_PRODUCT } from '../components/common/onboarding/steps'
import {
    upsertRecipe,
    upsertRecipes,
    upsertProductPrice,
    updateProductName,
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
    updateProductBatchYield,
} from '../services/orderService'
import { sortIngredients, getIngredientUnit, makeCategoryOf, registerNewIngredients, normalizeIngredientKey } from '../utils/ingredients'
import { useToast } from '../hooks/useToast'
import { useSavingAction } from '../hooks/useSavingAction'
import { useToppingDetail } from '../hooks/useToppingDetail'
import ToppingSourceSection from '../components/RecipeIngredientPage/ToppingSourceSection'
import ProductLinksSection from '../components/common/ProductLinksSection'
import { ICON_BTN_DANGER } from '../components/common/ModalShell'
import { capitalizeWords } from '../utils'
import { useConfirm } from '../contexts/ConfirmContext'
import Toast from '../components/POSPage/Toast'
import RecipeHeader from '../components/RecipeIngredientPage/RecipeHeader'
import EditableEntityHeader from '../components/common/EditableEntityHeader'
import InlineEditor from '../components/RecipeIngredientPage/InlineEditor'
import FastIngredientFill, { type CustomIngredient } from '../components/RecipeIngredientPage/FastIngredientFill'
import ExtrasSection, { type ExtraHandlers } from '../components/RecipeIngredientPage/ExtrasSection'
import CopyRecipeModal from '../components/RecipeIngredientPage/CopyRecipeModal'
import type { CartExtra } from '../types/domain'
import { groupRecipesByProduct, type RecipeRow } from '../utils/inventory'

export default function RecipeIngredientPage() {
    const navigate = useNavigate()
    const location = useLocation()
    // Cùng trang cho món, thành phẩm và topping: id nằm ở :productId (/category/recipes/:id) hoặc :toppingId (đường cũ /category/toppings/:id).
    const { productId: routeId, toppingId } = useParams()
    const productId = (routeId ?? toppingId) as string
    const {
        products, batchProducts, batchKeys, toppings, recipes: allRecipes,
        ingredientCosts, ingredientUnits,
        productExtras: contextExtras, extraIngredients: contextExtraIngs,
        ingredientConfigs, refreshProducts,
    } = useProducts()
    const { addressId, selectedAddress } = useAddress()
    const { isManager, isAdmin, isGuest } = useAuth()
    const { toast, showError, showToast } = useToast()
    const confirm = useConfirm()
    const canEdit = isManager || isAdmin

    const [recipes, setRecipes] = useState(allRecipes || [])
    const [extras, setExtras] = useState<CartExtra[]>([])
    const [extraIngs, setExtraIngs] = useState(contextExtraIngs || {})
    const { saving, withSaving } = useSavingAction(showError)
    const [showCopyFrom, setShowCopyFrom] = useState(false)
    const [recipeProgress, setRecipeProgress] = useState(() =>
        (addressId ? readOnboardingState(addressId) : DEFAULT_ONBOARDING_STATE).recipeProgress
    )
    useOnboardingProgressPersist('recipeProgress', recipeProgress, { isGuest, addressId })

    const product = useMemo(() => products.find(p => p.id === productId) ?? batchProducts.find(p => p.id === productId), [products, batchProducts, productId])
    // Thành phẩm: công thức này là CÔNG THỨC MẺ (sản lượng = batch_yield), không có giá bán/tùy chọn.
    const isBatch = !!product?.is_batch
    const isTopping = !product && toppings.some(t => t.id === productId)
    // Back / sau khi xoá: về đúng loại đang xem của danh sách.
    const backUrl = '/category/recipes' + (isTopping ? '?kind=topping' : isBatch ? '?kind=batch' : '')
    const td = useToppingDetail(isTopping ? productId : null, withSaving, backUrl, () => showToast('Đã lưu', 'success'))

    // Onboarding phase 5 — chỉ hint/track trên đúng công thức "Cà phê đen".
    const isCafeDen = isGuest && norm(product?.name) === RECIPE_TARGET_PRODUCT

    // Index recipes by product — used by the "copy from" picker and to count rows.
    const recipesByProduct = useMemo(() => groupRecipesByProduct(recipes || []), [recipes])

    // Category lookup for the add-ingredient combobox (groups chips into Chính / Bao bì).
    const categoryOf = useMemo(() => makeCategoryOf(ingredientConfigs), [ingredientConfigs])

    // Fetch fresh data on mount to avoid showing stale localStorage cache.
    // ponytail: mount-only — refreshProducts already refetches on address change via
    // its own effect in ProductContext; adding it here would double-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { refreshProducts?.({ ifStale: true }) }, [])

    // Sync from context when it updates
    useEffect(() => { setRecipes(allRecipes) }, [allRecipes])
    useEffect(() => { setExtras(contextExtras?.[productId] || []) }, [contextExtras, productId])
    useEffect(() => { setExtraIngs(contextExtraIngs || {}) }, [contextExtraIngs])

    const prodRecipes = useMemo(
        () => recipes
            .filter(r => r.product_id === productId)
            .sort((a, b) => sortIngredients(a.ingredient, b.ingredient, selectedAddress?.ingredient_sort_order)),
        [recipes, productId, selectedAddress?.ingredient_sort_order]
    )

    const baseAmounts = useMemo(
        () => Object.fromEntries(prodRecipes.map(r => [r.ingredient, r.amount])),
        [prodRecipes]
    )

    // Render-time-adjust (cùng pattern DailyReportPage.tsx) — track hành động thật, không cần
    // nút Lưu riêng vì FastIngredientFill/ExtrasSection đã ghi DB ngay khi user nhập.
    if (isCafeDen && prodRecipes.length > 0 && prodRecipes.every(r => r.amount > 0) && !recipeProgress.filledAmount) {
        setRecipeProgress(prev => ({ ...prev, filledAmount: true }))
    }
    if (isCafeDen && extras.length > 0 && !recipeProgress.addedExtra) {
        setRecipeProgress(prev => ({ ...prev, addedExtra: true }))
    }

    const dbIngredients = useMemo(
        () => Object.keys(ingredientCosts)
            .filter(k => !isBatch || !batchKeys.has(k)) // thành phẩm chỉ làm từ nguyên liệu gốc
            .sort((a, b) => sortIngredients(a, b, selectedAddress?.ingredient_sort_order)),
        [ingredientCosts, isBatch, batchKeys, selectedAddress?.ingredient_sort_order]
    )

    // Giá vốn 1 đơn vị thành phẩm = Σ(giá vốn NVL × lượng) / sản lượng mẻ — để món dùng thành phẩm tính đúng lãi.
    // ponytail: unit_cost là số nguyên nên thành phẩm rất rẻ/đơn vị bị làm tròn; đổi sang numeric nếu cần chính xác hơn.
    async function syncBatchCost(nextRecipes: RecipeRow[], batchYield = Number(product?.batch_yield) || 0) {
        if (!isBatch || batchYield <= 0) return
        const key = normalizeIngredientKey(product!.name)
        const total = nextRecipes.filter(r => r.product_id === productId).reduce((sum, r) => sum + r.amount * (ingredientCosts[r.ingredient] || 0), 0)
        await upsertIngredientCost(key, Math.round(total / batchYield), addressId, null)
    }

    async function saveBatchYield(batchYield: number) {
        if (!(batchYield > 0)) return
        await withSaving('Lưu sản lượng mẻ', async () => {
            await updateProductBatchYield(productId, batchYield)
            await syncBatchCost(recipes, batchYield)
            refreshProducts?.()
        })
    }
    // ─── Base recipe handlers ─────────────────────────────────────────
    // Amount box only upserts (0 stays a 0-amount row, never deletes — removal is the
    // ✕ button). Optimistic state is authoritative; no refetch on a pure amount edit.
    async function setBaseAmount(ingredient: string, amount: number, unit: string) {
        await withSaving('Lưu công thức', async () => {
            await upsertRecipe(productId, ingredient, amount, addressId, unit)
            const exists = recipes.some(r => r.product_id === productId && r.ingredient === ingredient)
            const next = exists
                ? recipes.map(r => r.product_id === productId && r.ingredient === ingredient ? { ...r, amount } : r)
                : [...recipes, { product_id: productId, ingredient, amount, unit: unit || getIngredientUnit(ingredient) }]
            setRecipes(next)
            await syncBatchCost(next)
            // Guide onboarding đọc định lượng từ context nên guest phải đồng bộ ngay (user thật thì không cần refetch).
            if (isGuest) refreshProducts?.()
        })
    }

    async function removeBaseIngredient(ingredient: string) {
        await withSaving('Xóa nguyên liệu khỏi công thức', async () => {
            await deleteRecipeRow(productId, ingredient, addressId)
            const next = recipes.filter(r => !(r.product_id === productId && r.ingredient === ingredient))
            setRecipes(next)
            await syncBatchCost(next)
            refreshProducts?.()
        })
    }

    async function handleCopyFrom(sourceProductId: string, sourceName: string) {
        const srcRows = recipesByProduct.get(sourceProductId) || []
        const srcExtras = contextExtras?.[sourceProductId] || []
        if (srcRows.length === 0 && srcExtras.length === 0) return
        setShowCopyFrom(false)
        const parts: string[] = []
        if (srcRows.length) parts.push(`${srcRows.length} nguyên liệu`)
        if (srcExtras.length) parts.push(`${srcExtras.length} tùy chọn`)
        if (!await confirm({ title: `Chép ${parts.join(' + ')} từ "${sourceName}"?`, detail: 'Nguyên liệu trùng tên sẽ bị ghi đè lượng; tùy chọn được thêm mới.', confirmLabel: 'Chép' })) return
        await withSaving('Chép công thức', async () => {
            await upsertRecipes(srcRows.map(r => ({ productId, ingredient: r.ingredient, amount: r.amount, addressId, unit: r.unit })))
            // Extras are copied as new rows (each with its own ingredient impacts).
            // Skip any whose name already exists here so copying twice / into a product that
            // already has "Lớn" doesn't create duplicate options.
            const existingExtraNames = new Set(extras.map(e => e.name.trim().toLowerCase()))
            for (const se of srcExtras) {
                if (existingExtraNames.has(se.name.trim().toLowerCase())) continue
                const newExtra = await insertProductExtra(productId, se.name, se.price, addressId)
                if (se.is_sticky) await updateProductExtraSticky(newExtra.id, true)
                for (const ei of (contextExtraIngs?.[se.id] || [])) {
                    await upsertExtraIngredient(newExtra.id, ei.ingredient, ei.amount, ei.unit)
                }
            }
            setRecipes(prev => {
                const next = prev.filter(r => r.product_id !== productId || !srcRows.some(s => s.ingredient === r.ingredient))
                return [...next, ...srcRows.map(r => ({ product_id: productId, ingredient: r.ingredient, amount: r.amount, unit: r.unit }))]
            })
            refreshProducts?.()
        })
    }

    async function saveProductPrice(newPrice: number) {
        if (!selectedAddress) return
        await withSaving('Lưu giá bán sản phẩm', async () => {
            await upsertProductPrice(productId, newPrice)
            refreshProducts?.()
        })
    }

    async function saveProductName(newName: string) {
        const trimmed = newName.trim()
        if (!trimmed || trimmed === product?.name) return
        await withSaving('Lưu tên món', async () => {
            await updateProductName(productId, trimmed)
            refreshProducts?.()
        })
    }

    async function toggleCountAsCup() {
        const next = product?.count_as_cup === false
        await withSaving('Cập nhật cờ đếm ly', async () => {
            await updateProductCountAsCup(productId, next)
            refreshProducts?.()
            showToast(next ? 'Cộng vào tổng số ly bán mỗi ngày' : 'Không cộng vào tổng số ly bán mỗi ngày', 'success')
        })
    }

    async function handleAddBaseIngredients(custom: CustomIngredient) {
        await withSaving('Thêm nguyên liệu vào công thức', async () => {
            // Guard against resetting an ingredient that already exists: only seed amount 0
            // when it's not yet in this recipe, and only register a cost row when it's
            // brand-new — else "Tạo mới" typed with an existing name would zero its amount
            // and (worse) its shared unit cost.
            const existingKeys = new Set(prodRecipes.map(r => r.ingredient))
            const fresh = await registerNewIngredients([custom], { existingKeys, ingredientCosts, addressId, upsertIngredientCost })
            if (fresh.length) {
                await upsertRecipes(fresh.map(({ key, unit }) => ({ productId, ingredient: key, amount: 0, addressId, unit })))
            }
            setRecipes(prev => prev.some(r => r.product_id === productId && r.ingredient === custom.key)
                ? prev
                : [...prev, { product_id: productId, ingredient: custom.key, amount: 0, unit: custom.unit }])
            refreshProducts?.()
        })
    }

    async function handleDeleteFromMenu() {
        const addrId = addressId || null
        if (!addrId && !isAdmin) return
        const targetName = addrId ? 'của chi nhánh này' : 'mặc định của hệ thống'
        if (!await confirm({ title: `Xóa "${product!.name}" khỏi menu ${targetName}?`, danger: true, confirmLabel: 'Xóa' })) return
        await withSaving('Xóa món khỏi menu', async () => {
            await removeProductFromAddress(productId, addrId)
            refreshProducts?.()
            navigate(backUrl, { state: location.state })
        })
    }

    // ─── Extras handlers ──────────────────────────────────────────────
    async function handleAddExtra(name: string, price: number) {
        if (extras.some(e => e.name.trim().toLowerCase() === name.trim().toLowerCase())) {
            showToast(`Đã có tùy chọn "${name.trim()}"`, 'warning')
            return
        }
        await withSaving('Thêm tùy chọn', async () => {
            const newExtra = await insertProductExtra(productId, name, price, addressId)
            setExtras(prev => [...prev, { id: newExtra.id, name: newExtra.name, price: newExtra.price }])
            refreshProducts?.()
        })
    }

    async function saveExtraName(extraId: string, newName: string) {
        const trimmed = newName.trim()
        if (!trimmed) return
        await withSaving('Lưu tên tùy chọn', async () => {
            await updateProductExtraName(extraId, trimmed)
            setExtras(prev => prev.map(e => e.id === extraId ? { ...e, name: trimmed } : e))
            refreshProducts?.()
        })
    }

    async function saveExtraPrice(extraId: string, newPrice: number) {
        await withSaving('Lưu giá tùy chọn', async () => {
            await updateProductExtraPrice(extraId, newPrice)
            setExtras(prev => prev.map(e => e.id === extraId ? { ...e, price: newPrice } : e))
            refreshProducts?.()
        })
    }

    async function toggleExtraSticky(extraId: string, nextValue: boolean) {
        await withSaving('Cập nhật sticky', async () => {
            await updateProductExtraSticky(extraId, nextValue)
            setExtras(prev => prev.map(e => e.id === extraId ? { ...e, is_sticky: nextValue } : e))
            refreshProducts?.()
        })
    }

    async function deleteExtra(extraId: string, extraName: string) {
        if (!await confirm({ title: `Xóa tùy chọn "${extraName}"?`, danger: true, confirmLabel: 'Xóa' })) return
        await withSaving('Xóa tùy chọn', async () => {
            await deleteProductExtra(extraId)
            setExtras(prev => prev.filter(e => e.id !== extraId))
            refreshProducts?.()
        })
    }

    async function duplicateExtra(extraId: string, newName: string) {
        await withSaving('Nhân bản tùy chọn', async () => {
            await duplicateProductExtra(extraId, newName, addressId)
            refreshProducts?.()
        })
    }

    async function saveExtrasSortOrder(orderedIds: string[]) {
        await withSaving('Lưu thứ tự tùy chọn', async () => {
            await updateExtrasSortOrder(orderedIds)
            await refreshProducts?.()
        })
    }

    async function handleAddExtraIngredients(extraId: string, { key, unit, category }: CustomIngredient) {
        const present = (extraIngs[extraId] || []).some(ei => ei.ingredient === key)
        await withSaving('Thêm nguyên liệu vào tùy chọn', async () => {
            // Same guard as the base recipe: don't zero an impact/cost that already exists.
            if (!present) await upsertExtraIngredient(extraId, key, 0, unit)
            // A brand-new ingredient created here must exist in ingredient_costs (with its
            // category) too, else it won't show in /inventory or the chip list.
            if (!(key in ingredientCosts)) await upsertIngredientCost(key, 0, addressId, unit, { category })
            if (!present) {
                setExtraIngs(prev => ({
                    ...prev,
                    [extraId]: [...(prev[extraId] || []), { extra_id: extraId, ingredient: key, amount: 0, unit }],
                }))
            }
            refreshProducts?.()
        })
    }

    async function saveExtraAmount(extraId: string, ingredient: string, newAmount: number) {
        await withSaving('Lưu lượng nguyên liệu tùy chọn', async () => {
            await upsertExtraIngredient(extraId, ingredient, newAmount)
            setExtraIngs(prev => ({
                ...prev,
                [extraId]: (prev[extraId] || []).map(ei =>
                    ei.ingredient === ingredient ? { ...ei, amount: newAmount } : ei
                ),
            }))
        })
    }

    async function deleteExtraIng(extraId: string, ingredient: string) {
        if (!await confirm({ title: 'Xóa tác động nguyên liệu này?', danger: true, confirmLabel: 'Xóa' })) return
        await withSaving('Xóa nguyên liệu khỏi tùy chọn', async () => {
            await deleteExtraIngredient(extraId, ingredient)
            setExtraIngs(prev => ({
                ...prev,
                [extraId]: (prev[extraId] || []).filter(ei => ei.ingredient !== ingredient),
            }))
            refreshProducts?.()
        })
    }

    if (td.topping) {
        const topping = td.topping
        return (
            <div className="flex flex-col h-full max-w-lg mx-auto bg-bg relative">
                <Toast toast={toast} />
                <EditableEntityHeader
                    name={topping.name}
                    nameTransform={capitalizeWords}
                    canEdit={canEdit}
                    onBack={() => navigate(backUrl, { state: location.state })}
                    onSaveName={td.saveName}
                    price={topping.price}
                    priceLabel="Giá cộng thêm:"
                    onSavePrice={td.savePrice}
                    action={canEdit && (
                        <button onClick={td.deleteSelf} className={ICON_BTN_DANGER} title="Xoá topping">
                            <Trash2 size={20} strokeWidth={2.5} />
                        </button>
                    )}
                />
                <main className="flex-1 overflow-y-auto px-4 max-[329px]:px-2 py-4 space-y-3 bg-bg">
                    <ToppingSourceSection
                        source={td.source}
                        options={Object.keys(ingredientCosts).filter(k => k !== normalizeIngredientKey(topping.name)).sort((a, b) => sortIngredients(a, b, selectedAddress?.ingredient_sort_order))}
                        unitOf={(k) => getIngredientUnit(k, ingredientUnits?.[k], ingredientUnits)}
                        canEdit={canEdit}
                        onSave={td.saveSource}
                    />
                    {!td.source && <FastIngredientFill
                        entries={td.ings}
                        dbIngredients={dbIngredients}
                        getUnit={(k) => getIngredientUnit(k, ingredientUnits?.[k], ingredientUnits)}
                        categoryOf={categoryOf}
                        ingredientCosts={ingredientCosts}
                        canEdit={canEdit}
                        showCost
                        onSetAmount={td.setAmount}
                        onRemove={td.remove}
                        onAddCustom={td.addCustom}
                    />}
                    <ProductLinksSection links={td.links} products={products} canEdit={canEdit} saving={saving} onSave={td.saveLinks} />
                </main>
                {saving && (
                    <div className="fixed bottom-4 right-4 z-50 pointer-events-none">
                        <span className="text-text-secondary text-[11px] animate-pulse">Đang lưu...</span>
                    </div>
                )}
            </div>
        )
    }

    if (!product) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-bg px-6 gap-4">
                <span className="text-text-secondary text-[14px]">Không tìm thấy món này.</span>
                <button onClick={() => navigate(backUrl, { state: location.state })} className="text-primary font-bold text-[14px] underline">
                    ← Quay lại
                </button>
            </div>
        )
    }

    const extraHandlers: ExtraHandlers = {
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
        <div className="flex flex-col h-full max-w-lg mx-auto bg-bg relative">
            <Toast toast={toast} />

            {isBatch ? (
                // Tên thành phẩm = khóa nguyên liệu nên không đổi tên ở đây (đổi sẽ tách nó khỏi tồn kho/công thức món).
                <EditableEntityHeader name={product.name} canEdit={false} onBack={() => navigate(backUrl, { state: location.state })} onSaveName={() => { }}>
                    <div className="flex items-center justify-center gap-1.5 text-[12px] font-bold text-text-secondary">
                        <span>1 mẻ ra:</span>
                        <InlineEditor
                            value={product.batch_yield}
                            canEdit={canEdit}
                            onSave={saveBatchYield}
                            type="number"
                            renderDisplay={(v: number) => <span className="text-success font-bold">{v} {ingredientUnits?.[normalizeIngredientKey(product.name)] || ''}</span>}
                            inputWidthClassName="w-[72px]"
                        />
                    </div>
                </EditableEntityHeader>
            ) : <RecipeHeader
                product={product}
                canEdit={canEdit}
                onBack={() => navigate(backUrl, { state: location.state })}
                onSavePrice={saveProductPrice}
                onSaveName={saveProductName}
                countAsCup={product.count_as_cup !== false}
                onToggleCountAsCup={toggleCountAsCup}
                toggleDisabled={saving}
            />}

            <main className="flex-1 overflow-y-auto px-4 max-[329px]:px-2 py-4 space-y-3 bg-bg">
                <FastIngredientFill
                    entries={prodRecipes}
                    dbIngredients={dbIngredients}
                    getUnit={(k) => getIngredientUnit(k, ingredientUnits?.[k], ingredientUnits)}
                    categoryOf={categoryOf}
                    ingredientCosts={ingredientCosts}
                    canEdit={canEdit}
                    showCost
                    onSetAmount={setBaseAmount}
                    onRemove={removeBaseIngredient}
                    onAddCustom={handleAddBaseIngredients}
                    hint={isCafeDen && !recipeProgress.filledAmount}
                />


                {!isBatch && <ExtrasSection
                    extras={extras}
                    extraIngs={extraIngs}
                    ingredientUnits={ingredientUnits}
                    dbIngredients={dbIngredients}
                    canEdit={canEdit}
                    saving={saving}
                    onAddExtra={handleAddExtra}
                    onSaveSortOrder={saveExtrasSortOrder}
                    extraHandlers={extraHandlers}
                    categoryOf={categoryOf}
                    baseAmounts={baseAmounts}
                    hint={isCafeDen && recipeProgress.filledAmount && !recipeProgress.addedExtra}
                />}

                {canEdit && (
                    <div className="mt-4 pt-4 border-t border-border/40 flex justify-between">
                        <button
                            onClick={handleDeleteFromMenu}
                            className="text-danger hover:bg-danger/10 rounded-full px-3 py-1 text-[11px] font-medium transition-colors"
                        >
                            Xóa công thức
                        </button>
                        <button
                            onClick={() => setShowCopyFrom(true)}
                            className="text-primary hover:bg-primary/10 rounded-full px-3 py-1 text-[11px] font-medium transition-colors"
                        >
                            Sao chép công thức
                        </button>
                    </div>
                )}
            </main>

            {showCopyFrom && (
                <CopyRecipeModal
                    products={products.filter(p => p.id !== productId)}
                    recipesByProduct={recipesByProduct}
                    onPick={handleCopyFrom}
                    onClose={() => setShowCopyFrom(false)}
                />
            )}

            {saving && (
                <div className="fixed bottom-4 right-4 z-50 pointer-events-none">
                    <span className="text-text-secondary text-[11px] animate-pulse">Đang lưu...</span>
                </div>
            )}
        </div>
    )
}
