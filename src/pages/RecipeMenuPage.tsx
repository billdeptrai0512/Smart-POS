import { useState, useEffect, useLayoutEffect, useMemo, useRef, Fragment, lazy, Suspense, type ReactNode } from 'react'
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { Plus, Trash2, GripVertical, FileSpreadsheet, Search } from 'lucide-react'
import {
    type DragEndEvent,
    DndContext, DragOverlay, MouseSensor, TouchSensor,
    closestCenter, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type CollisionDetection,
} from '@dnd-kit/core'
import { BottomSheet, SheetHeader, SHEET_PANEL } from '../components/common/ModalShell'
import MenuDivider from '../components/common/MenuDivider'
import Dropdown from '../components/common/Dropdown'
import { normalizeSearchText, normalizeIngredientKey, sortIngredients, getIngredientUnit } from '../utils/ingredients'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { upsertProductPrice, insertProduct, updateProductSortOrder, updateProductName, removeProductFromAddress, upsertIngredientCost, setIngredientsGroup } from '../services/orderService'
import { parseVNDInput } from '../utils'
import { useToast } from '../hooks/useToast'
import { useSavingAction } from '../hooks/useSavingAction'
import { useConfirm } from '../contexts/ConfirmContext'
import Toast from '../components/POSPage/Toast'
import MenuPageHeader from '../components/common/MenuPageHeader'
import ProductCard from '../components/RecipeMenuPage/ProductCard'
import CreateProductForm from '../components/RecipeMenuPage/CreateProductForm'
import CreateBatchForm from '../components/RecipeMenuPage/CreateBatchForm'
import CreateToppingForm from '../components/RecipeMenuPage/CreateToppingForm'
import { insertTopping, fetchToppingIngredients, toppingSourcesOf, type ToppingSource } from '../services/toppingService'
import { goToMenuStep } from '../utils/menuSequence'
import { idsWithProductIn } from '../utils/categoryOrder'
import type { Row } from '../types/domain'
import { groupRecipesByProduct } from '../utils/inventory'

// ponytail: kéo theo xlsx (~430 kB) — chỉ tải khi bấm "Nhập Excel", không phải lúc mở /category.
const ExcelImportModal = lazy(() => import('../components/RecipeMenuPage/ExcelImportModal'))

// Module-level cache của màn danh sách (cuộn + loại đang lọc + danh mục + ô tìm). Ghi khi bấm 1 thẻ để vào trang chi tiết;
// dùng 1 lần ở lần mount kế (back) rồi xoá, để vào từ route khác thì bắt đầu từ đầu. Cùng kiểu /inventory/stocking.
let saved: { scroll: number; kind: string; search: string; categoryFilter: string } | null = null

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
            className={`select-none [-webkit-touch-callout:none] rounded-[1.25rem] ${isDragging ? 'opacity-30' : lit ? 'ring-2 ring-primary' : ''}`}
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
    const { products, batchProducts, toppings, recipes, ingredientCosts, ingredientUnits, ingredientGroups, refreshProducts, loading } = useProducts()
    const { addressId, selectedAddress } = useAddress()
    const { isManager, isAdmin, isGuest } = useAuth()
    const canEdit = isManager || isAdmin

    // Chỉ Admin được sắp xếp menu mặc định (chưa chọn địa chỉ) — giống rule cũ của saveSortOrder.
    const canSort = canEdit && !!(addressId || isAdmin)
    const { toast, showToast, showError } = useToast()

    const { saving, withSaving } = useSavingAction(showError)
    const confirm = useConfirm()
    // Bản sao local để phản hồi ngay khi thả tay, trước khi round-trip lưu server xong.
    const [orderedProducts, setOrderedProducts] = useState(products)
    useEffect(() => { setOrderedProducts(products) }, [products])
    // Một danh sách duy nhất (/category/overall và /category/recipes cùng trang); chạm món → trang chi tiết.
    // Lọc danh mục: 'all' | 'none' (món chưa thuộc mục nào) | id của mục (divider). Id lạ (mục đã xoá) rơi về 'all'.
    const [categoryFilter, setCategoryFilter] = useState(() => saved?.categoryFilter ?? 'all')
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
    const rememberList = () => { saved = { scroll: mainRef.current?.scrollTop ?? 0, kind, search, categoryFilter } }
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
    // Topping có nguồn tồn kho (source_*) → công thức = đúng 1 dòng nguồn (nguồn thay hẳn topping_ingredients, như lúc trừ kho); không thì topping_ingredients.
    const toppingRows = (t: Row): Row[] => t.source_ingredient
        ? toppingSourcesOf([t as never])[t.id] as Row[]
        : toppingIngs[t.id] || []
    // Nút + tạo đúng loại đang lọc (kind); createOpen = đang mở form tạo.
    const [createOpen, setCreateOpen] = useState(false)
    const [showImportModal, setShowImportModal] = useState(false)
    // {mode:'create'} | {mode:'edit', id} — modal tạo/sửa mục (divider phân nhóm menu)
    const [manageOpen, setManageOpen] = useState(false)
    const [newCategory, setNewCategory] = useState('')
    // ponytail: trạng thái thu gọn chỉ trong phiên, không lưu; lưu localStorage nếu cần nhớ.
    const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
    const toggleCollapsed = (id: string) => setCollapsedIds(prev => {
        const next = new Set(prev)
        if (!next.delete(id)) next.add(id)
        return next
    })

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


    const openDetail = (id: string) => { rememberList(); navigate(`/category/recipes/${id}`, { state: location.state }) }

    const handleCreateProduct = (name: string, price: string, categoryId: string) => withSaving('Tạo món mới', async () => {
        const parsedPrice = parseVNDInput(price)
        const newProd = await insertProduct(name, parsedPrice, addressId)
        if (newProd && addressId) {
            await upsertProductPrice(newProd.id, parsedPrice)
        }
        // Món mới luôn vào đầu danh sách (sort_order nhỏ nhất) → chọn danh mục thì dời xuống cuối mục đó.
        const ids = newProd && categoryId ? idsWithProductIn(orderedProducts, newProd.id, categoryId) : null
        if (ids) await updateProductSortOrder(ids)
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
        await upsertIngredientCost(key, 0, addressId, unit, { category: 'main', displayName: name })
        // Vào sẵn nhóm "Bán thành phẩm/Topping" của địa chỉ nếu có (khớp theo tên); không có → Chưa phân nhóm.
        const group = ingredientGroups?.find(g => g.section === 'main' && normalizeSearchText(g.name).includes('thanh pham'))
        if (group && addressId) await setIngredientsGroup([key], addressId, group.id)
        refreshProducts?.()
        setCreateOpen(false)
        showToast('Đã tạo thành phẩm', 'success')
    })

    // Có nguồn → topping chỉ trỏ vào nguồn, không tạo tồn riêng. Không nguồn (mua sẵn, đếm theo phần) → insertTopping tạo
    // tồn cùng tên và topping trỏ vào chính nó 1 đv/phần: mọi topping bán ra đều trừ đúng 1 nguồn.
    const handleCreateTopping = (name: string, price: number, unit: string, source: ToppingSource | null) => withSaving('Tạo topping', async () => {
        const key = normalizeIngredientKey(name)
        // Trùng tên nguyên liệu / thành phẩm có sẵn → dùng luôn dòng đó, không ghi đè giá vốn.
        if (!source && !(key in ingredientCosts)) await upsertIngredientCost(key, 0, addressId, unit, { displayName: name })
        await insertTopping(name, price, addressId, source ?? { ingredient: key, amount: 1 })
        refreshProducts?.()
        setCreateOpen(false)
        showToast('Đã tạo topping', 'success')
    })

    // Quản lý danh mục (divider): đổi tên khi rời ô, xóa (món trong danh mục dồn xuống danh mục trên), thêm mới.
    // Bộ saving riêng (không phủ overlay cả trang); đợi refresh xong mới báo để dòng và toast khớp nhau.
    const { saving: catSaving, withSaving: withCatSaving } = useSavingAction(showError)
    const [removingId, setRemovingId] = useState<string | null>(null)
    const seenCategoryIds = useRef(new Set<string>()) // dòng chưa có lúc mở sheet → chạy hiệu ứng bung ra
    const runCategory = async (label: string, done: string, fn: () => Promise<unknown>) => {
        let ok = false
        await withCatSaving(label, async () => { await fn(); await refreshProducts?.(); showToast(done, 'success'); ok = true })
        return ok
    }
    const renameCategory = (d: Row, name: string) => {
        name = name.trim()
        if (name && name !== d.name) runCategory('Đổi tên danh mục', 'Đã đổi tên danh mục', () => updateProductName(d.id, name))
    }
    const removeCategory = async (d: Row, count: number) => {
        if (!await confirm({
            title: `Xóa danh mục "${d.name}"?`,
            detail: count > 0 ? `${count} món trong danh mục sẽ chuyển về danh mục phía trên.` : undefined,
            danger: true, confirmLabel: 'Xóa',
        })) return
        setRemovingId(d.id) // thu gọn dòng ngay, không đợi mạng
        await runCategory('Xóa danh mục', 'Đã xóa danh mục', () => removeProductFromAddress(d.id, addressId))
        setRemovingId(null)
    }
    const addCategory = () => {
        const name = newCategory.trim()
        if (!name) return
        setNewCategory('')
        // Dòng mới luôn xuống cuối menu (insertProduct đặt ở đầu → sẽ gom hết món chưa phân vào nó). Lỗi → trả lại tên đã gõ.
        runCategory('Tạo danh mục', 'Đã tạo danh mục', async () => {
            const created = await insertProduct(name, 0, addressId, true)
            if (created) await updateProductSortOrder([...orderedProducts.map(p => p.id).filter(id => id !== created.id), created.id])
        }).then(ok => { if (!ok) setNewCategory(cur => cur || name) })
    }
    const openManage = () => {
        seenCategoryIds.current = new Set(sections.flatMap(s => s.divider ? [s.divider.id] : []))
        setManageOpen(true)
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
                : { id: 'none', label: 'Không thuộc danh mục', count: s.items.length })
    }, [sections])
    const effectiveFilter = categoryChips.some(c => c.id === categoryFilter) ? categoryFilter : 'all'
    // Lọc danh mục nào thì hiện divider danh mục đó kèm các món thuộc nó.
    const visibleSections = useMemo(
        () => effectiveFilter === 'all' ? sections : sections.filter(s => (s.divider?.id ?? 'none') === effectiveFilter),
        [sections, effectiveFilter]
    )
    // Tìm theo tên món (không phân biệt hoa/thường & dấu).
    const searchByName = (list: Row[]) => {
        const q = normalizeSearchText(search.trim())
        return q ? list.filter(p => normalizeSearchText(p.name).includes(q)) : list
    }
    const searchedProducts = useMemo(() => searchByName(realProducts), [realProducts, search]) // eslint-disable-line react-hooks/exhaustive-deps
    const searchedBatches = useMemo(() => searchByName(batchProducts), [batchProducts, search]) // eslint-disable-line react-hooks/exhaustive-deps
    const searchedToppings = useMemo(() => searchByName(toppings), [toppings, search]) // eslint-disable-line react-hooks/exhaustive-deps

    const kindCounts = { main: realProducts.length, batch: batchProducts.length, topping: toppings.length }
    // Đang tìm: lọc ngay trong các danh mục, tắt kéo-thả và thu gọn.
    const searching = !!search.trim()
    const matched = new Set(searchedProducts.map(p => p.id))
    const shownSections = searching
        ? visibleSections.map(s => ({ ...s, items: s.items.filter(p => matched.has(p.id)) })).filter(s => s.items.length > 0)
        : visibleSections
    const dragEnabled = canSort && !searching

    return (
        <div className="flex flex-col h-full max-w-lg lg:max-w-none mx-auto bg-bg relative">
            <Toast toast={toast} />

            <MenuPageHeader
                title="Thực đơn"
                subtitle={
                    <Dropdown
                        ariaLabel="Chọn loại"
                        value={kind}
                        triggerLabel={KINDS.find(k => k.key === kind)!.label}
                        onChange={setKind}
                        items={KINDS.filter(k => k.key !== 'batch' || !isGuest).map(k => ({ value: k.key, label: k.label, count: kindCounts[k.key] }))}
                        align="center"
                        className="max-w-full"
                        panelClassName="min-w-[13rem]!"
                        triggerClassName="mt-1 gap-1 pl-5 text-[11px] leading-4 text-text/80 uppercase tabular-nums"
                    />
                }
                onBack={() => goToMenuStep('recipes', -1, { navigate, backTo, wizard: location.state?.wizard })}
                onForward={() => goToMenuStep('recipes', +1, { navigate, backTo, wizard: location.state?.wizard })}
            >
                    <div className="flex items-stretch gap-2 h-11">
                        {kind === 'main' && categoryChips.length > 0 && (
                            <Dropdown
                                ariaLabel="Lọc theo danh mục"
                                value={effectiveFilter}
                                triggerLabel={effectiveFilter === 'all' ? 'Tất cả' : categoryChips.find(c => c.id === effectiveFilter)?.label}
                                onChange={setCategoryFilter}
                                items={[
                                    { value: 'all', label: 'Tất cả', count: `${realProducts.length} món` },
                                    ...categoryChips.map((c, i) => ({ value: c.id, label: c.label, count: `${c.count} món`, divider: i === 0 })),
                                ]}
                                align="left"
                                className="shrink-0 max-w-[9rem]"
                                triggerClassName="h-11 gap-1 px-3 rounded-[12px] bg-surface border border-border/60 text-[12px] font-black uppercase text-text"
                            />
                        )}
                        <div className="relative flex-1 min-w-0">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none" />
                            <input
                                type="text"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                aria-label={`Tìm ${KINDS.find(k => k.key === kind)!.label.toLowerCase()}`}
                                className={`w-full h-full pl-9 ${canEdit ? 'pr-11' : 'pr-3'} rounded-[12px] bg-surface border border-border/60 text-text text-[14px] focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20`}
                            />
                            {canEdit && (
                                <button
                                    onClick={() => setShowImportModal(true)}
                                    aria-label="Nhập hàng loạt từ Excel"
                                    title="Nhập hàng loạt từ Excel"
                                    className="absolute right-1 top-1 bottom-1 w-9 rounded-[8px] flex items-center justify-center active:scale-95 transition-all text-text-secondary hover:text-primary"
                                >
                                    <FileSpreadsheet size={18} />
                                </button>
                            )}
                        </div>
                    </div>
            </MenuPageHeader>

            <main ref={mainRef} className="flex-1 overflow-y-auto overflow-x-hidden px-4 pt-4 pb-24 bg-bg lg:px-8"><div className="space-y-3 lg:space-y-4 lg:max-w-[1280px] lg:mx-auto">
                {kind === 'main' && !loading && canEdit && realProducts.length === 0 && (
                    <p className="text-text-secondary text-[13px] text-center py-6 px-4">
                        Thực đơn đang trống. Bấm nút + để thêm món đầu tiên, rồi giữ và kéo để sắp xếp; bấm “Quản lý” ở ô Danh mục trong form thêm món để chia nhóm menu.
                    </p>
                )}

                {kind !== 'main' ? (
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                        {kind === 'topping' ? searchedToppings.map(t => (
                            <ProductCard
                                key={t.id}
                                product={t}
                                prodRecipes={toppingRows(t) as never}
                                cost={toppingRows(t).reduce((sum, r) => sum + r.amount * (ingredientCosts[r.ingredient] || 0), 0)}
                                ingredientUnits={ingredientUnits}
                                priceLabel="Giá cộng thêm"
                                onClick={() => { rememberList(); navigate(`/category/recipes/${t.id}`, { state: location.state }) }}
                            />
                        )) : searchedBatches.map(product => (
                            <ProductCard
                                key={product.id}
                                {...cardProps(product)}
                                onClick={() => openDetail(product.id)}
                            />
                        ))}
                        {!loading && (kind === 'topping' ? searchedToppings : searchedBatches).length === 0 && (
                            <p className="col-span-full text-text-secondary text-[13px] text-center py-6">
                                {search.trim() ? 'Không tìm thấy kết quả nào.' : { batch: 'Chưa có bán thành phẩm nào (nước cốt, trân châu nấu…).', topping: 'Chưa có topping nào (ví dụ: Trân châu, Kem muối...).' }[kind]}
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
                            {shownSections.map((section, si) => (
                                <Fragment key={section.divider?.id ?? `_first_${si}`}>
                                    {section.divider && (
                                        <DragRow id={section.divider.id} enabled={dragEnabled} lit={litIds.has(section.divider.id)}>
                                            <MenuDivider
                                                name={section.divider.name}
                                                onClick={canEdit ? openManage : undefined}
                                                collapsed={!searching && collapsedIds.has(section.divider.id)}
                                                onToggle={() => toggleCollapsed(section.divider!.id)}
                                            />
                                        </DragRow>
                                    )}
                                    {section.items.length > 0 && !(!searching && section.divider && collapsedIds.has(section.divider.id)) && (
                                        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                                            {section.items.map(product => (
                                                <DragRow key={product.id} id={product.id} enabled={dragEnabled} lit={litIds.has(product.id)}>
                                                    <ProductCard {...cardProps(product)} onClick={() => openDetail(product.id)} dragHandle={dragEnabled ? <GripVertical size={18} className="shrink-0 text-text-secondary/70" aria-hidden /> : undefined} sortMode />
                                                </DragRow>
                                            ))}
                                        </div>
                                    )}
                                </Fragment>
                            ))}
                        </div>
                        <DragOverlay>
                            {activeProduct && (activeProduct.is_divider ? (
                                <div className="w-[calc(100vw-2rem)] max-w-[28rem] rounded-[1.5rem] bg-surface px-4 py-1 ring-2 ring-primary shadow-2xl shadow-black/40"><MenuDivider name={activeProduct.name} /></div>
                            ) : (
                                <div className="rotate-2 shadow-2xl shadow-black/40 rounded-[1.5rem] ring-2 ring-primary">
                                    <ProductCard {...cardProps(activeProduct)} sortMode />
                                </div>
                            ))}
                        </DragOverlay>
                    </DndContext>
                )}
            </div>
            </main>

            {canEdit && (
                <div className="fixed bottom-0 left-0 right-0 max-w-lg lg:max-w-[1280px] mx-auto pointer-events-none z-50">
                    <div className="flex justify-end px-4 lg:px-8 pb-[max(env(safe-area-inset-bottom),16px)] [@media(display-mode:standalone)]:pb-[max(env(safe-area-inset-bottom),28px)] pointer-events-auto">
                        <button
                            onClick={() => setCreateOpen(true)}
                            aria-label={`Tạo ${KINDS.find(k => k.key === kind)!.label.toLowerCase()}`}
                            className="bg-primary rounded-[12px] px-4 py-2.5 flex items-center justify-center text-bg hover:bg-primary/90 active:scale-95 transition-all shadow-sm"
                        >
                            <Plus size={18} />
                        </button>
                    </div>
                </div>
            )}

            {createOpen && (
                <BottomSheet onClose={() => !saving && setCreateOpen(false)} panelClassName={SHEET_PANEL}>
                    <SheetHeader
                        title={{ main: 'Tạo món chính', batch: 'Tạo bán thành phẩm', topping: 'Tạo topping' }[kind]}
                        onClose={() => setCreateOpen(false)}
                        closeDisabled={saving}
                    />
                    {kind === 'main' && <CreateProductForm saving={saving} categories={categoryChips.filter(c => c.id !== 'none')} defaultCategory={effectiveFilter === 'all' || effectiveFilter === 'none' ? '' : effectiveFilter} onManageCategories={openManage} onSubmit={handleCreateProduct} />}
                    {kind === 'batch' && (
                        <>
                            <p className="text-[13px] text-text-secondary">Làm từ nguyên liệu theo mẻ (nước cốt, trân châu nấu…), có tồn riêng và dùng được trong công thức món.</p>
                            <CreateBatchForm saving={saving} onSubmit={handleCreateBatch} />
                        </>
                    )}
                    {kind === 'topping' && (
                        <>
                            <p className="text-[13px] text-text-secondary">Thêm vào món khi bán, tính thêm tiền; tồn lấy từ nguồn bạn chọn hoặc đếm tay ở Kiểm kê.</p>
                            <CreateToppingForm
                                saving={saving}
                                sourceOptions={isGuest ? [] : Object.keys(ingredientCosts).sort((a, b) => sortIngredients(a, b, selectedAddress?.ingredient_sort_order))}
                                unitOf={k => getIngredientUnit(k, ingredientUnits?.[k], ingredientUnits)}
                                onSubmit={handleCreateTopping}
                            />
                        </>
                    )}
                </BottomSheet>
            )}

            {showImportModal && <Suspense fallback={null}><ExcelImportModal onClose={() => setShowImportModal(false)} /></Suspense>}

            {manageOpen && (
                <BottomSheet onClose={() => setManageOpen(false)} panelClassName={SHEET_PANEL}>
                    <SheetHeader title="Danh mục" onClose={() => setManageOpen(false)} />
                    {sections.filter(s => s.divider).map(s => (
                        <div
                            key={s.divider!.id}
                            className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${seenCategoryIds.current.has(s.divider!.id) ? '' : 'category-row-enter'} ${removingId === s.divider!.id ? 'opacity-0' : ''}`}
                            style={{ gridTemplateRows: removingId === s.divider!.id ? '0fr' : '1fr' }}
                        >
                        <div className="flex items-center gap-2 overflow-hidden min-h-0">
                            <input
                                defaultValue={s.divider!.name}
                                onBlur={e => { if (e.target.value.trim()) renameCategory(s.divider!, e.target.value); else e.target.value = s.divider!.name }}
                                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                                aria-label={`Tên danh mục ${s.divider!.name}`}
                                className="flex-1 min-w-0 h-10 px-3 rounded-[10px] bg-bg border border-border/60 text-text text-[14px] focus:outline-none focus:border-primary/60"
                            />
                            <span className="shrink-0 h-10 px-3 rounded-[10px] border border-border/60 text-[13px] font-bold text-text-secondary flex items-center tabular-nums">{s.items.length} món</span>
                            <button
                                onClick={() => removeCategory(s.divider!, s.items.length)}
                                aria-label={`Xóa danh mục ${s.divider!.name}`}
                                className="shrink-0 w-10 h-10 flex items-center justify-center rounded-[10px] text-danger hover:bg-danger/10"
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                        </div>
                    ))}
                    <div className="flex items-center gap-2">
                        <input
                            value={newCategory}
                            onChange={e => setNewCategory(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') addCategory() }}
                            placeholder="Tên danh mục mới"
                            className="flex-1 min-w-0 h-10 px-3 rounded-[10px] bg-bg border border-border/60 text-text text-[14px] focus:outline-none focus:border-primary/60"
                        />
                        <button
                            onClick={addCategory}
                            disabled={catSaving || !newCategory.trim()}
                            className="shrink-0 h-10 px-4 rounded-[10px] bg-primary text-bg text-[13px] font-black disabled:opacity-50"
                        >
                            Thêm
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
