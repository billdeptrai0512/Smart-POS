import { useState, useEffect, useMemo, useRef, Fragment } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Plus, X, Minus } from 'lucide-react'
import {
    DndContext, DragOverlay, PointerSensor, KeyboardSensor,
    closestCenter, useSensor, useSensors,
} from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { restrictToFirstScrollableAncestor } from '@dnd-kit/modifiers'
import { BottomSheet } from '../components/common/ModalShell'
import MenuDivider from '../components/common/MenuDivider'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { useOnboardingVisibility } from '../contexts/OnboardingVisibilityContext'
import { upsertProductPrice, insertProduct, updateProductSortOrder, updateProductName, removeProductFromAddress } from '../services/orderService'
import { parseVNDInput } from '../utils'
import { useToast } from '../hooks/useToast'
import Toast from '../components/POSPage/Toast'
import SortableItem from '../components/RecipeMenuPage/SortableItem'
import RecipeMenuHeader from '../components/RecipeMenuPage/RecipeMenuHeader'
import ProductCard from '../components/RecipeMenuPage/ProductCard'
import CreateProductForm from '../components/RecipeMenuPage/CreateProductForm'
import { goToMenuStep } from '../utils/menuSequence'

// Module-level scroll cache. Set when user clicks a product card to drill into
// /recipes/:productId; consumed once on next mount of /recipes (back nav).
// Cleared after restore so a fresh visit from another route starts at top.
let savedScroll = null

// Mục (divider) render riêng 1 hàng ngang full-width, KHÔNG chung lưới 2 cột với
// card đứng trước/sau nó — tránh CSS grid để lại 1 ô trống khi divider rơi vào vị
// trí lẻ (col-span-2 không đủ chỗ ở hàng đang dở). Gom sản phẩm thành từng nhóm:
// { divider: product | null, items: [...] } theo đúng thứ tự trong mảng gốc.
function groupBySections(products) {
    const sections = [{ divider: null, items: [] }]
    for (const p of products) {
        if (p.is_divider) sections.push({ divider: p, items: [] })
        else sections[sections.length - 1].items.push(p)
    }
    return sections
}

export default function RecipeMenuPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const backTo = location.state?.from || '/history'
    const { products, recipes, ingredientCosts, ingredientUnits, refreshProducts } = useProducts()
    const { selectedAddress } = useAddress()
    const { isManager, isAdmin } = useAuth()
    const canEdit = isManager || isAdmin
    // Chỉ Admin được sắp xếp menu mặc định (chưa chọn địa chỉ) — giống rule cũ của saveSortOrder.
    const canSort = canEdit && !!(selectedAddress?.id || isAdmin)
    const { toast, showToast, showError } = useToast()

    const [newProductName, setNewProductName] = useState('')
    const [newProductPrice, setNewProductPrice] = useState('')
    const [saving, setSaving] = useState(false)
    // Kéo-thả trực tiếp trên lưới chính — không có "chế độ sắp xếp" riêng, chỉ ẩn
    // onboarding trong lúc đang thực sự kéo (tránh che tay/gesture).
    const [isDragging, setIsDragging] = useState(false)
    const [activeId, setActiveId] = useState(null)
    const { setHidden: setOnboardingHidden } = useOnboardingVisibility()
    useEffect(() => {
        setOnboardingHidden(isDragging)
        return () => setOnboardingHidden(false)
    }, [isDragging, setOnboardingHidden])
    // Bản sao local để phản hồi ngay khi thả tay, trước khi round-trip lưu server xong.
    const [orderedProducts, setOrderedProducts] = useState(products)
    useEffect(() => { setOrderedProducts(products) }, [products])
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

    // Thả tay = commit luôn (không có bước "Lưu sắp xếp" riêng). Optimistic update
    // trước, rollback về thứ tự cũ nếu lưu server lỗi.
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    )
    async function handleDragEnd({ active, over }) {
        setIsDragging(false)
        setActiveId(null)
        if (!over || active.id === over.id) return
        const keys = orderedProducts.map(p => p.id)
        const from = keys.indexOf(active.id)
        const to = keys.indexOf(over.id)
        const updated = [...orderedProducts]
        const [moved] = updated.splice(from, 1)
        updated.splice(to, 0, moved)
        const previous = orderedProducts
        setOrderedProducts(updated)
        try {
            await updateProductSortOrder(selectedAddress?.id || null, updated.map(p => p.id))
            refreshProducts?.()
        } catch (err) {
            setOrderedProducts(previous)
            showError(err, 'Lưu thứ tự món')
        }
    }

    const activeProduct = activeId ? orderedProducts.find(p => p.id === activeId) : null
    const sections = useMemo(() => groupBySections(orderedProducts), [orderedProducts])
    // Card và mục kéo trong 2 SortableContext riêng — mỗi context chỉ chứa item
    // cùng cỡ nên animate "nhường chỗ" không còn phải né kích thước lẫn nhau.
    // handleDragEnd vẫn tính từ danh sách phẳng orderedProducts nên món vẫn đổi
    // được qua mục khác bình thường (over có thể là id của mục hoặc card khác).
    const cardIds = useMemo(() => orderedProducts.filter(p => !p.is_divider).map(p => p.id), [orderedProducts])
    const dividerIds = useMemo(() => orderedProducts.filter(p => p.is_divider).map(p => p.id), [orderedProducts])

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
                {canEdit && (
                    <button
                        onClick={() => { setDividerName(''); setDividerModal({ mode: 'create' }) }}
                        className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-[12px] bg-surface border border-dashed border-border text-text-secondary text-[12px] font-black uppercase tracking-widest hover:bg-surface-light active:scale-[0.98] transition-all"
                    >
                        <Minus size={14} /> Tạo mục mới <Minus size={14} />
                    </button>
                )}

                {canSort ? (
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        modifiers={[restrictToFirstScrollableAncestor]}
                        onDragStart={({ active }) => { setIsDragging(true); setActiveId(active.id) }}
                        onDragCancel={() => { setIsDragging(false); setActiveId(null) }}
                        onDragEnd={handleDragEnd}
                    >
                        <div className="flex flex-col gap-3">
                            {sections.map((section, si) => (
                                <Fragment key={section.divider?.id ?? `_first_${si}`}>
                                    {section.divider && (
                                        <SortableContext items={dividerIds} strategy={rectSortingStrategy}>
                                            <SortableItem id={section.divider.id} noAnimate>
                                                {({ dragHandleProps }) => (
                                                    <MenuDivider
                                                        name={section.divider.name}
                                                        onClick={() => { setDividerName(section.divider.name); setDividerModal({ mode: 'edit', id: section.divider.id }) }}
                                                        dragHandleProps={dragHandleProps}
                                                    />
                                                )}
                                            </SortableItem>
                                        </SortableContext>
                                    )}
                                    {section.items.length > 0 && (
                                        <SortableContext items={cardIds} strategy={rectSortingStrategy}>
                                            <div className="grid grid-cols-2 gap-3">
                                                {section.items.map(product => (
                                                    <SortableItem key={product.id} id={product.id}>
                                                        {({ handle, isDragging: itemDragging }) => (
                                                            <ProductCard
                                                                product={product}
                                                                prodRecipes={recipesByProduct.get(product.id) || []}
                                                                cost={costByProduct.get(product.id) || 0}
                                                                ingredientUnits={ingredientUnits}
                                                                onClick={itemDragging ? undefined : () => {
                                                                    savedScroll = mainRef.current?.scrollTop ?? 0
                                                                    navigate(`/recipes/${product.id}`, { state: location.state })
                                                                }}
                                                                dragHandle={handle}
                                                            />
                                                        )}
                                                    </SortableItem>
                                                ))}
                                            </div>
                                        </SortableContext>
                                    )}
                                </Fragment>
                            ))}
                        </div>
                        {/* Ảnh kéo nổi theo con trỏ khi kéo mục — mục không tự nhường chỗ
                            (xem SortableItem's noAnimate). */}
                        <DragOverlay>
                            {activeProduct && (activeProduct.is_divider ? (
                                <div className="opacity-90 rotate-1 w-[calc(50vw-1.25rem)] max-w-[280px]">
                                    <MenuDivider name={activeProduct.name} />
                                </div>
                            ) : (
                                <div className="opacity-90 rotate-2 shadow-2xl shadow-black/40 rounded-[1.5rem]">
                                    <ProductCard
                                        product={activeProduct}
                                        prodRecipes={recipesByProduct.get(activeProduct.id) || []}
                                        cost={costByProduct.get(activeProduct.id) || 0}
                                        ingredientUnits={ingredientUnits}
                                    />
                                </div>
                            ))}
                        </DragOverlay>
                    </DndContext>
                ) : (
                    <div className="flex flex-col gap-3">
                        {sections.map((section, si) => (
                            <Fragment key={section.divider?.id ?? `_first_${si}`}>
                                {section.divider && (
                                    <MenuDivider
                                        name={section.divider.name}
                                        onClick={canEdit ? () => { setDividerName(section.divider.name); setDividerModal({ mode: 'edit', id: section.divider.id }) } : undefined}
                                    />
                                )}
                                {section.items.length > 0 && (
                                    <div className="grid grid-cols-2 gap-3">
                                        {section.items.map(product => (
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
                            </Fragment>
                        ))}
                    </div>
                )}
            </main>

            {canEdit && (
                <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto pointer-events-none z-50">
                    <div className="flex justify-end px-4 pb-[max(env(safe-area-inset-bottom),16px)] pointer-events-auto">
                        <button
                            onClick={() => setShowCreateModal(true)}
                            className="rounded-[12px] px-4 py-2.5 flex items-center gap-2 text-[13px] font-bold bg-primary text-bg shadow-lg shadow-primary/30 hover:bg-primary/90 active:scale-95 transition-all"
                        >
                            <Plus size={18} /> Tạo món
                        </button>
                    </div>
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
