import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'

import { fetchIngredientCosts, fetchIngredientCostsWithUnits, upsertIngredientCost, deleteIngredientCost } from '../services/orderService'
import { sortIngredients, ingredientLabel, getIngredientUnit } from '../components/common/recipeUtils'
import IngredientCostItem from '../components/IngredientManagementPage/IngredientCostItem'
import { ArrowLeft } from 'lucide-react'

export default function IngredientManagementPage() {
    const navigate = useNavigate()
    const { ingredientCosts: contextCosts, refreshProducts } = useProducts()
    const { selectedAddress, updateSortOrder } = useAddress()
    const { isManager, isAdmin } = useAuth()
    const canEdit = isManager || isAdmin

    const [ingredientCosts, setIngredientCosts] = useState(contextCosts || {})
    const [ingredientUnits, setIngredientUnits] = useState({})
    const [editingCost, setEditingCost] = useState(null)
    const [saving, setSaving] = useState(false)

    // Sorting state
    const [isSorting, setIsSorting] = useState(false)
    const [sortedIngredients, setSortedIngredients] = useState([])

    // Create ingredient state
    const [newIngredientName, setNewIngredientName] = useState('')
    const [newIngredientUnit, setNewIngredientUnit] = useState('')
    const [newIngredientCost, setNewIngredientCost] = useState('')

    // Sync from context
    useEffect(() => { setIngredientCosts(contextCosts) }, [contextCosts])

    useEffect(() => {
        if (selectedAddress?.id) {
            fetchIngredientCosts(selectedAddress.id).then(setIngredientCosts)
            fetchIngredientCostsWithUnits(selectedAddress.id).then(data => {
                const units = {}
                data.forEach(d => { units[d.ingredient] = d.unit })
                setIngredientUnits(units)
            })
        }
    }, [selectedAddress?.id])

    // Build ingredient list from DB costs only
    const allIngredients = useMemo(() => {
        const keys = Object.keys(ingredientCosts)
        return keys.sort((a, b) => sortIngredients(a, b, selectedAddress?.ingredient_sort_order))
    }, [ingredientCosts, selectedAddress?.ingredient_sort_order])

    async function saveCost(ingredient, newCost) {
        setSaving(true)
        try {
            await upsertIngredientCost(ingredient, newCost, selectedAddress?.id)
            setIngredientCosts(prev => ({ ...prev, [ingredient]: newCost }))
            refreshProducts?.()
        } catch (err) {
            console.error('Save cost error:', err)
        } finally {
            setSaving(false)
            setEditingCost(null)
        }
    }

    async function handleCreateIngredient() {
        if (!newIngredientName.trim()) return
        const key = newIngredientName.trim().toLowerCase().replace(/\s+/g, '_')
        const unit = newIngredientUnit || 'đv'
        const cost = parseInt(newIngredientCost) || 0
        setSaving(true)
        try {
            await upsertIngredientCost(key, cost, selectedAddress?.id, unit)
            setIngredientCosts(prev => ({ ...prev, [key]: cost }))
            setIngredientUnits(prev => ({ ...prev, [key]: unit }))
            refreshProducts?.()
            setNewIngredientName('')
            setNewIngredientUnit('')
            setNewIngredientCost('')
        } catch (err) {
            console.error('Create ingredient error:', err)
        } finally {
            setSaving(false)
        }
    }

    async function handleDeleteIngredient(ingredient) {
        if (!window.confirm(`Xóa nguyên liệu "${ingredientLabel(ingredient)}"?`)) return
        setSaving(true)
        try {
            await deleteIngredientCost(ingredient, selectedAddress?.id)
            setIngredientCosts(prev => {
                const next = { ...prev }
                delete next[ingredient]
                return next
            })
            setIngredientUnits(prev => {
                const next = { ...prev }
                delete next[ingredient]
                return next
            })
            refreshProducts?.()
        } catch (err) {
            console.error('Delete ingredient error:', err)
        } finally {
            setSaving(false)
        }
    }

    // Sort mode handlers
    const enterSortMode = () => {
        setSortedIngredients([...allIngredients])
        setIsSorting(true)
    }

    const cancelSortMode = () => {
        setIsSorting(false)
        setSortedIngredients([])
    }

    const moveIngredient = (fromIndex, toIndex) => {
        if (toIndex < 0 || toIndex >= sortedIngredients.length) return
        const updated = [...sortedIngredients]
        const [moved] = updated.splice(fromIndex, 1)
        updated.splice(toIndex, 0, moved)
        setSortedIngredients(updated)
    }

    const saveSortOrderHandler = async () => {
        if (!selectedAddress?.id) return
        setSaving(true)
        try {
            await updateSortOrder(selectedAddress.id, sortedIngredients)
            setIsSorting(false)
        } catch (err) {
            console.error(err)
            alert('Lỗi lưu thứ tự')
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative">
            {/* Header */}
            <header className="shrink-0 pt-6 pb-4 bg-surface border-b border-border/60 shadow-sm relative z-20 flex flex-col px-4 gap-3">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => navigate('/recipes')}
                        className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none"
                    >
                        <ArrowLeft size={20} strokeWidth={2.5} />
                    </button>

                    <div className="flex flex-row gap-2 flex-1">
                        <div className="flex-1 bg-primary/5 border border-primary/10 shadow-sm rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center">
                            <span className="text-[12px] font-black text-primary uppercase line-clamp-1">Nguyên liệu</span>
                            <span className="text-[12px] font-bold text-text/80 leading-none mt-1 tabular-nums">{allIngredients.length} loại</span>
                        </div>
                    </div>
                </div>
            </header>

            {/* Main content */}
            <main className="flex-1 overflow-y-auto px-4 py-4 pb-48 space-y-2 bg-bg">
                {isSorting ? (
                    <div className="space-y-1.5">
                        <p className="text-[12px] text-text-dim mb-2">Dùng nút ▲ ▼ để sắp xếp thứ tự hiển thị nguyên liệu cho chi nhánh này.</p>
                        {sortedIngredients.map((ingredient, index) => (
                            <div key={ingredient} className="flex items-center gap-2 bg-surface border border-border/60 shadow-sm rounded-[12px] px-3 py-2">
                                <span className="text-[11px] text-text-dim font-bold tabular-nums w-5 text-right">{index + 1}</span>
                                <span className="flex-1 text-[13px] font-bold text-text truncate">{ingredientLabel(ingredient)}</span>
                                <div className="flex border border-border/80 rounded-[8px] overflow-hidden">
                                    <button
                                        onClick={() => moveIngredient(index, index - 1)}
                                        disabled={index === 0}
                                        className="px-3 py-1.5 bg-surface-light text-text hover:bg-border/30 disabled:opacity-30 disabled:cursor-not-allowed border-r border-border/80 font-bold text-[10px]"
                                    >▲</button>
                                    <button
                                        onClick={() => moveIngredient(index, index + 1)}
                                        disabled={index === sortedIngredients.length - 1}
                                        className="px-3 py-1.5 bg-surface-light text-text hover:bg-border/30 disabled:opacity-30 disabled:cursor-not-allowed font-bold text-[10px]"
                                    >▼</button>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="space-y-2">
                        <p className="text-[12px] text-text-dim mb-2">Giá mỗi đơn vị nguyên liệu (VNĐ). Nhấn vào giá để chỉnh sửa.</p>
                        {allIngredients.map(ingredient => (
                            <IngredientCostItem
                                key={ingredient}
                                ingredient={ingredient}
                                cost={ingredientCosts[ingredient] || 0}
                                isEditing={editingCost?.ingredient === ingredient}
                                editingCost={editingCost}
                                setEditingCost={setEditingCost}
                                saveCost={saveCost}
                                ingredientLabel={ingredientLabel}
                                getIngredientUnit={getIngredientUnit}
                                storedUnit={ingredientUnits[ingredient]}
                                onDelete={canEdit ? handleDeleteIngredient : null}
                                canEdit={canEdit}
                            />
                        ))}
                        {allIngredients.length === 0 && (
                            <p className="text-text-secondary text-[13px] text-center py-6">Chưa có nguyên liệu nào.</p>
                        )}
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
                                    onClick={saveSortOrderHandler}
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
                                        placeholder="Tên nguyên liệu..."
                                        value={newIngredientName}
                                        onChange={e => setNewIngredientName(e.target.value)}
                                        className="flex-1 min-w-0 bg-surface-light border border-border/60 rounded-[12px] px-3 py-2.5 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-primary/40 transition-colors"
                                    />
                                    <div className="relative shrink-0 flex items-center w-[80px] bg-surface-light border border-border/60 rounded-[12px] focus-within:border-primary/40 transition-colors overflow-hidden">
                                        <input
                                            type="text"
                                            placeholder="Đơn vị"
                                            value={newIngredientUnit}
                                            onChange={e => setNewIngredientUnit(e.target.value)}
                                            className="w-full bg-transparent px-3 py-2.5 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none z-10"
                                        />
                                    </div>
                                    <div className="relative shrink-0 flex items-center w-[90px] bg-surface-light border border-border/60 rounded-[12px] focus-within:border-primary/40 transition-colors overflow-hidden">
                                        <input
                                            type="number"
                                            placeholder="Giá/đv"
                                            value={newIngredientCost}
                                            onChange={e => setNewIngredientCost(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleCreateIngredient()
                                            }}
                                            className="w-full bg-transparent px-3 py-2.5 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none z-10 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                        />
                                    </div>
                                </div>

                                <button
                                    onClick={handleCreateIngredient}
                                    disabled={!newIngredientName.trim() || saving}
                                    className="w-full py-3 rounded-[12px] bg-primary text-bg text-[14px] font-black hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed uppercase"
                                >
                                    {saving ? 'Đang...' : 'Tạo nguyên liệu'}
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
