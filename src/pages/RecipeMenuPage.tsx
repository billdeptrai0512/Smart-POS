import { useState, useEffect, useLayoutEffect, useMemo, useRef, Fragment, lazy, Suspense, type ReactNode } from 'react'
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { Plus, BadgePercent, GripVertical } from 'lucide-react'
import {
    type DragEndEvent,
    DndContext, DragOverlay, MouseSensor, TouchSensor,
    closestCenter, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type CollisionDetection,
} from '@dnd-kit/core'
import { BottomSheet, SheetHeader, SHEET_PANEL } from '../components/common/ModalShell'
import MenuDivider from '../components/common/MenuDivider'
import Dropdown from '../components/common/Dropdown'
import NoticeBar from '../components/common/NoticeBar'
import { normalizeSearchText, normalizeIngredientKey } from '../utils/ingredients'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { upsertProductPrice, insertProduct, updateProductSortOrder, updateProductName, removeProductFromAddress, upsertIngredientCost, setIngredientsGroup } from '../services/orderService'
import { parseVNDInput } from '../utils'
import { useToast } from '../hooks/useToast'
import { useSavingAction } from '../hooks/useSavingAction'
import Toast from '../components/POSPage/Toast'
import MenuPageHeader from '../components/common/MenuPageHeader'
import ProductCard from '../components/RecipeMenuPage/ProductCard'
import CreateProductForm from '../components/RecipeMenuPage/CreateProductForm'
import CreateBatchForm from '../components/RecipeMenuPage/CreateBatchForm'
import CreateToppingForm from '../components/RecipeMenuPage/CreateToppingForm'
import { insertTopping, fetchToppingIngredients } from '../services/toppingService'
import { goToMenuStep } from '../utils/menuSequence'
import { useTabRoute } from '../hooks/useTabRoute'
import { RECIPE_TABS, DISCOUNT_TAB } from '../constants/menuTabs'
import { norm } from '../utils/onboardingHint'
import { isRecipeProgressDone, isInventoryProgressDone, readOnboardingState, DEFAULT_ONBOARDING_STATE } from '../utils/onboardingStorage'
import { useOnboardingProgress } from '../hooks/useOnboardingProgress'
import { useOnboardingProgressPersist } from '../hooks/useOnboardingProgressPersist'
import { RECIPE_TARGET_PRODUCT } from '../components/common/onboarding/steps'
import type { Row } from '../types/domain'
import { groupRecipesByProduct } from '../utils/inventory'

// ponytail: kéo theo xlsx (~430 kB) — chỉ tải khi bấm "Nhập Excel", không phải lúc mở /category.
const ExcelImportModal = lazy(() => import('../components/RecipeMenuPage/ExcelImportModal'))

// Module-level cache của màn danh sách (cuộn + loại đang lọc + ô tìm). Ghi khi bấm 1 thẻ để vào trang chi tiết;
// dùng 1 lần ở lần mount kế (back) rồi xoá, để vào từ route khác thì bắt đầu từ đầu. Cùng kiểu /inventory/stocking.
let saved: { scroll: number; kind: string; search: string } | null = null

// Mục (divider) render riêng 1 hàng ngang full-width, KHÔNG chung lưới 2 cột với
// card đứng trước/sau nó — tránh CSS grid để lại 1 ô trống khi divider rơi vào vị
// trí lẻ (col-span-2 không đủ chỗ ở hàng đang dở). Gom sản phẩm thành từng nhóm:
// { divider: product | null, items: [...] } theo đúng thứ tự trong mảng gốc.
interface Section { divider: Row | null; items: Row[] }

function groupBySections(products: Row[]) {
    const sections: Section[] = [{ divider: null, items: [] }]
    for (const p of products) {
        if (p.is_divider) sections.push({ divider: p, items: [] })
        else sections[sections.length - 1].items.push(p)
    }
    return sections
}

// Con trỏ nằm trong ô nào thì ô đó là đích; kẽ hở giữa các ô thì lấy ô gần tâm nhất.
const collision: CollisionDetection = args => {
    const hit = pointerWithin(args)
    return hit.length ? hit : closestCenter(args)
}

// 1 ô kéo được + cũng là ô đích thả (lit = đang là đích, do trang quyết định vì kéo danh mục thì
// sáng cả hàng). Không dùng useSortable: không cần animation nhường chỗ.
function DragRow({ id, enabled, lit, children }: { id: string; enabled: boolean; lit: boolean; children: ReactNode }) {
    const { setNodeRef: dragRef, listeners, isDragging } = useDraggable({ id, disabled: !enabled })
    const { setNodeRef: dropRef } = useDroppable({ id, disabled: !enabled })
    return (
        <div
            ref={node => { dragRef(node); dropRef(node) }}
            {...listeners}
            onContextMenu={enabled ? e => e.preventDefault() : undefined}
            className={`select-none [-webkit-touch-callout:none] rounded-[1.5rem] ${isDragging ? 'opacity-30' : lit ? 'ring-2 ring-primary' : ''}`}
        >
            {children}
        </div>
    )
}

// Một trang, 3 loại thẻ — chọn bằng bộ lọc cạnh ô tìm (?kind=). Mặc định món chính.
const KINDS = [
    { key: 'main', label: 'Món chính' },
    { key: 'batch', label: 'Bán thành phẩm' },
    { key: 'topping', label: 'Topping' },
] as const
type Kind = typeof KINDS[number]['key']

export default function RecipeMenuPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const backTo = location.state?.from || '/history/sales'
    const { products, batchProducts, toppings, recipes, ingredientCosts, ingredientUnits, ingredientGroups, discountPrograms, refreshProducts } = useProducts()
    const { addressId } = useAddress()
    const { isManager, isAdmin, isGuest } = useAuth()
    const canEdit = isManager || isAdmin

    // Onboarding phase 5 (Công thức) — hint thẻ "Cà phê đen" cho tới khi đã điền định lượng
    // + tạo tùy chọn thêm.
    // recipeProgress do trang này ghi viewedMenu/viewedRecipes (cùng pattern RecipeIngredientPage):
    // chỉ tính khi đã xong Tồn kho — nếu không guide nhảy qua bước đang đứng. viewedRecipes cần viewedMenu trước.
    const inventoryDone = isInventoryProgressDone(useOnboardingProgress('inventoryProgress', { isGuest, addressId }))
    const [recipeProgress, setRecipeProgress] = useState(() =>
        (isGuest && addressId ? readOnboardingState(addressId) : DEFAULT_ONBOARDING_STATE).recipeProgress
    )
    useOnboardingProgressPersist('recipeProgress', recipeProgress, { isGuest, addressId })
    const cafeDenProduct = useMemo(
        () => (isGuest ? products.find(p => norm(p.name) === RECIPE_TARGET_PRODUCT) : null),
        [isGuest, products]
    )
    const hintCafeDen = isGuest && !!cafeDenProduct && !isRecipeProgressDone(recipeProgress)
    // 1 id duy nhất để so ở cả 2 nhánh render (kéo-thả/list) thay vì lặp lại
    // `hintCafeDen && product.id === cafeDenProduct?.id` ở từng chỗ.
    const hintCafeDenId = hintCafeDen ? cafeDenProduct!.id : null

    // Chỉ Admin được sắp xếp menu mặc định (chưa chọn địa chỉ) — giống rule cũ của saveSortOrder.
    const canSort = canEdit && !!(addressId || isAdmin)
    const { toast, showToast, showError } = useToast()

    const { saving, withSaving } = useSavingAction(showError)
    // Bản sao local để phản hồi ngay khi thả tay, trước khi round-trip lưu server xong.
    const [orderedProducts, setOrderedProducts] = useState(products)
    useEffect(() => { setOrderedProducts(products) }, [products])
    // Tab nằm trên URL: /category/overall = Menu (menu chia theo danh mục, lọc theo danh mục, kéo-thả sắp xếp),
    // /category/recipes = Công thức (chi tiết từng món, tìm kiếm, thêm công thức, topping).
    const [view, setView] = useTabRoute('/category')
    if (isGuest && addressId) {
        if (inventoryDone && view === 'overall' && !recipeProgress.viewedMenu) setRecipeProgress(prev => ({ ...prev, viewedMenu: true }))
        if (recipeProgress.viewedMenu && view === 'recipes' && !recipeProgress.viewedRecipes) setRecipeProgress(prev => ({ ...prev, viewedRecipes: true }))
    }
    // Lọc danh mục ở tab Menu: 'all' | 'none' (món chưa thuộc mục nào) | id của mục (divider). Id lạ (mục đã xoá) rơi về 'all'.
    const [categoryFilter, setCategoryFilter] = useState('all')
    const restored = useRef(saved)
    useEffect(() => { saved = null }, [])
    const [search, setSearch] = useState(() => restored.current?.search ?? '')
    const [params, setParams] = useSearchParams()
    const setKind = (k: string) => setParams(k === 'main' ? {} : { kind: k }, { replace: true })
    // Back từ trang chi tiết về /category/recipes (không còn ?kind=): khôi phục loại đã lọc, ghi lại lên URL rồi thôi dùng pending.
    const [pendingKind, setPendingKind] = useState(restored.current?.kind)
    const kind: Kind = KINDS.find(k => k.key === (params.get('kind') ?? pendingKind))?.key ?? 'main'
    useLayoutEffect(() => { if (pendingKind && !params.get('kind')) setKind(pendingKind) }, []) // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { if (pendingKind && (params.get('kind') ?? 'main') === pendingKind) setPendingKind(undefined) }, [params, pendingKind])
    const rememberList = () => { saved = { scroll: mainRef.current?.scrollTop ?? 0, kind, search } }
    // Công thức của topping (topping_ingredients) — chỉ tải khi đang xem Topping.
    const [toppingIngs, setToppingIngs] = useState<Record<string, Row[]>>({})
    const toppingKey = toppings.map(t => t.id).join('|')
    useEffect(() => {
        if (kind !== 'topping') return
        let cancelled = false
        fetchToppingIngredients(toppings.map(t => t.id)).then(m => { if (!cancelled) setToppingIngs(m as Record<string, Row[]>) })
        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [kind, toppingKey])
    // Nút + tạo đúng loại đang lọc (kind); createOpen = đang mở form tạo.
    const [createOpen, setCreateOpen] = useState(false)
    const [showImportModal, setShowImportModal] = useState(false)
    // {mode:'create'} | {mode:'edit', id} — modal tạo/sửa mục (divider phân nhóm menu)
    const [dividerModal, setDividerModal] = useState<{ mode: 'create' } | { mode: 'edit'; id: string } | null>(null)
    const [dividerName, setDividerName] = useState('')

    const mainRef = useRef<HTMLElement>(null)

    // Fetch fresh data on mount to avoid showing stale localStorage cache.
    // ponytail: mount-only — refreshProducts already refetches on address change via
    // its own effect in ProductContext; adding it here would double-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { refreshProducts?.({ ifStale: true }) }, [])

    // Khôi phục vị trí cuộn khi back từ trang chi tiết. Topping chỉ cao đủ sau khi tải công thức của chúng (toppingIngs) → đợi rồi mới cuộn,
    // kẻo bị kẹp về trên cùng.
    const restoreScroll = useRef(restored.current?.scroll ?? null)
    const listReady = kind !== 'topping' || toppings.length === 0 || Object.keys(toppingIngs).length > 0
    useLayoutEffect(() => {
        if (restoreScroll.current === null || !listReady || !mainRef.current) return
        mainRef.current.scrollTop = restoreScroll.current
        restoreScroll.current = null
    }, [listReady])

    // PERF: index recipes by product_id ONCE.
    // Was: recipes.filter(...) called twice per product per render — O(N×M).
    // Now: single pass to build the Map, then O(1) lookups.
    const recipesByProduct = useMemo(() => groupRecipesByProduct(recipes || []), [recipes])

    // PERF: precompute cost per product. Was: productCost() recomputed per card per render.
    const costByProduct = useMemo(() => {
        const map = new Map<string, number>()
        for (const [pid, list] of recipesByProduct) {
            let sum = 0
            for (const r of list) sum += r.amount * (ingredientCosts[r.ingredient] || 0)
            map.set(pid, sum)
        }
        return map
    }, [recipesByProduct, ingredientCosts])

    const handleCreateProduct = (name: string, price: string) => withSaving('Tạo món mới', async () => {
        const parsedPrice = parseVNDInput(price)
        const newProd = await insertProduct(name, parsedPrice, addressId)
        if (newProd && addressId) {
            await upsertProductPrice(newProd.id, parsedPrice)
        }
        refreshProducts?.()
        setCreateOpen(false)
        showToast('Đã tạo món mới', 'success')
    })

    // Thành phẩm = 1 dòng products (is_batch) + 1 nguyên liệu cùng tên trong ingredient_costs: nhờ vậy nó tự hiện ở bộ chọn
    // nguyên liệu của công thức món và ở Kiểm kê. Công thức mẻ là các dòng recipes của chính dòng products đó.
    const handleCreateBatch = (name: string, unit: string, batchYield: number) => withSaving('Tạo thành phẩm', async () => {
        const key = normalizeIngredientKey(name)
        if (key in ingredientCosts) { showToast(`Đã có nguyên liệu "${name}"`, 'warning'); return }
        await insertProduct(name, 0, addressId, false, batchYield)
        await upsertIngredientCost(key, 0, addressId, unit, { category: 'main' })
        // Vào sẵn nhóm "Bán thành phẩm/Topping" của địa chỉ nếu có (khớp theo tên); không có → Chưa phân nhóm.
        const group = ingredientGroups?.find(g => g.section === 'main' && normalizeSearchText(g.name).includes('thanh pham'))
        if (group && addressId) await setIngredientsGroup([key], addressId, group.id)
        refreshProducts?.()
        setCreateOpen(false)
        showToast('Đã tạo thành phẩm', 'success')
    })

    // insertTopping tự đăng ký luôn nguyên liệu cùng tên để topping hiện ở Kiểm kê.
    const handleCreateTopping = (name: string, price: number, unit: string) => withSaving('Tạo topping', async () => {
        await insertTopping(name, price, addressId, unit)
        refreshProducts?.()
        setCreateOpen(false)
        showToast('Đã tạo topping', 'success')
    })

    function editDivider(divider: Row) {
        setDividerName(divider.name)
        setDividerModal({ mode: 'edit', id: divider.id })
    }

    function saveDivider() {
        const name = dividerName.trim()
        const modal = dividerModal
        if (!name || !modal) return
        return withSaving('Lưu danh mục', async () => {
            if (modal.mode === 'create') await insertProduct(name, 0, addressId, true)
            else await updateProductName(modal.id, name)
            refreshProducts?.()
            setDividerModal(null)
            showToast(modal.mode === 'create' ? 'Đã tạo danh mục' : 'Đã đổi tên danh mục', 'success')
        })
    }

    function deleteDivider() {
        if (dividerModal?.mode !== 'edit') return
        const { id } = dividerModal
        return withSaving('Xóa danh mục', async () => {
            await removeProductFromAddress(id, addressId)
            refreshProducts?.()
            setDividerModal(null)
            showToast('Đã xóa danh mục', 'success')
        })
    }

    // Thả tay = commit luôn (không có bước "Lưu sắp xếp" riêng). Optimistic update
    // trước, rollback về thứ tự cũ nếu lưu server lỗi.
    // Props lấy từ dữ liệu đã index sẵn, chung cho cả 4 chỗ vẽ ProductCard.
    const cardProps = (p: Row) => ({
        product: p,
        prodRecipes: recipesByProduct.get(p.id) || [],
        cost: costByProduct.get(p.id) || 0,
        ingredientUnits,
    })

    // Kéo-thả: bấm giữ 1 món/danh mục rồi kéo (chuột: kéo luôn). Các mục KHÔNG nhích chỗ khi kéo —
    // lưới 2 cột lẫn danh mục rộng gấp đôi làm animation "nhường chỗ" của dnd-kit tính sai — mà chỉ
    // sáng viền ô đích; thả tay = commit luôn, rollback nếu lưu server lỗi.
    // Bấm giữ (thay vì có tay nắm nhỏ) để vuốt thường vẫn cuộn trang.
    const sensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    )
    const [activeId, setActiveId] = useState<string | null>(null)
    const [overId, setOverId] = useState<string | null>(null)
    // Danh mục là 1 HÀNG ngang nên chỉ được rơi vào ranh giới giữa các hàng, không chen giữa 2 card
    // cùng hàng: thả lên card nào thì tính theo cả hàng 2 ô chứa card đó (rowOf), đích là đầu hàng
    // (kéo lên) hoặc cuối hàng (kéo xuống).
    const activeProduct = activeId ? orderedProducts.find(p => p.id === activeId) : null
    const activeIsDivider = !!activeProduct?.is_divider
    function rowOf(id: string) {
        const items = sections.find(s => s.items.some(p => p.id === id))?.items
        if (!items) return [id]
        const start = items.findIndex(p => p.id === id) & ~1
        return items.slice(start, start + 2).map(p => p.id)
    }
    async function handleDragEnd({ active, over }: DragEndEvent) {
        setActiveId(null)
        setOverId(null)
        if (!over || active.id === over.id) return
        const from = orderedProducts.findIndex(p => p.id === active.id)
        let overKey = String(over.id)
        if (activeIsDivider) {
            const row = rowOf(overKey)
            const down = from < orderedProducts.findIndex(p => p.id === overKey)
            overKey = down ? row[row.length - 1] : row[0]
        }
        const to = orderedProducts.findIndex(p => p.id === overKey)
        const updated = [...orderedProducts]
        const [moved] = updated.splice(from, 1)
        updated.splice(to, 0, moved)
        const previous = orderedProducts
        setOrderedProducts(updated)
        try {
            await updateProductSortOrder(updated.map(p => p.id))
            refreshProducts?.()
        } catch (err) {
            setOrderedProducts(previous)
            showError(err, 'Lưu thứ tự món')
        }
    }

    const sections = useMemo(() => groupBySections(orderedProducts), [orderedProducts])
    // Ô đang là đích: kéo danh mục thì sáng cả hàng chứa card đích.
    const litIds = new Set(!overId || overId === activeId ? [] : activeIsDivider ? rowOf(overId) : [overId])
    const realProducts = useMemo(() => orderedProducts.filter(p => !p.is_divider), [orderedProducts])
    // Chip lọc theo mục: mỗi divider 1 chip; món đứng trước mục đầu tiên gom vào 'none'. Không có mục nào → ẩn dropdown.
    const categoryChips = useMemo(() => {
        if (!sections.some(s => s.divider)) return []
        return sections
            .filter(s => s.divider || s.items.length > 0)
            .map(s => s.divider
                ? { id: s.divider.id, label: s.divider.name, count: s.items.length }
                : { id: 'none', label: 'Chưa phân danh mục', count: s.items.length })
    }, [sections])
    const effectiveFilter = categoryChips.some(c => c.id === categoryFilter) ? categoryFilter : 'all'
    // Lọc danh mục nào thì hiện divider danh mục đó kèm các món thuộc nó.
    const visibleSections = useMemo(
        () => effectiveFilter === 'all' ? sections : sections.filter(s => (s.divider?.id ?? 'none') === effectiveFilter),
        [sections, effectiveFilter]
    )
    // Tab Công thức: tìm theo tên món (không phân biệt hoa/thường & dấu).
    const searchByName = (list: Row[]) => {
        const q = normalizeSearchText(search.trim())
        return q ? list.filter(p => normalizeSearchText(p.name).includes(q)) : list
    }
    const searchedProducts = useMemo(() => searchByName(realProducts), [realProducts, search]) // eslint-disable-line react-hooks/exhaustive-deps
    const searchedBatches = useMemo(() => searchByName(batchProducts), [batchProducts, search]) // eslint-disable-line react-hooks/exhaustive-deps
    const searchedToppings = useMemo(() => searchByName(toppings), [toppings, search]) // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div className="flex flex-col h-full max-w-lg mx-auto bg-bg relative">
            <Toast toast={toast} />

            {canEdit && !isGuest && (
                <NoticeBar
                    icon={<BadgePercent size={15} className="text-primary shrink-0" />}
                    label={DISCOUNT_TAB.label}
                    count={(discountPrograms || []).filter(p => p.enabled).length}
                    onClick={() => navigate(`/category/${DISCOUNT_TAB.key}`, { state: location.state })}
                />
            )}

            <MenuPageHeader
                title="Danh mục"
                count={realProducts.length}
                unitLabel="món"
                subtitle={(view === 'overall' && (categoryChips.length > 0 || canEdit)) ? (
                    <Dropdown
                        ariaLabel="Lọc theo danh mục"
                        value={effectiveFilter}
                        triggerLabel={effectiveFilter === 'all' ? `${realProducts.length} công thức` : categoryChips.find(c => c.id === effectiveFilter)?.label}
                        onChange={setCategoryFilter}
                        items={[
                            // Đang xem tất cả thì nút đã ghi "Tổng cộng …" — không lặp lại trong danh sách.
                            ...(effectiveFilter === 'all' ? [] : [{ value: 'all', label: 'Tổng cộng', count: `${realProducts.length} công thức`, divider: false }]),
                            ...categoryChips.map(c => ({ value: c.id, label: c.label, count: `${c.count} công thức` })),
                            ...(canEdit ? [{ action: 'create', icon: <Plus size={14} />, label: 'Tạo danh mục', divider: true, onClick: () => { setDividerName(''); setDividerModal({ mode: 'create' }) } }] : []),
                        ]}
                        align="center"
                        className="max-w-full"
                        triggerClassName="mt-1 gap-1 pl-5 text-[11px] leading-4 text-text/80 uppercase tabular-nums"
                    />
                ) : undefined}
                onBack={() => goToMenuStep('recipes', -1, { navigate, backTo, wizard: location.state?.wizard })}
                onForward={() => goToMenuStep('recipes', +1, { navigate, backTo, wizard: location.state?.wizard })}
                tabs={RECIPE_TABS}
                activeTab={view}
                onTabSelect={setView}
                hintTab={hintCafeDen && view !== 'recipes' ? 'recipes' : undefined}
            />

            <main ref={mainRef} className="flex-1 overflow-y-auto px-4 py-4 pb-8 space-y-3 bg-bg">
                {view === 'recipes' && (
                    <div className="flex items-stretch gap-2 h-11">
                        <Dropdown
                            ariaLabel="Lọc loại công thức"
                            value={kind}
                            triggerLabel={KINDS.find(k => k.key === kind)!.label}
                            onChange={setKind}
                            items={KINDS.filter(k => k.key !== 'batch' || !isGuest).map(k => ({ value: k.key, label: k.label, count: { main: realProducts.length, batch: batchProducts.length, topping: toppings.length }[k.key] }))}
                            align="left"
                            className="shrink-0"
                            panelClassName="min-w-[13rem]"
                            triggerClassName="h-11 px-3 rounded-[12px] bg-surface border border-border/60 text-text-secondary text-[12px] font-black uppercase tracking-widest hover:bg-surface-light"
                        />
                        <div className="relative flex-1 min-w-0">
                            <input
                                type="text"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder={`Tìm ${KINDS.find(k => k.key === kind)!.label.toLowerCase()}…`}
                                className={`w-full h-full pl-3 ${canEdit ? 'pr-12' : 'pr-3'} rounded-[12px] bg-surface border border-border/60 text-text text-[14px] placeholder:text-text-dim focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20`}
                            />
                            {canEdit && (
                                <button
                                    onClick={() => setCreateOpen(true)}
                                    aria-label={`Tạo ${KINDS.find(k => k.key === kind)!.label.toLowerCase()}`}
                                    className="absolute right-1 top-1 bottom-1 w-9 rounded-[8px] flex items-center justify-center active:scale-95 transition-all bg-primary text-bg hover:bg-primary/90"
                                >
                                    <Plus size={18} />
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {view === 'recipes' ? (
                    <div className="grid grid-cols-2 gap-3">
                        {kind === 'topping' ? searchedToppings.map(t => (
                            <ProductCard
                                key={t.id}
                                product={t}
                                prodRecipes={(toppingIngs[t.id] || []) as never}
                                cost={(toppingIngs[t.id] || []).reduce((sum, r) => sum + r.amount * (ingredientCosts[r.ingredient] || 0), 0)}
                                ingredientUnits={ingredientUnits}
                                priceLabel="Giá cộng thêm"
                                onClick={() => { rememberList(); navigate(`/category/toppings/${t.id}`, { state: location.state }) }}
                            />
                        )) : (kind === 'batch' ? searchedBatches : searchedProducts).map(product => (
                            <ProductCard
                                key={product.id}
                                {...cardProps(product)}
                                onClick={() => {
                                    rememberList()
                                    navigate(`/category/recipes/${product.id}`, { state: location.state })
                                }}
                                hint={kind === 'main' && product.id === hintCafeDenId}
                            />
                        ))}
                        {(kind === 'topping' ? searchedToppings : kind === 'batch' ? searchedBatches : searchedProducts).length === 0 && (
                            <p className="col-span-2 text-text-secondary text-[13px] text-center py-6">
                                {search.trim() ? 'Không tìm thấy kết quả nào.' : { main: 'Chưa có công thức nào.', batch: 'Chưa có bán thành phẩm nào (nước cốt, trân châu nấu…).', topping: 'Chưa có topping nào (ví dụ: Trân châu, Kem muối...).' }[kind]}
                            </p>
                        )}
                    </div>
                ) : (
                    <DndContext
                        sensors={sensors}
                        collisionDetection={collision}
                        onDragStart={({ active }) => setActiveId(String(active.id))}
                        onDragOver={({ over }) => setOverId(over ? String(over.id) : null)}
                        onDragCancel={() => { setActiveId(null); setOverId(null) }}
                        onDragEnd={handleDragEnd}
                    >
                        <div className="flex flex-col gap-3">
                            {canSort && (
                                <p className="text-[12px] text-text-secondary text-center -mb-1">Bấm giữ một món hoặc danh mục rồi kéo để sắp xếp</p>
                            )}
                            {visibleSections.map((section, si) => (
                                <Fragment key={section.divider?.id ?? `_first_${si}`}>
                                    {section.divider && (
                                        <DragRow id={section.divider.id} enabled={canSort} lit={litIds.has(section.divider.id)}>
                                            <MenuDivider
                                                name={section.divider.name}
                                                onClick={canEdit ? () => editDivider(section.divider!) : undefined}
                                            />
                                        </DragRow>
                                    )}
                                    {section.items.length > 0 && (
                                        <div className="grid grid-cols-2 gap-3">
                                            {section.items.map(product => (
                                                <DragRow key={product.id} id={product.id} enabled={canSort} lit={litIds.has(product.id)}>
                                                    <ProductCard {...cardProps(product)} dragHandle={canSort ? <GripVertical size={18} className="shrink-0 text-text-secondary/70" aria-hidden /> : undefined} sortMode />
                                                </DragRow>
                                            ))}
                                        </div>
                                    )}
                                </Fragment>
                            ))}
                        </div>
                        <DragOverlay>
                            {activeProduct && (activeProduct.is_divider ? (
                                <div className="opacity-90 w-[calc(100vw-2rem)] max-w-[28rem]"><MenuDivider name={activeProduct.name} /></div>
                            ) : (
                                <div className="opacity-90 rotate-2 shadow-2xl shadow-black/40 rounded-[1.5rem]">
                                    <ProductCard {...cardProps(activeProduct)} sortMode />
                                </div>
                            ))}
                        </DragOverlay>
                    </DndContext>
                )}
            </main>

            {createOpen && (
                <BottomSheet onClose={() => !saving && setCreateOpen(false)} panelClassName={SHEET_PANEL}>
                    <SheetHeader
                        title={{ main: 'Tạo món chính', batch: 'Tạo bán thành phẩm', topping: 'Tạo topping' }[kind]}
                        onClose={() => setCreateOpen(false)}
                        closeDisabled={saving}
                    />
                    {kind === 'main' && (
                        <>
                            <CreateProductForm saving={saving} onSubmit={handleCreateProduct} />
                            <button
                                onClick={() => { setCreateOpen(false); setShowImportModal(true) }}
                                className="text-[13px] text-primary/80 hover:text-primary font-medium text-center"
                            >
                                hoặc Nhập hàng loạt từ Excel →
                            </button>
                        </>
                    )}
                    {kind === 'batch' && (
                        <>
                            <p className="text-[13px] text-text-secondary -mt-2">Làm từ nguyên liệu theo mẻ (nước cốt, trân châu nấu…), có tồn riêng và dùng được trong công thức món.</p>
                            <CreateBatchForm saving={saving} onSubmit={handleCreateBatch} />
                        </>
                    )}
                    {kind === 'topping' && (
                        <>
                            <p className="text-[13px] text-text-secondary -mt-2">Thêm vào món khi bán, tính thêm tiền; tồn đếm ở Kiểm kê.</p>
                            <CreateToppingForm saving={saving} onSubmit={handleCreateTopping} />
                        </>
                    )}
                </BottomSheet>
            )}

            {showImportModal && <Suspense fallback={null}><ExcelImportModal onClose={() => setShowImportModal(false)} /></Suspense>}

            {dividerModal && (
                <BottomSheet
                    onClose={() => !saving && setDividerModal(null)}
                    panelClassName={SHEET_PANEL}
                >
                        <SheetHeader title={dividerModal.mode === 'create' ? 'Tạo danh mục' : 'Sửa danh mục'} onClose={() => setDividerModal(null)} closeDisabled={saving} />
                        <p className="text-[13px] text-text-secondary -mt-2">Danh mục là dòng tiêu đề ——— tên ——— để phân nhóm menu trên trang bán hàng.</p>
                        <input
                            autoFocus
                            value={dividerName}
                            onChange={e => setDividerName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveDivider() }}
                            disabled={saving}
                            placeholder="Tên danh mục (vd: Cà phê, Trà, Đồ ăn thêm)"
                            className="w-full px-4 py-3 rounded-[12px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-50"
                        />
                        <div className="flex gap-2">
                            {dividerModal.mode === 'edit' && (
                                <button
                                    onClick={deleteDivider}
                                    disabled={saving}
                                    className="flex-1 py-3 rounded-[12px] bg-danger-soft text-danger font-black text-[14px] active:scale-95 transition-all disabled:opacity-50"
                                >
                                    Xóa danh mục
                                </button>
                            )}
                            <button
                                onClick={saveDivider}
                                disabled={saving || !dividerName.trim()}
                                className="flex-1 py-3 rounded-[12px] bg-primary text-bg font-black text-[14px] hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50"
                            >
                                {dividerModal.mode === 'create' ? 'Tạo danh mục' : 'Lưu'}
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
