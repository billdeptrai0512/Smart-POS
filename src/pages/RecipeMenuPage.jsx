import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Plus, X, ArrowUpDown, Minus } from 'lucide-react'
import FabActionMenu from '../components/common/FabActionMenu'
import { BottomSheet } from '../components/common/ModalShell'
import MenuDivider from '../components/common/MenuDivider'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { upsertProductPrice, insertProduct, updateProductSortOrder, updateProductName, removeProductFromAddress } from '../services/orderService'
import { parseVNDInput } from '../utils'
import { useToast } from '../hooks/useToast'
import Toast from '../components/POSPage/Toast'
import SortableList from '../components/common/SortableList'
import RecipeMenuHeader from '../components/RecipeMenuPage/RecipeMenuHeader'
import ProductCard from '../components/RecipeMenuPage/ProductCard'
import CreateProductForm from '../components/RecipeMenuPage/CreateProductForm'
import { goToMenuStep } from '../utils/menuSequence'

// Module-level scroll cache. Set when user clicks a product card to drill into
// /recipes/:productId; consumed once on next mount of /recipes (back nav).
// Cleared after restore so a fresh visit from another route starts at top.
let savedScroll = null

export default function RecipeMenuPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const backTo = location.state?.from || '/history'
    const { products, recipes, ingredientCosts, ingredientUnits, refreshProducts } = useProducts()
    const { selectedAddress } = useAddress()
    const { isManager, isAdmin } = useAuth()
    const canEdit = isManager || isAdmin
    const { toast, showToast, showError } = useToast()

    const [newProductName, setNewProductName] = useState('')
    const [newProductPrice, setNewProductPrice] = useState('')
    const [saving, setSaving] = useState(false)
    const [isSorting, setIsSorting] = useState(false)
    const [sortedProducts, setSortedProducts] = useState([])
    const [showCreateModal, setShowCreateModal] = useState(false)
    // {mode:'create'} | {mode:'edit', id} — modal tạo/sửa mục (divider phân nhóm menu)
    const [dividerModal, setDividerModal] = useState(null)
    const [dividerName, setDividerName] = useState('')

    const mainRef = useRef(null)

    // Fetch fresh data on mount to avoid showing stale localStorage cache.
    // ponytail: mount-only — refreshProducts already refetches on address change via
    // its own effect in ProductContext; adding it here would double-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { refreshProducts?.() }, [])

    // Restore scroll on back nav from /recipes/:productId; clear cache after use
    useEffect(() => {
        if (savedScroll !== null && mainRef.current) {
            mainRef.current.scrollTop = savedScroll
            savedScroll = null
        }
    }, [])

    // PERF: index recipes by product_id ONCE.
    // Was: recipes.filter(...) called twice per product per render — O(N×M).
    // Now: single pass to build the Map, then O(1) lookups.
    const recipesByProduct = useMemo(() => {
        const map = new Map()
        for (const r of recipes || []) {
            const list = map.get(r.product_id)
            if (list) list.push(r)
            else map.set(r.product_id, [r])
        }
        return map
    }, [recipes])

    // PERF: precompute cost per product. Was: productCost() recomputed per card per render.
    const costByProduct = useMemo(() => {
        const map = new Map()
        for (const [pid, list] of recipesByProduct) {
            let sum = 0
            for (const r of list) sum += r.amount * (ingredientCosts[r.ingredient] || 0)
            map.set(pid, sum)
        }
        return map
    }, [recipesByProduct, ingredientCosts])

    async function handleCreateProduct() {
        if (!newProductName.trim()) return
        setSaving(true)
        const parsedPrice = parseVNDInput(newProductPrice)
        try {
            const newProd = await insertProduct(newProductName.trim(), parsedPrice, selectedAddress?.id)
            if (newProd && selectedAddress?.id) {
                await upsertProductPrice(newProd.id, selectedAddress.id, parsedPrice)
            }
            refreshProducts?.()
            setNewProductName('')
            setNewProductPrice('')
            setShowCreateModal(false)
            showToast('Đã tạo món mới', 'success')
        } catch (err) {
            showError(err, 'Tạo món mới')
        } finally {
            setSaving(false)
        }
    }

    async function saveDivider() {
        const name = dividerName.trim()
        if (!name) return
        setSaving(true)
        try {
            if (dividerModal.mode === 'create') await insertProduct(name, 0, selectedAddress?.id, true)
            else await updateProductName(dividerModal.id, name)
            refreshProducts?.()
            setDividerModal(null)
            showToast(dividerModal.mode === 'create' ? 'Đã tạo mục' : 'Đã đổi tên mục', 'success')
        } catch (err) {
            showError(err, 'Lưu mục')
        } finally {
            setSaving(false)
        }
    }

    async function deleteDivider() {
        setSaving(true)
        try {
            await removeProductFromAddress(dividerModal.id, selectedAddress?.id)
            refreshProducts?.()
            setDividerModal(null)
            showToast('Đã xóa mục', 'success')
        } catch (err) {
            showError(err, 'Xóa mục')
        } finally {
            setSaving(false)
        }
    }

    const enterSortMode = () => { setSortedProducts([...products]); setIsSorting(true) }
    const cancelSortMode = () => { setIsSorting(false); setSortedProducts([]) }

    const moveProduct = (from, to) => {
        if (to < 0 || to >= sortedProducts.length) return
        const updated = [...sortedProducts]
        const [moved] = updated.splice(from, 1)
        updated.splice(to, 0, moved)
        setSortedProducts(updated)
    }

    async function saveSortOrder() {
        const addrId = selectedAddress?.id || null
        if (!addrId && !isAdmin) return // Only Admin can sort default menu
        setSaving(true)
        try {
            await updateProductSortOrder(addrId, sortedProducts.map(p => p.id))
            refreshProducts?.()
            setIsSorting(false)
            setSortedProducts([])
        } catch (err) {
            showError(err, 'Lưu thứ tự món')
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative">
            <Toast toast={toast} />

            <RecipeMenuHeader
                productCount={products.filter(p => !p.is_divider).length}
                onBack={() => goToMenuStep('recipes', -1, { navigate, backTo, wizard: location.state?.wizard })}
                onForward={() => goToMenuStep('recipes', +1, { navigate, backTo, wizard: location.state?.wizard })}
                activeTab="recipes"
                onTabSelect={(key) => {
                    if (key === 'main' || key === 'packaging') {
                        navigate('/ingredients', { state: { ...location.state, viewMode: key }, replace: true })
                    }
                }}
            />

            <main ref={mainRef} className="flex-1 overflow-y-auto px-4 py-4 pb-48 space-y-3 bg-bg">
                {isSorting ? (
                    <SortableList
                        items={sortedProducts}
                        getKey={p => p.id}
                        getLabel={p => p.name}
                        isDivider={p => p.is_divider}
                        onMove={moveProduct}
                    />
                ) : (
                    <div className="grid grid-cols-2 gap-3">
                        {products.map(product => product.is_divider ? (
                            <MenuDivider
                                key={product.id}
                                name={product.name}
                                onClick={canEdit ? () => { setDividerName(product.name); setDividerModal({ mode: 'edit', id: product.id }) } : undefined}
                            />
                        ) : (
                            <ProductCard
                                key={product.id}
                                product={product}
                                prodRecipes={recipesByProduct.get(product.id) || []}
                                cost={costByProduct.get(product.id) || 0}
                                ingredientUnits={ingredientUnits}
                                onClick={() => {
                                    savedScroll = mainRef.current?.scrollTop ?? 0
                                    navigate(`/recipes/${product.id}`, { state: location.state })
                                }}
                            />
                        ))}
                    </div>
                )}
            </main>

            {canEdit && (
                <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto pointer-events-none z-50">
                    {isSorting ? (
                        <div className="p-4 bg-surface border-t border-border/60 pointer-events-auto">
                            <div className="flex gap-2">
                                <button
                                    onClick={cancelSortMode}
                                    className="flex-1 py-3 rounded-[12px] bg-surface-light border border-border/60 text-text-secondary font-black hover:bg-border/40 active:scale-95 transition-all text-[14px]"
                                >
                                    Hủy
                                </button>
                                <button
                                    onClick={saveSortOrder}
                                    disabled={saving}
                                    className="flex-1 py-3 rounded-[12px] bg-primary text-bg font-black hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 text-[14px]"
                                >
                                    {saving ? '⏳ Đang lưu...' : 'Lưu sắp xếp'}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex justify-end px-4 pb-[max(env(safe-area-inset-bottom),16px)] pointer-events-auto">
                            <FabActionMenu
                                items={[
                                    { key: 'sort', icon: <ArrowUpDown size={14} />, label: 'Sắp xếp', onClick: enterSortMode },
                                    { key: 'divider', icon: <Minus size={14} />, label: 'Tạo mục', onClick: () => { setDividerName(''); setDividerModal({ mode: 'create' }) } },
                                    { key: 'create', icon: <Plus size={14} />, label: 'Tạo món', onClick: () => setShowCreateModal(true) },
                                ]}
                            />
                        </div>
                    )}
                </div>
            )}

            {showCreateModal && (
                <BottomSheet
                    onClose={() => !saving && setShowCreateModal(false)}
                    panelClassName="w-full max-w-lg bg-surface rounded-t-[24px] border-t border-border/60 shadow-2xl p-5 pb-8 flex flex-col gap-4 animate-slide-up"
                >
                        <div className="flex items-center justify-between">
                            <span className="text-[16px] font-black text-text">Tạo món mới</span>
                            <button
                                onClick={() => setShowCreateModal(false)}
                                disabled={saving}
                                className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-light border border-border/60 text-text-secondary hover:text-text transition-all disabled:opacity-50"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <CreateProductForm
                            name={newProductName}
                            price={newProductPrice}
                            saving={saving}
                            onNameChange={setNewProductName}
                            onPriceChange={setNewProductPrice}
                            onSubmit={handleCreateProduct}
                        />
                </BottomSheet>
            )}

            {dividerModal && (
                <BottomSheet
                    onClose={() => !saving && setDividerModal(null)}
                    panelClassName="w-full max-w-lg bg-surface rounded-t-[24px] border-t border-border/60 shadow-2xl p-5 pb-8 flex flex-col gap-4 animate-slide-up"
                >
                        <div className="flex items-center justify-between">
                            <span className="text-[16px] font-black text-text">{dividerModal.mode === 'create' ? 'Tạo mục' : 'Sửa mục'}</span>
                            <button
                                onClick={() => setDividerModal(null)}
                                disabled={saving}
                                className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-light border border-border/60 text-text-secondary hover:text-text transition-all disabled:opacity-50"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <p className="text-[13px] text-text-secondary -mt-2">Mục là dòng tiêu đề ——— tên ——— để phân nhóm menu trên trang bán hàng.</p>
                        <input
                            autoFocus
                            value={dividerName}
                            onChange={e => setDividerName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveDivider() }}
                            disabled={saving}
                            placeholder="Tên mục (vd: Cà phê, Trà, Topping)"
                            className="w-full px-4 py-3 rounded-[12px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-50"
                        />
                        <div className="flex gap-2">
                            {dividerModal.mode === 'edit' && (
                                <button
                                    onClick={deleteDivider}
                                    disabled={saving}
                                    className="flex-1 py-3 rounded-[12px] bg-danger-soft text-danger font-black text-[14px] active:scale-95 transition-all disabled:opacity-50"
                                >
                                    Xóa mục
                                </button>
                            )}
                            <button
                                onClick={saveDivider}
                                disabled={saving || !dividerName.trim()}
                                className="flex-1 py-3 rounded-[12px] bg-primary text-bg font-black text-[14px] hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50"
                            >
                                {dividerModal.mode === 'create' ? 'Tạo mục' : 'Lưu'}
                            </button>
                        </div>
                </BottomSheet>
            )}

            {saving && (
                <div className="fixed inset-0 z-50 bg-bg/60 flex items-center justify-center pointer-events-none">
                    <span className="text-text font-bold text-[14px] animate-pulse">Đang lưu...</span>
                </div>
            )}
        </div>
    )
}
