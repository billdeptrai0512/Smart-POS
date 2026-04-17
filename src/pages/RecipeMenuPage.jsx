import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { formatVND } from '../utils'
import {
    upsertProductPrice,
    insertProduct,
    updateProductSortOrder
} from '../services/orderService'
import { ingredientLabel, getIngredientUnit } from '../components/common/recipeUtils'
import { ArrowLeft, ArrowRight } from 'lucide-react'

export default function RecipeMenuPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const backTo = location.state?.from || '/history'
    const { products, recipes, ingredientCosts, refreshProducts, productExtras } = useProducts()
    const { selectedAddress } = useAddress()
    const { isManager, isAdmin } = useAuth()
    const canEdit = isManager || isAdmin

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
        const parsedPrice = parseInt(newProductPrice) ? parseInt(newProductPrice) * 1000 : 0
        try {
            const newProd = await insertProduct(
                newProductName.trim(),
                parsedPrice,
                selectedAddress?.id
            )
            if (newProd && selectedAddress?.id) {
                await upsertProductPrice(newProd.id, selectedAddress.id, parsedPrice)
            }
            refreshProducts?.()
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
                        onClick={() => navigate(backTo)}
                        className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none"
                    >
                        <ArrowLeft size={20} strokeWidth={2.5} />
                    </button>

                    <div className="flex flex-row gap-2 flex-1">
                        <div className="flex-1 bg-primary/5 border border-primary/10 shadow-sm rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center">
                            <span className="text-[12px] font-black text-primary uppercase line-clamp-1">Công thức</span>
                            <span className="text-[12px] font-bold text-primary/80 leading-none mt-1 tabular-nums">{products.length} món</span>
                        </div>
                    </div>
                    <button
                        onClick={() => navigate('/ingredients')}
                        className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none"
                    >
                        <ArrowRight size={20} strokeWidth={2.5} />
                    </button>
                </div>
            </header>

            {/* Product list */}
            <main className="flex-1 overflow-y-auto px-4 py-4 pb-48 space-y-3 bg-bg">

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
                                    onClick={() => navigate(`/recipes/${product.id}`, { state: location.state })}
                                    className={`bg-surface border ${ingredientCount === 0 ? 'border-danger/30 bg-danger/5' : 'border-border/60'} rounded-[1.5rem] p-4 flex flex-col justify-between gap-2 cursor-pointer transition-all shadow-sm hover:border-text/30 hover:shadow-md active:scale-[0.98]`}
                                >

                                    <div className="flex flex-col gap-1.5">
                                        <h3 className="font-black text-[15px] leading-tight text-text break-words line-clamp-2">{product.name}</h3>
                                        <div className="flex flex-col items-left gap-x-2 gap-y-1">
                                            {prodRecipes.length > 0 && (
                                                <div className="flex flex-col gap-0.5">
                                                    {prodRecipes.map(r => {
                                                        const u = getIngredientUnit(r.ingredient, r.unit)
                                                        const isSymbol = ['g', 'ml', 'l', 'kg', 'oz', 'mg'].includes(String(u).toLowerCase())
                                                        return (
                                                            <span key={r.ingredient} className="text-[12px] font-medium text-text-secondary">
                                                                • {ingredientLabel(r.ingredient)} {r.amount}{isSymbol ? u : ` ${u}`}
                                                            </span>
                                                        )
                                                    })}
                                                </div>
                                            )}
                                            {/* {extraCount > 0 && (
                                                <span className="text-[12px] font-medium text-text-secondary">• Tùy chọn: {extraCount}</span>
                                            )} */}
                                        </div>
                                        {/* Cost */}
                                        <div className="flex items-center gap-1.5 text-[12px] text-text-secondary mt-0.5">
                                            <span>Giá vốn: <span className="text-primary font-bold">{formatVND(productCost(product.id))}</span></span>
                                        </div>
                                    </div>

                                </div>
                            )
                        })}
                    </div>
                )}


            </main>

            {/* Footer */}
            {canEdit && (
                <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto pointer-events-none z-50">
                    {/* Floating sort button above footer */}
                    {!isSorting && (
                        <div className="flex justify-end px-4 mb-2 pointer-events-auto">
                            <button
                                onClick={enterSortMode}
                                className="bg-surface border border-border/60 rounded-[12px] px-4 py-2.5 flex items-center justify-center text-[13px] font-bold text-text-secondary hover:bg-surface-light active:scale-95 transition-all shadow-sm"
                            >
                                ↕ Sắp xếp
                            </button>
                        </div>
                    )}

                    {/* Footer Content */}
                    <div className="p-4 bg-surface border-t border-border/60 pointer-events-auto">
                        {isSorting ? (
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
                        ) : (
                            <div className="flex flex-col gap-3">
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        placeholder="Tên món mới..."
                                        value={newProductName}
                                        onChange={e => setNewProductName(e.target.value)}
                                        className="flex-1 min-w-0 bg-surface-light border border-border/60 rounded-[12px] px-3 py-2.5 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-primary/40 transition-colors"
                                    />
                                    <div className="relative shrink-0 flex items-center w-[125px] bg-surface-light border border-border/60 rounded-[12px] focus-within:border-primary/40 transition-colors overflow-hidden">
                                        <input
                                            type="number"
                                            placeholder="Giá bán..."
                                            value={newProductPrice}
                                            onChange={e => setNewProductPrice(e.target.value)}
                                            className="w-full bg-transparent px-3 py-2.5 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none z-10 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleCreateProduct()
                                            }}
                                        />
                                        {newProductPrice && (
                                            <div className="absolute inset-0 pointer-events-none px-3 py-2.5 flex items-center space-x-0 whitespace-pre z-0">
                                                <span className="text-[14px] font-medium text-transparent">{newProductPrice}</span>
                                                <span className="text-[14px] font-medium text-text-secondary/60">.000đ</span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <button
                                    onClick={handleCreateProduct}
                                    disabled={!newProductName.trim() || !newProductPrice || isNaN(newProductPrice) || Number(newProductPrice) <= 0 || saving}
                                    className="w-full py-3 rounded-[12px] bg-primary text-bg text-[14px] font-black hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed uppercase"
                                >
                                    {saving ? 'Đang...' : 'Tạo'}
                                </button>
                            </div>
                        )}
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
