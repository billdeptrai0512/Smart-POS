import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { formatVND } from '../utils'
import ProductCreator from '../components/recipe/ProductCreator'
import {
    upsertProductPrice,
    insertProduct,
    updateProductSortOrder
} from '../services/orderService'

export default function RecipeMenuPage() {
    const navigate = useNavigate()
    const { products, recipes, ingredientCosts, refreshProducts, productExtras } = useProducts()
    const { selectedAddress } = useAddress()

    const [addingProduct, setAddingProduct] = useState(false)
    const [newProductName, setNewProductName] = useState('')
    const [newProductPrice, setNewProductPrice] = useState('')
    const [saving, setSaving] = useState(false)

    // Sort mode state
    const [isSorting, setIsSorting] = useState(false)
    const [sortedProducts, setSortedProducts] = useState([])
    const [selectedSortProductId, setSelectedSortProductId] = useState(null)

    function productCost(productId) {
        const prodRecipes = recipes.filter(r => r.product_id === productId)
        return prodRecipes.reduce((sum, r) => {
            return sum + r.amount * (ingredientCosts[r.ingredient] || 0)
        }, 0)
    }

    async function handleCreateProduct() {
        if (!newProductName.trim()) return
        setSaving(true)
        try {
            const newProd = await insertProduct(
                newProductName.trim(),
                parseInt(newProductPrice) || 0,
                selectedAddress?.id
            )
            if (newProd && selectedAddress?.id) {
                await upsertProductPrice(newProd.id, selectedAddress.id, parseInt(newProductPrice) || 0)
            }
            refreshProducts?.()
            setAddingProduct(false)
            setNewProductName('')
            setNewProductPrice('')
        } catch (error) {
            console.error('Create product error:', error)
        } finally {
            setSaving(false)
        }
    }

    // Sort mode handlers
    function enterSortMode() {
        setSortedProducts([...products])
        setIsSorting(true)
        setSelectedSortProductId(null)
    }

    function cancelSortMode() {
        setIsSorting(false)
        setSortedProducts([])
        setSelectedSortProductId(null)
    }

    function moveProduct(fromIndex, toIndex) {
        if (toIndex < 0 || toIndex >= sortedProducts.length) return
        const updated = [...sortedProducts]
        const [moved] = updated.splice(fromIndex, 1)
        updated.splice(toIndex, 0, moved)
        setSortedProducts(updated)
    }

    async function saveSortOrder() {
        if (!selectedAddress?.id) return
        setSaving(true)
        try {
            await updateProductSortOrder(
                selectedAddress.id,
                sortedProducts.map(p => p.id)
            )
            refreshProducts?.()
            setIsSorting(false)
            setSortedProducts([])
            setSelectedSortProductId(null)
        } catch (err) {
            console.error('Sort order error:', err)
        } finally {
            setSaving(false)
        }
    }

    const displayProducts = isSorting ? sortedProducts : products

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative">
            {/* Header */}
            <header className="shrink-0 pt-6 pb-4 bg-surface border-b border-border/60 shadow-sm relative z-20 flex flex-col px-4 gap-3">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => navigate('/expenses')}
                        className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none"
                    >
                        <span className="text-xl leading-none -mt-[3px] font-bold">←</span>
                    </button>

                    <div className="flex flex-row gap-2 flex-1">
                        <div className="flex-1 bg-primary/5 border border-primary/10 shadow-sm rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center">
                            <span className="text-[12px] font-black text-primary uppercase line-clamp-1">Công thức</span>
                            <span className="text-[12px] font-bold text-primary/80 leading-none mt-1 tabular-nums">{products.length} món</span>
                        </div>
                    </div>
                </div>
            </header>

            {/* Product list */}
            <main className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-bg">

                {/* Action buttons: Thêm món + Sắp xếp */}
                {!isSorting && (
                    <div className={addingProduct ? "flex flex-col gap-3" : "grid grid-cols-2 gap-3"}>
                        <ProductCreator
                            addingProduct={addingProduct}
                            setAddingProduct={setAddingProduct}
                            newProductName={newProductName}
                            setNewProductName={setNewProductName}
                            newProductPrice={newProductPrice}
                            setNewProductPrice={setNewProductPrice}
                            handleCreateProduct={handleCreateProduct}
                        />
                        {!addingProduct && (
                            <button
                                onClick={enterSortMode}
                                className="w-full h-full bg-surface border border-border/60 rounded-[1.5rem] p-4 flex flex-col items-center justify-center min-h-[20px] text-[14px] font-bold text-text-secondary hover:bg-surface-light active:scale-[0.98] transition-all shadow-sm shrink-0"
                            >
                                ↕ Sắp xếp
                            </button>
                        )}
                    </div>
                )}

                {/* Sort mode toolbar */}
                {isSorting && (
                    <div className="flex justify-end items-center gap-1 bg-primary/5 border border-primary/20 rounded-[14px] px-4 py-3">
                        <button
                            onClick={cancelSortMode}
                            className="text-[12px] font-bold text-text-secondary px-3 py-1.5 rounded-lg hover:bg-surface-light transition-colors"
                        >
                            Hủy
                        </button>
                        <button
                            onClick={saveSortOrder}
                            disabled={saving}
                            className="text-[12px] font-bold text-bg bg-primary px-4 py-1.5 rounded-lg hover:bg-primary/90 active:scale-[0.98] transition-all disabled:opacity-50"
                        >
                            {saving ? '⏳' : 'Lưu'}
                        </button>
                    </div>
                )}

                {/* Product grid / sort list */}
                {isSorting ? (
                    // Sort mode: single column with move buttons
                    <div className="space-y-1.5">
                        {displayProducts.map((product, index) => {
                            const isSelected = selectedSortProductId === product.id
                            return (
                                <div
                                    key={product.id}
                                    onClick={() => setSelectedSortProductId(product.id)}
                                    className={`bg-surface border rounded-[14px] px-4 py-3 flex items-center gap-3 cursor-pointer transition-colors ${isSelected ? 'border-primary ring-1 ring-primary' : 'border-border/60 hover:bg-surface-light'}`}
                                >
                                    <span className="text-text-dim text-[13px] font-bold w-6 text-center shrink-0">{index + 1}</span>
                                    <span className="flex-1 text-[14px] font-bold text-text truncate">{product.name}</span>
                                    {isSelected && (
                                        <div className="flex flex-row gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                                            <button
                                                onClick={() => moveProduct(index, index - 1)}
                                                disabled={index === 0}
                                                className="w-10 h-8 flex items-center justify-center rounded-lg bg-surface-light border border-border/40 text-text-secondary text-[14px] hover:bg-border/40 active:scale-95 transition-all disabled:opacity-20 disabled:pointer-events-none"
                                            >
                                                ▲
                                            </button>
                                            <button
                                                onClick={() => moveProduct(index, index + 1)}
                                                disabled={index === sortedProducts.length - 1}
                                                className="w-10 h-8 flex items-center justify-center rounded-lg bg-surface-light border border-border/40 text-text-secondary text-[14px] hover:bg-border/40 active:scale-95 transition-all disabled:opacity-20 disabled:pointer-events-none"
                                            >
                                                ▼
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                ) : (
                    // Normal mode: 2-column grid
                    <div className="grid grid-cols-2 gap-3">
                        {displayProducts.map(product => {
                            const prodRecipes = recipes.filter(r => r.product_id === product.id)
                            const ingredientCount = prodRecipes.length
                            const extraCount = productExtras?.[product.id]?.length || 0

                            return (
                                <div
                                    key={product.id}
                                    onClick={() => navigate(`/recipes/${product.id}`)}
                                    className={`bg-surface border ${ingredientCount === 0 ? 'border-danger/30 bg-danger/5' : 'border-border/60'} rounded-[1.5rem] p-4 flex flex-col justify-between gap-2 cursor-pointer transition-all shadow-sm hover:border-text/30 hover:shadow-md active:scale-[0.98]`}
                                >

                                    <div className="flex flex-col gap-1.5">
                                        <h3 className="font-black text-[15px] leading-tight text-text break-words line-clamp-2">{product.name}</h3>
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                            {ingredientCount > 0 ? (
                                                <span className="text-[12px] font-medium text-text-secondary">có {ingredientCount} nguyên liệu</span>
                                            ) : (
                                                null
                                            )}
                                            {extraCount > 0 && (
                                                <span className="text-[12px] font-medium text-text-secondary">và {extraCount} tùy chọn</span>
                                            )}
                                        </div>
                                    </div>

                                </div>
                            )
                        })}
                    </div>
                )}


            </main>

            {saving && (
                <div className="fixed inset-0 z-50 bg-bg/60 flex items-center justify-center pointer-events-none">
                    <span className="text-text font-bold text-[14px] animate-pulse">Đang lưu...</span>
                </div>
            )}
        </div>
    )
}
