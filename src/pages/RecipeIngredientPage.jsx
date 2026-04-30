import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useProducts } from '../contexts/ProductContext'
import { useAuth } from '../contexts/AuthContext'
import { useAddress } from '../contexts/AddressContext'
import { formatVND } from '../utils'
import {
    upsertRecipe,
    deleteRecipeRow,
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
    deleteExtraIngredient
} from '../services/orderService'
import { sortIngredients, ingredientLabel, getIngredientUnit } from '../components/common/recipeUtils'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { useToast } from '../hooks/useToast'
import Toast from '../components/POSPage/Toast'

export default function RecipeIngredientPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const { productId } = useParams()
    const { products, recipes: allRecipes, ingredientCosts: contextCosts, ingredientUnits: contextUnits, productExtras: contextExtras, extraIngredients: contextExtraIngs, refreshProducts } = useProducts()
    const { selectedAddress } = useAddress()
    const { isManager, isAdmin } = useAuth()
    const { toast, showError } = useToast()
    const canEdit = isManager || isAdmin

    const [ingredientCosts, setIngredientCosts] = useState(contextCosts || {})
    const [ingredientUnits, setIngredientUnits] = useState(contextUnits || {})
    const [recipes, setRecipes] = useState(allRecipes || [])
    const [editingAmount, setEditingAmount] = useState(null)
    const [editingProductPrice, setEditingProductPrice] = useState(null)
    const [saving, setSaving] = useState(false)
    const [addingIngredient, setAddingIngredient] = useState(false)
    const [selectedIngredients, setSelectedIngredients] = useState(new Set())
    const [customIngredientName, setCustomIngredientName] = useState('')
    const [customIngredientUnit, setCustomIngredientUnit] = useState('')

    // Extras state
    const [extras, setExtras] = useState([])
    const [addingExtra, setAddingExtra] = useState(false)
    const [newExtraName, setNewExtraName] = useState('')
    const [newExtraPrice, setNewExtraPrice] = useState('')
    const [editingExtraPrice, setEditingExtraPrice] = useState(null)
    const [editingExtraName, setEditingExtraName] = useState(null)
    const [duplicatingExtra, setDuplicatingExtra] = useState(null)
    const [sortingExtras, setSortingExtras] = useState(false)
    const [sortedExtras, setSortedExtras] = useState([])

    // Extra Ingredients state
    const [extraIngs, setExtraIngs] = useState(contextExtraIngs || {})
    const [addingExtraIng, setAddingExtraIng] = useState(null)
    const [selectedExtraIngs, setSelectedExtraIngs] = useState(new Set())
    const [customExtraIngName, setCustomExtraIngName] = useState('')
    const [customExtraIngUnit, setCustomExtraIngUnit] = useState('')
    const [editingExtraAmount, setEditingExtraAmount] = useState(null)

    const product = useMemo(() => products.find(p => p.id === productId), [products, productId])

    // Sync from context when it updates
    useEffect(() => { setRecipes(allRecipes) }, [allRecipes])
    useEffect(() => { setIngredientCosts(contextCosts) }, [contextCosts])
    useEffect(() => { setIngredientUnits(contextUnits || {}) }, [contextUnits])
    useEffect(() => { setExtras(contextExtras?.[productId] || []) }, [contextExtras, productId])
    useEffect(() => { setExtraIngs(contextExtraIngs || {}) }, [contextExtraIngs])


    const prodRecipes = useMemo(
        () => recipes.filter(r => r.product_id === productId).sort((a, b) => sortIngredients(a.ingredient, b.ingredient, selectedAddress?.ingredient_sort_order)),
        [recipes, productId, selectedAddress?.ingredient_sort_order]
    )

    const cost = useMemo(
        () => prodRecipes.reduce((sum, r) => sum + r.amount * (ingredientCosts[r.ingredient] || 0), 0),
        [prodRecipes, ingredientCosts]
    )

    const dbIngredients = useMemo(() => Object.keys(ingredientCosts).sort((a, b) => sortIngredients(a, b, selectedAddress?.ingredient_sort_order)), [ingredientCosts, selectedAddress?.ingredient_sort_order])
    const baseIngredients = prodRecipes.map(r => r.ingredient)
    const availableBaseIngredients = dbIngredients.filter(i => !baseIngredients.includes(i))


    async function saveAmount(ingredient, newAmount) {
        setSaving(true)
        try {
            await upsertRecipe(productId, ingredient, newAmount, selectedAddress?.id)
            setRecipes(prev => prev.map(r =>
                r.product_id === productId && r.ingredient === ingredient
                    ? { ...r, amount: newAmount }
                    : r
            ))
        } catch (err) {
            showError(err, 'Lưu lượng nguyên liệu')
        } finally {
            setSaving(false)
            setEditingAmount(prev => prev?.ingredient === ingredient ? null : prev)
        }
    }

    async function saveProductPrice(newPrice) {
        if (!selectedAddress?.id) return
        setSaving(true)
        try {
            await upsertProductPrice(productId, selectedAddress.id, newPrice)
            refreshProducts?.()
        } catch (err) {
            showError(err, 'Lưu giá bán sản phẩm')
        } finally {
            setSaving(false)
            setEditingProductPrice(null)
        }
    }

    async function toggleCountAsCup() {
        const next = product?.count_as_cup === false
        setSaving(true)
        try {
            await updateProductCountAsCup(productId, next)
            refreshProducts?.()
        } catch (err) {
            showError(err, 'Cập nhật cờ đếm ly')
        } finally {
            setSaving(false)
        }
    }

    async function handleDeleteIngredient(ingredient) {
        if (!window.confirm(`Xóa ${ingredientLabel(ingredient)} khỏi công thức?`)) return
        setSaving(true)
        try {
            await deleteRecipeRow(productId, ingredient, selectedAddress?.id)
            setRecipes(prev => prev.filter(r => !(r.product_id === productId && r.ingredient === ingredient)))
        } catch (err) {
            showError(err, 'Xóa nguyên liệu khỏi công thức')
        } finally {
            setSaving(false)
        }
    }

    function toggleIngredient(ing, setFn) {
        setFn(prev => {
            const next = new Set(prev)
            if (next.has(ing)) next.delete(ing)
            else next.add(ing)
            return next
        })
    }



    async function handleAddMultipleIngredients() {
        const toAdd = [...selectedIngredients].map(ing => ({ key: ing, unit: null }))
        if (customIngredientName.trim()) {
            const key = customIngredientName.trim().toLowerCase().replace(/\s+/g, '_')
            const unit = customIngredientUnit || 'đv'
            if (!toAdd.find(i => i.key === key)) toAdd.push({ key, unit })
        }
        if (toAdd.length === 0) return
        setSaving(true)
        try {
            for (const { key, unit } of toAdd) {
                await upsertRecipe(productId, key, 0, selectedAddress?.id, unit)
            }
            setRecipes(prev => [
                ...prev,
                ...toAdd.map(({ key, unit }) => ({ product_id: productId, ingredient: key, amount: 0, unit: unit || getIngredientUnit(key) }))
            ])
            setAddingIngredient(false)
            setSelectedIngredients(new Set())
            setCustomIngredientName('')
            setCustomIngredientUnit('')
        } catch (err) {
            showError(err, 'Thêm nguyên liệu vào công thức')
        } finally {
            setSaving(false)
        }
    }

    // ---- Extras handlers ----
    async function handleAddExtra() {
        if (!newExtraName.trim()) return
        setSaving(true)
        try {
            const parsedPrice = parseInt(newExtraPrice)
            const newExtra = await insertProductExtra(
                productId,
                newExtraName.trim(),
                Number.isFinite(parsedPrice) ? parsedPrice : 0,
                selectedAddress?.id
            )
            setExtras(prev => [...prev, { id: newExtra.id, name: newExtra.name, price: newExtra.price }])
            setAddingExtra(false)
            setNewExtraName('')
            setNewExtraPrice('')
        } catch (err) {
            showError(err, 'Thêm tùy chọn')
        } finally {
            setSaving(false)
        }
    }

    async function saveExtraName(extraId, newName) {
        const trimmed = newName.trim()
        if (!trimmed) { setEditingExtraName(null); return }
        setSaving(true)
        try {
            await updateProductExtraName(extraId, trimmed)
            setExtras(prev => prev.map(e => e.id === extraId ? { ...e, name: trimmed } : e))
        } catch (err) {
            showError(err, 'Lưu tên tùy chọn')
        } finally {
            setSaving(false)
            setEditingExtraName(prev => prev?.extraId === extraId ? null : prev)
        }
    }

    async function saveExtraPrice(extraId, newPrice) {
        setSaving(true)
        try {
            await updateProductExtraPrice(extraId, newPrice)
            setExtras(prev => prev.map(e => e.id === extraId ? { ...e, price: newPrice } : e))
        } catch (err) {
            showError(err, 'Lưu giá tùy chọn')
        } finally {
            setSaving(false)
            setEditingExtraPrice(prev => prev?.extraId === extraId ? null : prev)
        }
    }

    async function handleToggleSticky(extraId, currentValue) {
        try {
            await updateProductExtraSticky(extraId, !currentValue)
            setExtras(prev => prev.map(e => e.id === extraId ? { ...e, is_sticky: !currentValue } : e))
        } catch (err) {
            showError(err, 'Cập nhật sticky')
        }
    }

    async function handleDeleteExtra(extraId, extraName) {
        if (!window.confirm(`Xóa tùy chọn "${extraName}"?`)) return
        setSaving(true)
        try {
            await deleteProductExtra(extraId)
            setExtras(prev => prev.filter(e => e.id !== extraId))
        } catch (err) {
            showError(err, 'Xóa tùy chọn')
        } finally {
            setSaving(false)
        }
    }

    async function handleDuplicateExtra(extraId, newName) {
        if (!newName.trim()) return
        setSaving(true)
        try {
            await duplicateProductExtra(extraId, newName.trim(), selectedAddress?.id)
            setDuplicatingExtra(null)
            refreshProducts?.()
        } catch (err) {
            showError(err, 'Nhân bản tùy chọn')
        } finally {
            setSaving(false)
        }
    }

    function moveExtra(from, to) {
        if (to < 0 || to >= sortedExtras.length) return
        const next = [...sortedExtras]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        setSortedExtras(next)
    }

    async function saveExtrasSortOrder() {
        setSaving(true)
        try {
            await updateExtrasSortOrder(sortedExtras.map(e => e.id))
            await refreshProducts?.()
            setSortingExtras(false)
        } catch (err) {
            showError(err, 'Lưu thứ tự tùy chọn')
        } finally {
            setSaving(false)
        }
    }

    async function handleAddMultipleExtraIngredients(extraId) {
        const toAdd = [...selectedExtraIngs].map(ing => ({ key: ing, unit: null }))
        if (customExtraIngName.trim()) {
            const key = customExtraIngName.trim().toLowerCase().replace(/\s+/g, '_')
            const unit = customExtraIngUnit || 'đv'
            if (!toAdd.find(i => i.key === key)) toAdd.push({ key, unit })
        }
        if (toAdd.length === 0) return
        setSaving(true)
        try {
            for (const { key, unit } of toAdd) {
                await upsertExtraIngredient(extraId, key, 0, unit)
            }
            setExtraIngs(prev => ({
                ...prev,
                [extraId]: [
                    ...(prev[extraId] || []),
                    ...toAdd.map(({ key, unit }) => ({ extra_id: extraId, ingredient: key, amount: 0, unit: unit || getIngredientUnit(key) }))
                ]
            }))
            setAddingExtraIng(null)
            setSelectedExtraIngs(new Set())
            setCustomExtraIngName('')
            setCustomExtraIngUnit('')
        } catch (err) {
            showError(err, 'Thêm nguyên liệu vào tùy chọn')
        } finally {
            setSaving(false)
        }
    }

    async function saveExtraAmount(extraId, ingredient, newAmount) {
        setSaving(true)
        try {
            await upsertExtraIngredient(extraId, ingredient, newAmount)
            setExtraIngs(prev => ({
                ...prev,
                [extraId]: (prev[extraId] || []).map(ei =>
                    ei.ingredient === ingredient ? { ...ei, amount: newAmount } : ei
                )
            }))
        } catch (err) {
            showError(err, 'Lưu lượng nguyên liệu tùy chọn')
        } finally {
            setSaving(false)
            setEditingExtraAmount(prev => prev?.extraId === extraId && prev?.ingredient === ingredient ? null : prev)
        }
    }

    async function handleDeleteExtraIngredient(extraId, ingredient) {
        if (!window.confirm(`Xóa tác động nguyên liệu này?`)) return
        setSaving(true)
        try {
            await deleteExtraIngredient(extraId, ingredient)
            setExtraIngs(prev => ({
                ...prev,
                [extraId]: (prev[extraId] || []).filter(ei => ei.ingredient !== ingredient)
            }))
        } catch (err) {
            showError(err, 'Xóa nguyên liệu khỏi tùy chọn')
        } finally {
            setSaving(false)
        }
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

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative">
            <Toast toast={toast} />
            {/* Header */}
            <header className="shrink-0 pt-6 pb-4 bg-surface border-b border-border/60 shadow-sm relative z-20 flex flex-col px-4 gap-3">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => navigate('/recipes', { state: location.state })}
                        className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none shrink-0"
                        title="Trở về"
                    >
                        <ArrowLeft size={20} strokeWidth={2.5} />
                    </button>

                    <div className="flex flex-row gap-2 flex-1 min-w-0">
                        <div className="flex-1 bg-primary/5 border border-primary/10 shadow-sm rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center min-w-0">
                            <span className="text-[13px] font-black text-primary uppercase line-clamp-1 break-words w-full px-2" title={product.name}>{product.name}</span>
                            <div className="flex items-center justify-center gap-1.5 text-[12px] font-bold text-text-secondary leading-none mt-1 w-full">
                                <span>Giá bán:</span>
                                {editingProductPrice ? (
                                    <span className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                        <input
                                            type="number"
                                            autoFocus
                                            className="w-[72px] bg-bg border border-primary/60 rounded-lg px-2 py-0.5 text-[12px] text-text text-right focus:outline-none focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            value={editingProductPrice.value}
                                            onChange={e => setEditingProductPrice(prev => ({ ...prev, value: e.target.value }))}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') saveProductPrice(parseInt(editingProductPrice.value) || 0)
                                                if (e.key === 'Escape') setEditingProductPrice(null)
                                            }}
                                            onBlur={() => saveProductPrice(parseInt(editingProductPrice.value) || 0)}
                                        />
                                    </span>
                                ) : (
                                    <span
                                        className={`text-success font-bold ${canEdit ? 'hover:underline cursor-pointer' : ''}`}
                                        onClick={() => canEdit && setEditingProductPrice({ value: product.price.toString() })}
                                    >
                                        {formatVND(product.price)}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={async () => {
                            const addrId = selectedAddress?.id || null;
                            if (!addrId && !isAdmin) return; // Only Admin handling default menu can proceed without address_id

                            const targetName = addrId ? 'của chi nhánh này' : 'mặc định của hệ thống';
                            if (!window.confirm(`Xóa "${product.name}" khỏi menu ${targetName}?`)) return

                            setSaving(true)
                            try {
                                await removeProductFromAddress(productId, addrId)
                                refreshProducts?.()
                                navigate('/recipes', { state: location.state })
                            } catch (err) {
                                showError(err, 'Xóa món khỏi menu')
                            } finally {
                                setSaving(false)
                            }
                        }}
                        className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-danger/5 border border-danger/20 text-danger/70 hover:text-danger hover:bg-danger/10 transition-colors shadow-sm focus:outline-none shrink-0"
                        title="Xóa món khỏi menu"
                    >
                        <Trash2 size={20} strokeWidth={2.5} />
                    </button>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-bg">
                {canEdit && (
                    <label className="flex items-center justify-between gap-3 bg-surface border border-border/60 rounded-[14px] px-4 py-3 cursor-pointer select-none">
                        <span className="flex flex-col min-w-0">
                            <span className="text-[13px] font-bold text-text">Tính vào tổng số ly bán/ngày</span>
                            <span className="text-[11px] text-text-secondary">Tắt cho món tặng kèm như Trà Đá</span>
                        </span>
                        <input
                            type="checkbox"
                            checked={product?.count_as_cup !== false}
                            onChange={toggleCountAsCup}
                            disabled={saving}
                            className="w-5 h-5 accent-primary cursor-pointer shrink-0"
                        />
                    </label>
                )}
                <div className="space-y-2">
                    {prodRecipes.length === 0 && (
                        <p className="text-text-secondary text-[13px] text-center py-6">Chưa có nguyên liệu nào.</p>
                    )}

                    {prodRecipes.map(recipe => {
                        const isEditing = editingAmount?.ingredient === recipe.ingredient
                        const unitCost = ingredientCosts[recipe.ingredient] || 0
                        const lineCost = recipe.amount * unitCost

                        return (
                            <div key={recipe.ingredient} className="bg-surface border border-border/60 rounded-[14px] px-4 py-3 flex items-center gap-2 group">
                                <span className="text-[13px] text-text flex-1 min-w-0 truncate">
                                    {ingredientLabel(recipe.ingredient)}
                                </span>

                                {isEditing ? (
                                    <div className="flex items-center gap-1.5">
                                        <input
                                            type="number"
                                            autoFocus
                                            step="any"
                                            className="w-[72px] bg-bg border border-primary/60 rounded-lg px-2 py-1 text-[13px] text-text text-right focus:outline-none focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            value={editingAmount.value}
                                            onChange={e => setEditingAmount(prev => ({ ...prev, value: e.target.value }))}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') saveAmount(recipe.ingredient, parseFloat(editingAmount.value) || 0)
                                                if (e.key === 'Escape') setEditingAmount(null)
                                            }}
                                            onBlur={() => saveAmount(recipe.ingredient, parseFloat(editingAmount.value) || 0)}
                                        />
                                        <span className="text-[12px] text-text-dim">{getIngredientUnit(recipe.ingredient, recipe.unit, ingredientUnits)}</span>
                                    </div>
                                ) : (
                                    <span
                                        className={`text-[13px] font-bold text-primary tabular-nums min-w-[56px] text-right ${canEdit ? 'cursor-pointer hover:underline' : ''}`}
                                        onClick={() => canEdit && setEditingAmount({ ingredient: recipe.ingredient, value: recipe.amount.toString() })}
                                    >
                                        {recipe.amount} <span className="text-[11px] font-normal text-primary/70">{getIngredientUnit(recipe.ingredient, recipe.unit, ingredientUnits)}</span>
                                    </span>
                                )}

                                <span className="text-[11px] text-text-dim tabular-nums w-[64px] text-right shrink-0">
                                    {formatVND(lineCost)}
                                </span>



                            </div>
                        )
                    })}

                    {/* Add ingredient */}
                    {canEdit && (addingIngredient ? (
                        <div className="flex flex-col gap-2 pt-1 border-t border-border/30 mt-2 bg-surface border border-border/60 rounded-[14px] px-4 py-3">
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] text-text-dim font-bold uppercase">Thêm nguyên liệu</span>
                                {selectedIngredients.size > 0 && (
                                    <span className="text-[10px] text-primary font-bold bg-primary/10 px-1.5 py-0.5 rounded">
                                        Đã chọn {selectedIngredients.size}
                                    </span>
                                )}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {availableBaseIngredients.map(ing => {
                                    const isSelected = selectedIngredients.has(ing)
                                    return (
                                        <button
                                            key={ing}
                                            onClick={() => toggleIngredient(ing, setSelectedIngredients)}
                                            className={`text-[11px] border px-2 py-1 rounded-lg transition-colors font-medium ${isSelected
                                                ? 'bg-primary text-bg border-primary shadow-sm'
                                                : 'bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 active:bg-primary/30'
                                                }`}
                                        >
                                            {isSelected ? '✓ ' : '+ '}{ingredientLabel(ing)}
                                        </button>
                                    )
                                })}
                            </div>
                            {/* Custom ingredient input */}
                            <div className="flex flex-col gap-1.5 mt-1 pt-2 border-t border-border/30">
                                <span className="text-[10px] text-text-dim">Hoặc nhập nguyên liệu mới:</span>
                                <div className="flex flex-wrap sm:flex-nowrap gap-1.5">
                                    <input
                                        type="text"
                                        placeholder="Tên nguyên liệu..."
                                        className="flex-1 w-0 min-w-[120px] bg-bg border border-border/60 rounded-lg px-2 py-1.5 text-[12px] text-text focus:outline-none focus:border-primary"
                                        value={customIngredientName}
                                        onChange={e => setCustomIngredientName(e.target.value)}
                                    />
                                    {customIngredientName.trim() && !dbIngredients.includes(customIngredientName.trim()) && (
                                        <div className="flex items-center gap-1">
                                            {['g', 'ml', 'ly', 'gói', 'quả'].map(u => (
                                                <button
                                                    key={u}
                                                    onClick={() => setCustomIngredientUnit(u)}
                                                    className={`text-[10px] px-1.5 py-1 rounded-lg border transition-colors font-medium ${customIngredientUnit === u
                                                        ? 'bg-primary text-bg border-primary'
                                                        : 'bg-bg text-text-secondary border-border/60 hover:border-primary/40'
                                                        }`}
                                                >
                                                    {u}
                                                </button>
                                            ))}
                                            <input
                                                type="text"
                                                placeholder="đv"
                                                className="w-[40px] bg-bg border border-border/60 rounded-lg px-1.5 py-1 text-[10px] text-text text-center focus:outline-none focus:border-primary"
                                                value={!['g', 'ml', 'ly', 'gói', 'quả'].includes(customIngredientUnit) ? customIngredientUnit : ''}
                                                onChange={e => setCustomIngredientUnit(e.target.value)}
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>
                            {/* Action buttons */}
                            <div className="flex gap-2 mt-1">
                                <button
                                    onClick={handleAddMultipleIngredients}
                                    disabled={selectedIngredients.size === 0 && !customIngredientName.trim()}
                                    className="flex-1 bg-primary text-bg px-3 py-2 rounded-lg text-[12px] font-bold disabled:opacity-50 transition-opacity"
                                >
                                    {selectedIngredients.size > 0
                                        ? `Thêm ${selectedIngredients.size + (customIngredientName.trim() ? 1 : 0)} nguyên liệu`
                                        : 'Thêm'}
                                </button>
                                <button
                                    onClick={() => { setAddingIngredient(false); setSelectedIngredients(new Set()); setCustomIngredientName(''); setCustomIngredientUnit('') }}
                                    className="shrink-0 bg-surface-light border border-border/60 text-text px-3 py-2 rounded-lg text-[12px] font-bold"
                                >
                                    Hủy
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button
                            onClick={() => setAddingIngredient(true)}
                            className="w-full text-[12px] text-primary/70 hover:text-primary font-medium mt-1 transition-colors bg-surface border border-border/60 rounded-[14px] px-4 py-3 text-center"
                        >
                            + Thêm nguyên liệu
                        </button>
                    ))}
                </div>

                {/* ========== EXTRA OPTIONS SECTION ========== */}
                <div className="mt-4 pt-4 border-t border-border/40">
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-[13px] font-black text-text uppercase tracking-wide">Tùy chọn thêm</span>
                        <div className="flex items-center gap-2">
                            {canEdit && extras.length > 1 && !sortingExtras && (
                                <button
                                    onClick={() => { setSortedExtras([...extras]); setSortingExtras(true) }}
                                    className="text-[11px] text-text-dim hover:text-primary font-bold transition-colors"
                                >
                                    Sắp xếp
                                </button>
                            )}
                        </div>
                    </div>

                    {sortingExtras && (
                        <div className="space-y-1.5 mb-3">
                            {sortedExtras.map((extra, index) => (
                                <div key={extra.id} className="flex items-center gap-2 bg-surface border border-border/60 rounded-[12px] px-3 py-2">
                                    <span className="text-[11px] text-text-dim font-bold w-4 text-right shrink-0">{index + 1}</span>
                                    <span className="flex-1 text-[13px] font-bold text-text truncate uppercase">{extra.name}</span>
                                    <div className="flex border border-border/80 rounded-[8px] overflow-hidden shrink-0">
                                        <button onClick={() => moveExtra(index, index - 1)} disabled={index === 0}
                                            className="px-2.5 py-1 bg-surface-light text-text hover:bg-border/30 disabled:opacity-30 border-r border-border/80 text-[10px] font-bold">▲</button>
                                        <button onClick={() => moveExtra(index, index + 1)} disabled={index === sortedExtras.length - 1}
                                            className="px-2.5 py-1 bg-surface-light text-text hover:bg-border/30 disabled:opacity-30 text-[10px] font-bold">▼</button>
                                    </div>
                                </div>
                            ))}
                            <div className="flex gap-2 mt-2">
                                <button onClick={() => setSortingExtras(false)}
                                    className="flex-1 py-2 rounded-[10px] bg-surface-light border border-border/60 text-text-secondary text-[12px] font-bold">Hủy</button>
                                <button onClick={saveExtrasSortOrder} disabled={saving}
                                    className="flex-1 py-2 rounded-[10px] bg-primary text-bg text-[12px] font-bold disabled:opacity-50">
                                    {saving ? 'Đang lưu...' : 'Lưu thứ tự'}
                                </button>
                            </div>
                        </div>
                    )}

                    {extras.length === 0 && !addingExtra && (
                        <p className="text-text-secondary text-[12px] text-center py-3 bg-surface-light/50 rounded-[12px] border border-border/40">
                            Chưa có tùy chọn nào (ví dụ: Lớn, Trà đá...)
                        </p>
                    )}

                    <div className={`space-y-2 ${sortingExtras ? 'hidden' : ''}`}>
                        {extras.map(extra => (
                            <div key={extra.id} className="bg-surface border border-border/60 rounded-[14px] px-4 py-3 flex flex-col gap-2 group">
                                <div className="flex items-center gap-2">
                                    {editingExtraName?.extraId === extra.id ? (
                                        <input
                                            type="text"
                                            autoFocus
                                            className="flex-1 bg-bg border border-primary/60 rounded-lg px-2 py-0.5 text-[13px] font-bold text-text uppercase focus:outline-none focus:border-primary"
                                            value={editingExtraName.value}
                                            onChange={e => setEditingExtraName(prev => ({ ...prev, value: e.target.value }))}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') saveExtraName(extra.id, editingExtraName.value)
                                                if (e.key === 'Escape') setEditingExtraName(null)
                                            }}
                                            onBlur={() => saveExtraName(extra.id, editingExtraName.value)}
                                        />
                                    ) : (
                                        <div className="flex-1 flex items-center gap-1 min-w-0">
                                            <span
                                                className={`text-[13px] font-bold text-text uppercase truncate ${canEdit ? 'cursor-pointer hover:text-primary' : ''}`}
                                                onClick={() => canEdit && setEditingExtraName({ extraId: extra.id, value: extra.name })}
                                            >
                                                {extra.name}
                                            </span>
                                            {canEdit && (
                                                <button
                                                    onClick={() => setDuplicatingExtra({ id: extra.id, value: extra.name + ' (copy)' })}
                                                    className="text-text-dim hover:text-primary text-[14px] shrink-0 w-6 h-6 flex items-center justify-center"
                                                    title="Nhân bản"
                                                >
                                                    ⧉
                                                </button>
                                            )}
                                        </div>
                                    )}
                                    {editingExtraPrice?.extraId === extra.id ? (
                                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                            <input
                                                type="number"
                                                autoFocus
                                                className="w-[80px] bg-bg border border-primary/60 rounded-lg px-2 py-0.5 text-[12px] text-text text-right focus:outline-none focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                value={editingExtraPrice.value}
                                                onChange={e => setEditingExtraPrice(prev => ({ ...prev, value: e.target.value }))}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter') saveExtraPrice(extra.id, parseInt(editingExtraPrice.value) || 0)
                                                    if (e.key === 'Escape') setEditingExtraPrice(null)
                                                }}
                                                onBlur={() => saveExtraPrice(extra.id, parseInt(editingExtraPrice.value) || 0)}
                                            />
                                            <span className="text-[11px] text-text-dim">đ</span>
                                        </div>
                                    ) : (
                                        <span
                                            className={`text-[12px] font-bold tabular-nums ${extra.price < 0 ? 'text-danger' : extra.price > 0 ? 'text-success' : 'text-text-dim'} ${canEdit ? 'cursor-pointer hover:underline' : ''}`}
                                            onClick={() => canEdit && setEditingExtraPrice({ extraId: extra.id, value: extra.price.toString() })}
                                        >
                                            {extra.price > 0 ? `+${formatVND(extra.price)}` : extra.price < 0 ? `-${formatVND(Math.abs(extra.price))}` : 'Miễn phí'}
                                        </span>
                                    )}
                                    {canEdit && (
                                        <>
                                            <button
                                                onClick={() => handleToggleSticky(extra.id, extra.is_sticky)}
                                                className={`shrink-0 w-6 h-6 flex items-center text-[13px] justify-center rounded transition-colors ${extra.is_sticky ? 'text-warning' : 'text-text-dim/40 hover:text-text-dim'}`}
                                                title={extra.is_sticky ? 'Đang tự chọn — bấm để tắt' : 'Bấm để bật tự chọn'}
                                            >
                                                🔒
                                            </button>

                                            <button
                                                onClick={() => handleDeleteExtra(extra.id, extra.name)}
                                                className="text-danger hover:text-danger text-[14px] shrink-0 w-6 h-6 flex items-center justify-center"
                                                title="Xóa tùy chọn"
                                            >
                                                ✕
                                            </button>
                                        </>
                                    )}
                                </div>
                                {duplicatingExtra?.id === extra.id && (
                                    <div className="flex items-center gap-2 pt-1 border-t border-border/30">
                                        <input
                                            type="text"
                                            autoFocus
                                            placeholder="Tên bản sao..."
                                            className="flex-1 bg-bg border border-primary/60 rounded-lg px-2 py-1 text-[12px] text-text focus:outline-none focus:border-primary"
                                            value={duplicatingExtra.value}
                                            onChange={e => setDuplicatingExtra(prev => ({ ...prev, value: e.target.value }))}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') handleDuplicateExtra(extra.id, duplicatingExtra.value)
                                                if (e.key === 'Escape') setDuplicatingExtra(null)
                                            }}
                                        />
                                        <button
                                            onClick={() => handleDuplicateExtra(extra.id, duplicatingExtra.value)}
                                            disabled={!duplicatingExtra.value.trim() || saving}
                                            className="text-[11px] font-bold bg-primary text-bg px-2.5 py-1 rounded-lg disabled:opacity-50"
                                        >
                                            Nhân bản
                                        </button>
                                        <button
                                            onClick={() => setDuplicatingExtra(null)}
                                            className="text-[11px] text-text-dim hover:text-text"
                                        >
                                            Hủy
                                        </button>
                                    </div>
                                )}
                                <div className="border-t border-border/40 pt-2 flex flex-col gap-1.5">
                                    {(extraIngs[extra.id] || []).map(ei => {
                                        const isEditingExtra = editingExtraAmount?.extraId === extra.id && editingExtraAmount?.ingredient === ei.ingredient;
                                        return (
                                            <div key={ei.id} className="flex justify-between items-center bg-bg/50 px-2 py-1.5 rounded text-[12px]">
                                                <span className="text-text flex-1 min-w-0 truncate">{ingredientLabel(ei.ingredient)}</span>
                                                <div className="flex items-center gap-2">
                                                    {isEditingExtra ? (
                                                        <div className="flex items-center gap-1.5">
                                                            <input
                                                                type="number"
                                                                autoFocus
                                                                step="any"
                                                                className="w-[60px] bg-bg border border-primary/60 rounded-lg px-2 py-1 text-[13px] text-text text-right focus:outline-none focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                                value={editingExtraAmount.value}
                                                                onChange={e => setEditingExtraAmount(prev => ({ ...prev, value: e.target.value }))}
                                                                onKeyDown={e => {
                                                                    if (e.key === 'Enter') saveExtraAmount(extra.id, ei.ingredient, parseFloat(editingExtraAmount.value) || 0)
                                                                    if (e.key === 'Escape') setEditingExtraAmount(null)
                                                                }}
                                                                onBlur={() => saveExtraAmount(extra.id, ei.ingredient, parseFloat(editingExtraAmount.value) || 0)}
                                                            />
                                                            <span className="text-[10px] font-normal text-text-dim/70">{getIngredientUnit(ei.ingredient, ei.unit, ingredientUnits)}</span>
                                                        </div>
                                                    ) : (
                                                        <span
                                                            className={`font-bold tabular-nums min-w-[32px] text-right ${ei.amount > 0 ? 'text-primary' : ei.amount < 0 ? 'text-danger' : 'text-text-dim'} ${canEdit ? 'cursor-pointer hover:underline' : ''}`}
                                                            onClick={() => canEdit && setEditingExtraAmount({ extraId: extra.id, ingredient: ei.ingredient, value: ei.amount.toString() })}
                                                        >
                                                            {ei.amount > 0 ? '+' : ''}{ei.amount} <span className="text-[10px] font-normal text-text-dim/70">{getIngredientUnit(ei.ingredient, ei.unit, ingredientUnits)}</span>
                                                        </span>
                                                    )}
                                                    {canEdit && <button onClick={() => handleDeleteExtraIngredient(extra.id, ei.ingredient)} className="text-danger/60 hover:text-danger text-[14px]">✕</button>}
                                                </div>
                                            </div>
                                        )
                                    })}

                                    {canEdit && (addingExtraIng === extra.id ? (
                                        <div className="flex flex-col gap-2 bg-bg/50 p-3 rounded-xl border border-border/60 mt-2">
                                            <div className="flex items-center justify-between">
                                                <span className="text-[11px] text-text-dim font-bold uppercase">Thêm nguyên liệu / tác động</span>
                                                {selectedExtraIngs.size > 0 && (
                                                    <span className="text-[10px] text-primary font-bold bg-primary/10 px-1.5 py-0.5 rounded">
                                                        Đã chọn {selectedExtraIngs.size}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex flex-wrap gap-1.5">
                                                {dbIngredients.filter(i => !(extraIngs[extra.id] || []).find(ei => ei.ingredient === i)).map(ing => {
                                                    const isSelected = selectedExtraIngs.has(ing)
                                                    return (
                                                        <button
                                                            key={ing}
                                                            onClick={() => toggleIngredient(ing, setSelectedExtraIngs)}
                                                            className={`text-[11px] border px-2 py-1 rounded-lg transition-colors font-medium ${isSelected
                                                                ? 'bg-primary text-bg border-primary shadow-sm'
                                                                : 'bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 active:bg-primary/30'
                                                                }`}
                                                        >
                                                            {isSelected ? '✓ ' : '+ '}{ingredientLabel(ing)}
                                                        </button>
                                                    )
                                                })}
                                            </div>
                                            {/* Custom extra ingredient input */}
                                            <div className="flex flex-col gap-1.5 mt-1 pt-2 border-t border-border/30">
                                                <span className="text-[10px] text-text-dim">Hoặc nhập nguyên liệu mới:</span>
                                                <div className="flex flex-wrap sm:flex-nowrap gap-1.5">
                                                    <input
                                                        type="text"
                                                        placeholder="Tên..."
                                                        className="flex-1 w-0 min-w-[80px] bg-bg border border-border/60 rounded-lg px-2 py-1.5 text-[12px] text-text focus:outline-none focus:border-primary"
                                                        value={customExtraIngName}
                                                        onChange={e => setCustomExtraIngName(e.target.value)}
                                                    />
                                                    {customExtraIngName.trim() && !dbIngredients.includes(customExtraIngName.trim()) && (
                                                        <div className="flex items-center gap-1">
                                                            {['g', 'ml', 'ly', 'gói', 'quả'].map(u => (
                                                                <button
                                                                    key={u}
                                                                    onClick={() => setCustomExtraIngUnit(u)}
                                                                    className={`text-[10px] px-1.5 py-1 rounded-lg border transition-colors font-medium ${customExtraIngUnit === u
                                                                        ? 'bg-primary text-bg border-primary'
                                                                        : 'bg-bg text-text-secondary border-border/60 hover:border-primary/40'
                                                                        }`}
                                                                >
                                                                    {u}
                                                                </button>
                                                            ))}
                                                            <input
                                                                type="text"
                                                                placeholder="đv"
                                                                className="w-[40px] bg-bg border border-border/60 rounded-lg px-1.5 py-1 text-[10px] text-text text-center focus:outline-none focus:border-primary"
                                                                value={!['g', 'ml', 'ly', 'gói', 'quả'].includes(customExtraIngUnit) ? customExtraIngUnit : ''}
                                                                onChange={e => setCustomExtraIngUnit(e.target.value)}
                                                            />
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            {/* Action buttons */}
                                            <div className="flex gap-2 mt-1">
                                                <button
                                                    onClick={() => handleAddMultipleExtraIngredients(extra.id)}
                                                    disabled={selectedExtraIngs.size === 0 && !customExtraIngName.trim()}
                                                    className="flex-1 bg-primary text-bg px-3 py-1.5 rounded-lg text-[12px] font-bold disabled:opacity-50 transition-opacity"
                                                >
                                                    {selectedExtraIngs.size > 0
                                                        ? `Thêm ${selectedExtraIngs.size + (customExtraIngName.trim() ? 1 : 0)} nguyên liệu`
                                                        : 'Thêm'}
                                                </button>
                                                <button
                                                    onClick={() => { setAddingExtraIng(null); setSelectedExtraIngs(new Set()); setCustomExtraIngName(''); setCustomExtraIngUnit('') }}
                                                    className="shrink-0 bg-surface-light border border-border/60 text-text px-2 py-1.5 rounded-lg text-[12px] font-bold"
                                                >
                                                    Hủy
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => { setAddingExtraIng(extra.id); setSelectedExtraIngs(new Set()); setCustomExtraIngName(''); setCustomExtraIngUnit('') }}
                                            className="text-[11px] text-primary hover:underline self-start font-medium mt-1"
                                        >
                                            + Thay đổi nguyên liệu
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>

                    {canEdit && !sortingExtras && (addingExtra ? (
                        <div className="mt-2 bg-surface border border-border/60 rounded-[14px] px-4 py-3 space-y-2">
                            <span className="text-[11px] text-text-dim font-bold uppercase">Thêm tùy chọn</span>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="Tên (VD: Lớn)"
                                    autoFocus
                                    className="flex-1 min-w-0 bg-bg border border-border/60 rounded-lg px-2 py-1.5 text-[13px] text-text focus:outline-none focus:border-primary"
                                    value={newExtraName}
                                    onChange={e => setNewExtraName(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') handleAddExtra() }}
                                />
                                <input
                                    type="number"
                                    placeholder="Giá"
                                    className="w-[80px] bg-bg border border-border/60 rounded-lg px-2 py-1.5 text-[13px] text-text focus:outline-none focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    value={newExtraPrice}
                                    onChange={e => setNewExtraPrice(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') handleAddExtra() }}
                                />
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={handleAddExtra}
                                    disabled={!newExtraName.trim()}
                                    className="bg-primary text-bg px-3 py-1.5 rounded-lg text-[12px] font-bold disabled:opacity-50"
                                >
                                    Lưu
                                </button>
                                <button
                                    onClick={() => { setAddingExtra(false); setNewExtraName(''); setNewExtraPrice('') }}
                                    className="bg-surface-light text-text px-2 py-1.5 rounded-lg text-[12px] font-bold"
                                >
                                    Hủy
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button
                            onClick={() => setAddingExtra(true)}
                            className="w-full text-[12px] text-primary/70 hover:text-primary font-medium mt-2 transition-colors bg-surface border border-border/60 rounded-[14px] px-4 py-3 text-center"
                        >
                            + Thêm tùy chọn
                        </button>
                    ))}
                </div>


            </main>

            {saving && (
                <div className="fixed bottom-4 right-4 z-50 pointer-events-none">
                    <span className="text-text-secondary text-[11px] animate-pulse">Đang lưu...</span>
                </div>
            )}
        </div>
    )
}
