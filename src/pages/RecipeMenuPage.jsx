import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Plus, X, ArrowUpDown } from 'lucide-react'
import FabActionMenu from '../components/common/FabActionMenu'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { upsertProductPrice, insertProduct, updateProductSortOrder } from '../services/orderService'
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
    const { toast, showError } = useToast()

    const [newProductName, setNewProductName] = useState('')
    const [newProductPrice, setNewProductPrice] = useState('')
    const [saving, setSaving] = useState(false)
    const [isSorting, setIsSorting] = useState(false)
    const [sortedProducts, setSortedProducts] = useState([])
    const [selectedSortProductId, setSelectedSortProductId] = useState(null)
    const [showCreateModal, setShowCreateModal] = useState(false)

    const mainRef = useRef(null)

    // Fetch fresh data on mount to avoid showing stale localStorage cache
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
        } catch (err) {
            showError(err, 'Tạo món mới')
        } finally {
            setSaving(false)
        }
    }

    const enterSortMode = () => { setSortedProducts([...products]); setIsSorting(true); setSelectedSortProductId(null) }
    const cancelSortMode = () => { setIsSorting(false); setSortedProducts([]); setSelectedSortProductId(null) }

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
            setSelectedSortProductId(null)
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
                productCount={products.length}
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
                        selectedKey={selectedSortProductId}
                        onSelect={setSelectedSortProductId}
                        onMove={moveProduct}
                    />
                ) : (
                    <div className="grid grid-cols-2 gap-3">
                        {products.map(product => (
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
                                    { key: 'create', icon: <Plus size={14} />, label: 'Tạo món', onClick: () => setShowCreateModal(true) },
                                ]}
                            />
                        </div>
                    )}
                </div>
            )}

            {showCreateModal && (
                <div className="fixed inset-0 z-[100] flex items-end justify-center" onClick={() => !saving && setShowCreateModal(false)}>
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
                    <div
                        className="relative w-full max-w-lg bg-surface rounded-t-[24px] border-t border-border/60 shadow-2xl p-5 pb-8 flex flex-col gap-4 animate-slide-up"
                        onClick={e => e.stopPropagation()}
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
                    </div>
                </div>
            )}

            {saving && (
                <div className="fixed inset-0 z-50 bg-bg/60 flex items-center justify-center pointer-events-none">
                    <span className="text-text font-bold text-[14px] animate-pulse">Đang lưu...</span>
                </div>
            )}
        </div>
    )
}
