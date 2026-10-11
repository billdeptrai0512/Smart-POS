import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, type MouseEvent } from 'react'
import { withCounterEstimate, recipesBelongTo } from '../services/counterEstimate'
import { useCounterCalc } from '../hooks/useCounterCalc'
import { useNavigate, useLocation } from 'react-router-dom'
import { Plus, Settings2 } from 'lucide-react'
import { BottomSheet, SheetHeader } from '../components/common/ModalShell'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import {
    upsertIngredientCost,
    syncIngredientKey, setIngredientsGroup,
    fetchIngredientStocks, fetchIngredientDeficits, fetchIngredientDailyContext,
} from '../services/orderService'
import { sortIngredients, ingredientLabel, normalizeSearchText, getIngredientUnit, normalizeIngredientKey } from '../utils/ingredients'
import { netStockOf, pack2Of, isLowStockOf } from '../utils/inventory'
import { readJSON, writeJSON } from '../utils/storage'
import IngredientCostItem from '../components/IngredientManagementPage/IngredientCostItem'
import KeySyncModal from '../components/IngredientManagementPage/KeySyncModal'
import StockDeficitBanner from '../components/IngredientManagementPage/StockDeficitBanner'
import KeyMismatchBanner from '../components/IngredientManagementPage/KeyMismatchBanner'
import MenuPageHeader from '../components/common/MenuPageHeader'
import WarehousePrepNotice from '../components/IngredientManagementPage/WarehousePrepNotice'
import GroupPrepNotice from '../components/IngredientManagementPage/GroupPrepNotice'
import Dropdown from '../components/common/Dropdown'
import Skeleton from '../components/common/Skeleton'
import CreateIngredientForm from '../components/IngredientManagementPage/CreateIngredientForm'
import IngredientGroupsSheet from '../components/IngredientManagementPage/IngredientGroupsSheet'
import { detectKeyMismatches } from '../utils/ingredientKeySync'
import { useToast } from '../hooks/useToast'
import { useConfirm } from '../contexts/ConfirmContext'
import Toast from '../components/POSPage/Toast'
import { keySyncDismissedKey, orphanIgnoredKey } from '../constants/storageKeys'
import { goToMenuStep } from '../utils/menuSequence'
import { INGREDIENT_TABS } from '../constants/menuTabs'
import InventoryAuditTab from '../components/IngredientManagementPage/InventoryAuditTab'
import { useEntitlement } from '../hooks/useEntitlement'
import { useDateScope } from '../hooks/useDateScope'
import { useTabRoute } from '../hooks/useTabRoute'
import { calcRangeWithPrev } from '../utils/rangeCalc'
import { dateStringVN, dateShortVN, dateFullVN } from '../utils/dateVN'
import { DateRangePicker } from '../components/HistoryPage/HistoryHeader'
import { useOnboardingProgressPersist } from '../hooks/useOnboardingProgressPersist'
import { findCoffeeIngredient, nextIngredientSetupField } from '../utils/onboardingHint'
import { isRecipeProgressDone, isInventoryProgressDone } from '../utils/onboardingStorage'
import { isRecipeStepActive } from '../components/common/onboarding/steps'
import { useOnboardingProgress } from '../hooks/useOnboardingProgress'
import type { IngredientConfig, Row } from '../types/domain'
import type { StockDeficit } from '../components/IngredientManagementPage/StockDeficitBanner'

// Module-level cache { scroll, groupFilter, search }. Set when user opens a card to drill into
// /inventory/stocking/:key; consumed once on next mount of /inventory (back nav).
// Mirrors the /category pattern so back-from-detail lands at the same list + scroll
// position the user left.
let saved: { scroll: number; groupFilter: string; search: string } | null = null

export default function IngredientManagementPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const {
        ingredientCosts: contextCosts, ingredientUnits: contextUnits,
        recipes: contextRecipes, products: contextProducts, ingredientConfigs,
        productExtras: contextProductExtras, extraIngredients: contextExtraIngs,
        ingredientGroups, refreshProducts,
    } = useProducts()
    const { addressId, selectedAddress, siblingsByAddress } = useAddress()
    const warehouseSiblings = addressId ? siblingsByAddress[addressId] : null
    // Khoá theo id (không theo mảng/đối tượng): `siblingsByAddress` và `selectedAddress` đổi tham chiếu mỗi lần addresses refetch,
    // mà groupAddressIds là dep của loadStocks (quét deficits toàn lịch sử) — đổi tham chiếu = tải lại cả trang.
    const hasAddress = !!selectedAddress
    const siblingKey = (warehouseSiblings || []).map(a => a.id).join(',')
    const groupAddressIds = useMemo(
        () => hasAddress ? [addressId, ...(siblingKey ? siblingKey.split(',') : [])] : [null],
        [hasAddress, addressId, siblingKey]
    )
    const { isManager, isAdmin, profile, isGuest } = useAuth()
    const { toast, showToast, showError } = useToast()
    const confirm = useConfirm()
    const canEdit = isManager || isAdmin

    const [ingredientCosts, setIngredientCosts] = useState(contextCosts || {})
    const [ingredientUnits, setIngredientUnits] = useState(contextUnits || {})
    const [saving, setSaving] = useState(false)

    // Create form
    const [newName, setNewName] = useState('')
    const [newUnit, setNewUnit] = useState('')

    const [newGroupId, setNewGroupId] = useState('')
    const [showCreateModal, setShowCreateModal] = useState(false)

    // Search theo tên — không phân biệt hoa/thường & dấu tiếng Việt.
    const [search, setSearch] = useState(saved?.search ?? '')

    // Lọc theo nhóm: 'all' | 'none' (chưa phân nhóm) | group id. Id lạ (nhóm đã xoá) tự rơi về 'all' qua effectiveFilter.
    const [groupFilter, setGroupFilter] = useState(saved?.groupFilter ?? 'all')
    const [showGroupsSheet, setShowGroupsSheet] = useState(false)

    // Tab nằm trên URL: /inventory/management = Kiểm kê (hôm nay / ngày cũ / hao hụt theo kỳ), /inventory/stocking = Lưu trữ.
    const [view, setView] = useTabRoute('/inventory')
    // Kiểm kê thuộc gói báo cáo (cùng gate với Báo cáo trước đây): chưa có gói thì rơi về Tồn lưu trữ,
    // bấm tab Kiểm kê mới dẫn tới trang đăng ký.
    const { hasAccess, loading: entitlementLoading, enabled: monetizationEnabled } = useEntitlement()
    const auditLocked = monetizationEnabled && !entitlementLoading && !hasAccess
    const activeView = auditLocked ? 'stocking' : view
    // Mô tả thay đổi Kiểm kê chưa lưu (null = sạch) — InventoryAuditTab báo lên để chặn rời trang.
    const [unsavedKey, setUnsavedKey] = useState<string | null>(null)
    // Chọn ngày của Kiểm kê (hôm nay / ngày cũ / tuần / tháng / tuỳ chọn) nằm ở header như trang Báo cáo.
    const dateScope = useDateScope()
    const { scope: dScope, offset: dOffset, customRange: dCustom } = dateScope
    const dateRange = useMemo(() => calcRangeWithPrev(dScope, dOffset, dCustom), [dScope, dOffset, dCustom])

    const mainRef = useRef<HTMLElement>(null)

    // Restore scroll on back nav from /inventory/stocking/:key; clear cache after use.
    // Chỉ áp khi danh sách đã vẽ thật (stocksLoaded) — lúc mount mới chỉ có skeleton, scroll bị kẹp về 0.
    const restoreScrollRef = useRef(saved?.scroll ?? null)
    useEffect(() => { saved = null }, [])

    const openIngredient = (ingredient: string) => {
        saved = { scroll: mainRef.current?.scrollTop ?? 0, groupFilter, search }
        navigate(`/inventory/stocking/${ingredient}`, { state: location.state })
    }

    // Stock & modals
    const [ingredientStocks, setIngredientStocks] = useState<Row[]>([])
    // Chưa có số tồn thì chưa vẽ danh sách — vẽ sớm rồi sắp xếp lại (hết/sắp hết lên đầu) làm người dùng rối.
    const [stocksLoaded, setStocksLoaded] = useState(false)
    useLayoutEffect(() => {
        if (!stocksLoaded || restoreScrollRef.current === null || !mainRef.current) return
        mainRef.current.scrollTop = restoreScrollRef.current
        restoreScrollRef.current = null
    }, [stocksLoaded])
    const [showKeySync, setShowKeySync] = useState(false)
    const [dismissedSig, setDismissedSig] = useState('')
    const [stockDeficits, setStockDeficits] = useState<StockDeficit[]>([])
    const [dailyContext, setDailyContext] = useState<Record<string, Row>>({})

    // Filter recipes to only those referencing currently active products.
    // Without this, dead recipes for soft-deleted products show as false-positive orphans.
    const liveRecipes = useMemo(() => {
        const activeIds = new Set((contextProducts || []).map(p => p.id))
        return (contextRecipes || []).filter(r => activeIds.has(r.product_id))
    }, [contextRecipes, contextProducts])

    // Filter extra-ingredients to only those owned by extras of CURRENTLY ACTIVE products.
    // Soft-deleted products may keep their extras + extra_ingredients rows; we shouldn't flag
    // those as user-fixable orphans (they're effectively dead data).
    const liveExtraIngredients = useMemo(() => {
        const activeExtraIds = new Set<string>()
        for (const list of Object.values(contextProductExtras || {})) {
            for (const e of list || []) activeExtraIds.add(e.id)
        }
        const filtered: typeof contextExtraIngs = {}
        for (const [extraId, list] of Object.entries(contextExtraIngs || {})) {
            if (activeExtraIds.has(extraId)) filtered[extraId] = list
        }
        return filtered
    }, [contextProductExtras, contextExtraIngs])

    // Per-address list of orphan keys the user has explicitly silenced. Loaded
    // from localStorage; filters orphan*Keys out of the mismatch result entirely
    // so the banner clears and the modal stops listing them.
    const [ignoredOrphans, setIgnoredOrphans] = useState(() => new Set<string>())
    useEffect(() => {
        if (!selectedAddress) { setIgnoredOrphans(new Set()); return }
        setIgnoredOrphans(new Set(readJSON(orphanIgnoredKey(addressId), [])))
    }, [selectedAddress, addressId])

    const handleIgnoreOrphan = (key: string) => {
        if (!selectedAddress) return
        setIgnoredOrphans(prev => {
            const next = new Set(prev)
            next.add(key)
            writeJSON(orphanIgnoredKey(addressId), [...next]) // full/disabled storage → in-memory only
            return next
        })
    }

    const handleAssignOrphan = async (oldKey: string, newKey: string) => {
        if (!oldKey || !newKey || oldKey === newKey) return
        if (!addressId) throw new Error('Cần chọn một địa chỉ cụ thể (không áp dụng cho Mẫu mặc định)')
        await syncIngredientKey(addressId, oldKey, newKey)
        await Promise.all([loadStocks(), refreshProducts?.()])
    }

    const keyMismatches = useMemo(
        () => detectKeyMismatches({
            recipes: liveRecipes,
            ingredientCosts,
            inventoryReport: ingredientStocks,
            extraIngredients: liveExtraIngredients,
            ignoredKeys: ignoredOrphans,
        }),
        [liveRecipes, ingredientCosts, ingredientStocks, liveExtraIngredients, ignoredOrphans]
    )

    // Signature of current mismatches — used to detect when dismissed warning should re-surface.
    const mismatchSig = useMemo(() => {
        if (!keyMismatches.hasIssues) return ''
        const parts = [
            ...keyMismatches.orphanRecipeKeys.map(k => `r:${k}`),
            ...keyMismatches.orphanInventoryKeys.map(k => `i:${k}`),
            ...(keyMismatches.orphanExtraIngredientKeys || []).map(k => `e:${k}`),
            ...keyMismatches.labelCollisions.map(c => `c:${c.keys.join('|')}`),
        ]
        return parts.sort().join(',')
    }, [keyMismatches])

    useEffect(() => {
        if (!selectedAddress) { setDismissedSig(''); return }
        try { setDismissedSig(localStorage.getItem(keySyncDismissedKey(addressId)) || '') }
        catch { setDismissedSig('') }
    }, [selectedAddress, addressId])

    const isDismissed = mismatchSig !== '' && dismissedSig === mismatchSig

    const handleDismissBanner = (e: MouseEvent) => {
        e.stopPropagation()
        if (!selectedAddress || !mismatchSig) return
        try {
            localStorage.setItem(keySyncDismissedKey(addressId), mismatchSig)
            setDismissedSig(mismatchSig)
        } catch { /* localStorage may be full or disabled */ }
    }

    // ponytail: mount-only refresh — refreshProducts already refetches on address
    // change via its own effect in ProductContext; adding it here would double-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { refreshProducts?.({ ifStale: true }) }, [])

    const calcRef = useCounterCalc()
    // Công thức tải xong sau lần loadStocks đầu → tải lại một lần để số ước tính hiện ra (xem recipesBelongTo).
    const recipesReady = recipesBelongTo(contextRecipes, addressId)

    const loadStocks = useCallback(async () => {
        // addressId may be null for the default template — fetchIngredientStocks
        // handles that (queries rows with address_id IS NULL) so admins can manage stock on
        // the playground template too.
        // Tab Kiểm kê không dùng kết quả (tự tải tồn qua useShiftInventoryState) — chỉ tải khi ở Lưu trữ;
        // activeView trong deps nên chuyển sang tab Lưu trữ sẽ tự tải lại (cũng là bản tươi sau khi Kiểm kê lưu).
        if (!selectedAddress || activeView !== 'stocking') return
        // Deficits quét TOÀN BỘ lịch sử expenses + shift_closings (nặng nhất) mà chỉ phục vụ banner của quản lý
        // → không chặn danh sách: banner hiện sau, nhân viên thì khỏi tải.
        if (canEdit) fetchIngredientDeficits(groupAddressIds).then(d => setStockDeficits(d as StockDeficit[])).catch(err => console.error('fetchIngredientDeficits', err))
        const [stocks, daily] = await Promise.all([
            // Tồn quầy NVL chưa đếm hôm nay = ước tính theo lý thuyết (withCounterEstimate).
            fetchIngredientStocks(addressId).then(s => withCounterEstimate(s, addressId, calcRef.current)),
            fetchIngredientDailyContext(addressId),
        ])
        setIngredientStocks(stocks ?? [])
        setDailyContext(daily)
        // ponytail: deliberately keyed on id+name, not the whole object — selectedAddress
        // gets a new reference on every context refetch even when nothing relevant changed
        // (e.g. ingredient_sort_order edits), which would refire this on every such update.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [addressId, selectedAddress?.name, groupAddressIds, activeView, canEdit, recipesReady])
    useEffect(() => { loadStocks().finally(() => { if (activeView === 'stocking') setStocksLoaded(true) }) }, [loadStocks])

    useEffect(() => { setIngredientCosts(contextCosts) }, [contextCosts])
    useEffect(() => { setIngredientUnits(contextUnits || {}) }, [contextUnits])

    const allIngredients = useMemo(
        () => Object.keys(ingredientCosts).sort((a, b) => sortIngredients(a, b, selectedAddress?.ingredient_sort_order)),
        [ingredientCosts, selectedAddress?.ingredient_sort_order]
    )

    // PERF: index stocks by ingredient ONCE.
    // Was: ingredientStocks.find() in render per ingredient — O(N×M).
    const stockByIngredient = useMemo(() => {
        const map = new Map<string, Row>()
        for (const s of ingredientStocks) map.set(s.ingredient, s)
        return map
    }, [ingredientStocks])

    // Onboarding phase 6 (CUỐI CÙNG, "Cài đặt nguyên liệu") — hint thẻ "Cà phê" sau khi phase 5
    // (công thức) đã xong, cho tới khi đủ cả 4 việc (tồn kho cuối ngày/quy đổi/tồn kho tối
    // thiểu/khối lượng bì) — xem nextIngredientSetupField trong onboardingHint.ts.
    const recipeProgress = useOnboardingProgress('recipeProgress', { isGuest, addressId })
    const recipeDone = isRecipeProgressDone(recipeProgress)
    // Phase 5 (công thức) — từ /history mũi tên "tiến" giờ rơi vào Kiểm kê trước, nên sáng mũi tên "tiến" ở đây.
    // State (không chỉ đọc): InventoryAuditTab tick coffee/cacao khi bấm Lưu, hint mũi tên "tiến" phải tươi ngay.
    const storedInventoryProgress = useOnboardingProgress('inventoryProgress', { isGuest, addressId })
    const [inventoryProgress, setInventoryProgress] = useState(storedInventoryProgress)
    useOnboardingProgressPersist('inventoryProgress', inventoryProgress, { isGuest, addressId })
    const hintRecipesTab = isGuest && isRecipeStepActive(isInventoryProgressDone(inventoryProgress), recipeProgress)
    const coffeeConfig = useMemo(() => findCoffeeIngredient(ingredientConfigs) ?? null, [ingredientConfigs])
    const coffeeKey = coffeeConfig?.ingredient ?? null
    const hintCoffee = isGuest && recipeDone && !!coffeeKey
        && nextIngredientSetupField(coffeeConfig, stockByIngredient.get(coffeeKey)?.warehouse_stock_set) !== null

    // PERF: index configs by ingredient ONCE.
    // Was: ingredientConfigs.find() called THREE times per ingredient (packSize, packUnit, minStock).
    const configByIngredient = useMemo(() => {
        const map = new Map<string, IngredientConfig>()
        for (const c of ingredientConfigs || []) map.set(c.ingredient, c)
        return map
    }, [ingredientConfigs])

    const getStockPriority = useCallback((ing: string) => {
        const cfg = configByIngredient.get(ing)
        const stockRow = stockByIngredient.get(ing)
        const unit = getIngredientUnit(ing, ingredientUnits[ing])
        const stock = netStockOf(stockRow, cfg?.tare_weight, unit)
        if (stock !== null && stock <= 0) return 0        // hết
        if (stockRow && isLowStockOf(stockRow, { tareWeight: cfg?.tare_weight, minStock: cfg?.min_stock, minCounterStock: cfg?.min_counter_stock }, unit)) return 1  // sắp hết
        return 2                                          // bình thường
    }, [stockByIngredient, configByIngredient, ingredientUnits])

    // Một danh sách chung cho cả nguyên liệu chính và bao bì; nhóm của cả hai section nằm chung dropdown.
    // Trigger sync_ingredient_group_category giữ group_id luôn cùng section với category, nên group_id null ⇔ chưa phân nhóm.
    const canManage = !!(canEdit && ingredientGroups)
    const gidOf = useCallback((ing: string) => configByIngredient.get(ing)?.group_id || 'none', [configByIngredient])
    const { groupChips, countByGroup } = useMemo(() => {
        const countByGroup = new Map<string, number>()
        for (const ing of allIngredients) {
            const gid = gidOf(ing)
            countByGroup.set(gid, (countByGroup.get(gid) || 0) + 1)
        }
        const groups = ingredientGroups || [] // server đã sort theo sort_order, created_at
        const groupChips = groups.length === 0 ? [] : [
            ...groups.map(g => ({ id: g.id, label: g.name, count: countByGroup.get(g.id) || 0 })),
            ...(countByGroup.get('none') ? [{ id: 'none', label: 'Chưa phân nhóm', count: countByGroup.get('none') }] : []),
        ]
        return { groupChips, countByGroup }
    }, [ingredientGroups, allIngredients, gidOf])

    // Đang tìm kiếm → 'all' (tìm trong cả tab — người dùng thường không nhớ món nằm nhóm nào).
    const effectiveFilter = !search.trim() && groupChips.some(c => c.id === groupFilter) ? groupFilter : 'all'

    const visibleIngredients = useMemo(() => {
        const q = normalizeSearchText(search.trim())
        const filtered = allIngredients.filter(ing => {
            if (q) return normalizeSearchText(ingredientLabel(ing)).includes(q)
            return effectiveFilter === 'all' || gidOf(ing) === effectiveFilter
        })
        // Sort: hết (out) → sắp hết (low) → bình thường. Skip if no alerts.
        const hasAlerts = filtered.some(ing => getStockPriority(ing) < 2)
        if (!hasAlerts) return filtered
        return [...filtered].sort((a, b) => getStockPriority(a) - getStockPriority(b))
    }, [allIngredients, effectiveFilter, gidOf, getStockPriority, search])

    // ─── Action handlers ───────────────────────────────────────────────
    async function handleCreateIngredient() {
        if (!newName.trim()) return
        const key = normalizeIngredientKey(newName)
        const unit = newUnit || 'đv'
        setSaving(true)
        try {
            await upsertIngredientCost(key, 0, addressId, unit)
            // category (báo cáo "Mua bao bì" vs "Mua nguyên liệu") đi theo section của nhóm — trigger DB ép.
            if (newGroupId) {
                if (!addressId) throw new Error('Cần chọn một địa chỉ cụ thể (không áp dụng cho Mẫu mặc định)')
                await setIngredientsGroup([key], addressId, newGroupId)
            }
            setIngredientUnits(prev => ({ ...prev, [key]: unit }))
            // Refresh configs so the new ingredient picks up its category in `configByIngredient`.
            refreshProducts?.()
            setNewName(''); setNewUnit(''); setNewGroupId('')
            setShowCreateModal(false)
            showToast('Đã tạo nguyên liệu', 'success')
        } catch (err) {
            showError(err, 'Tạo nguyên liệu mới')
        } finally {
            setSaving(false)
        }
    }

    // Còn Kiểm kê chưa lưu → xác nhận trước khi rời tab/trang (liệt kê tối đa 5 dòng sắp mất).
    const guardLeave = async (proceed: () => void) => {
        if (unsavedKey !== null) {
            const lines = unsavedKey.split('\n').filter(Boolean)
            const list = lines.slice(0, 5).map(l => `• ${l}`).join('\n')
            const more = lines.length > 5 ? `\nvà ${lines.length - 5} mục khác…` : ''
            const detail = lines.length ? `${list}${more}\n\nRời trang và bỏ các thay đổi?` : 'Rời trang và bỏ các thay đổi?'
            if (!await confirm({ title: 'Còn thay đổi chưa lưu trong kiểm kê.', detail, danger: true, confirmLabel: 'Rời trang' })) return
        }
        proceed()
    }

    return (
        <div className="flex flex-col h-full max-w-lg mx-auto bg-bg relative">
            <Toast toast={toast} />

            <WarehousePrepNotice onRestocked={loadStocks} onOpenIngredient={openIngredient} />
            <GroupPrepNotice />

            <MenuPageHeader
                title="Tồn kho"
                count={visibleIngredients.length}
                unitLabel="loại"
                subtitle={activeView === 'management' ? (
                    <DateRangePicker
                        scope={dScope}
                        rangeLabel={dScope === 'week' || dScope === 'month' ? `${dateShortVN(dateRange.start)} – ${dateShortVN(dateRange.end)}` : dateFullVN(dateRange.start)}
                        rangeStartISO={dateStringVN(dateRange.start)}
                        rangeEndISO={dateStringVN(dateRange.end)}
                        dayInputValue={dateScope.dayInputValue}
                        customRange={dCustom}
                        todayISO={dateScope.todayISO}
                        canGoForwardDay={dateScope.canGoForwardDay}
                        canGoForward={dateScope.canGoForwardPeriod}
                        onPrevDay={() => guardLeave(dateScope.goPrevDay)}
                        onNextDay={() => guardLeave(dateScope.goNextDay)}
                        onOffsetPrev={() => guardLeave(dateScope.goOffsetPrev)}
                        onOffsetNext={() => guardLeave(dateScope.goOffsetNext)}
                        onRangeChange={(r) => guardLeave(() => dateScope.applyRange(r))}
                        onShiftRange={(d) => guardLeave(() => dateScope.shiftRange(d))}
                        canShiftRangeForward={dateScope.canShiftRangeForward}
                        onPresetSelect={(p) => guardLeave(() => dateScope.applyPreset(p))}
                    />
                ) : undefined}
                onBack={() => guardLeave(() => goToMenuStep('main', -1, { navigate, backTo: location.state?.from || '/history/sales', wizard: location.state?.wizard }))}
                onForward={() => guardLeave(() => goToMenuStep('main', +1, { navigate, backTo: location.state?.from || '/history/sales', wizard: location.state?.wizard }))}
                tabs={INGREDIENT_TABS}
                activeTab={activeView}
                onTabSelect={(key) => {
                    if (key === 'management' && auditLocked) { navigate('/subscription', { state: { preselectAddressId: addressId, from: '/inventory/management' } }); return }
                    guardLeave(() => setView(key))
                }}
                hintForward={hintRecipesTab}
            />

            <main ref={mainRef} className="flex-1 overflow-y-auto px-4 py-4 pb-8 bg-bg">
                {activeView === 'management' ? (
                    <InventoryAuditTab
                        dateScope={dateScope}
                        inventoryProgress={inventoryProgress}
                        setInventoryProgress={setInventoryProgress}
                        onUnsavedChange={setUnsavedKey}
                        showToast={showToast}
                        showError={showError}
                    />
                ) : (<>
                <div className="mb-3 flex items-stretch gap-2 h-11">
                    {(groupChips.length > 0 || canManage) && (
                        <Dropdown
                            ariaLabel="Lọc theo nhóm"
                            value={effectiveFilter}
                            triggerLabel={groupChips.find(c => c.id === effectiveFilter)?.label || 'Phân loại'}
                            onChange={(id) => { setGroupFilter(id); setSearch('') }}
                            items={[
                                ...(canManage ? [{ action: 'edit', icon: <Settings2 size={14} />, label: groupChips.length > 0 ? 'Quản lý' : 'Chia nhóm…', onClick: () => setShowGroupsSheet(true) }] : []),
                                ...groupChips.map((c, i) => ({ value: c.id, label: c.label, count: c.count, divider: canManage && i === 0 })),
                                { value: 'all', label: 'Tổng cộng', count: allIngredients.length, divider: true },
                            ]}
                            align="left"
                            className="shrink-0 w-[34%] max-w-[170px]"
                            triggerClassName="h-full px-3 rounded-[12px] bg-surface border border-border/60 text-[14px] hover:border-primary/40"
                        />
                    )}
                    <div className="relative flex-1 min-w-0">
                        <input
                            type="text"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Tìm nguyên liệu…"
                            className={`w-full h-full pl-3 ${canEdit ? 'pr-12' : 'pr-3'} rounded-[12px] bg-surface border border-border/60 text-text text-[14px] placeholder:text-text-dim focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20`}
                        />
                        {canEdit && (
                            <button
                                onClick={() => setShowCreateModal(true)}
                                aria-label="Tạo nguyên liệu"
                                className="absolute right-1 top-1 bottom-1 w-9 rounded-[8px] flex items-center justify-center active:scale-95 transition-all bg-primary text-bg hover:bg-primary/90"
                            >
                                <Plus size={18} />
                            </button>
                        )}
                    </div>
                </div>
                {canEdit && stockDeficits.length > 0 && (
                    <StockDeficitBanner
                        deficits={stockDeficits}
                        ingredientUnits={ingredientUnits}
                        configByIngredient={configByIngredient}
                        addressId={addressId}
                        staffName={profile?.name}
                        onResolved={() => loadStocks()}
                    />
                )}
                {canEdit && keyMismatches.hasIssues && !isDismissed && (
                    <KeyMismatchBanner
                        mismatches={keyMismatches}
                        onView={() => setShowKeySync(true)}
                        onDismiss={handleDismissBanner}
                    />
                )}

                <div className="flex flex-col gap-2.5">
                    {!stocksLoaded && [0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-[120px] rounded-[14px]" />)}
                    {stocksLoaded && visibleIngredients.map(ingredient => {
                        const cfg = configByIngredient.get(ingredient)
                        return (
                            <IngredientCostItem
                                key={ingredient}
                                ingredient={ingredient}
                                ingredientLabel={ingredientLabel}
                                getIngredientUnit={getIngredientUnit}
                                storedUnit={ingredientUnits[ingredient]}
                                canEdit={canEdit}
                                packSize={cfg?.pack_size}
                                packUnit={cfg?.pack_unit}
                                pack2={pack2Of(cfg)}
                                tareWeight={cfg?.tare_weight}
                                minStock={cfg?.min_stock}
                                minCounterStock={cfg?.min_counter_stock}
                                stockData={stockByIngredient.get(ingredient)}
                                dailyContext={dailyContext[ingredient]}
                                onOpen={openIngredient}
                                hint={hintCoffee && ingredient === coffeeKey}
                            />
                        )
                    })}
                    {stocksLoaded && visibleIngredients.length === 0 && (
                        <p className="text-text-secondary text-[13px] text-center py-6">
                            {search.trim()
                                ? 'Không tìm thấy nguyên liệu nào.'
                                : allIngredients.length === 0 ? 'Chưa có nguyên liệu nào.' : 'Chưa có nguyên liệu trong nhóm này.'}
                        </p>
                    )}
                </div>
                </>)}
            </main>

            {showCreateModal && (
                <BottomSheet
                    onClose={() => !saving && setShowCreateModal(false)}
                    panelClassName="w-full max-w-lg bg-surface rounded-t-[24px] border-t border-border/60 shadow-2xl p-5 pb-8 flex flex-col gap-4 animate-slide-up"
                >
                        <SheetHeader title="Tạo nguyên liệu mới" onClose={() => setShowCreateModal(false)} closeDisabled={saving} />
                        <CreateIngredientForm
                            name={newName}
                            unit={newUnit}
                            groupId={newGroupId}
                            groups={ingredientGroups}
                            saving={saving}
                            onNameChange={setNewName}
                            onUnitChange={setNewUnit}
                            onGroupChange={setNewGroupId}
                            onSubmit={handleCreateIngredient}
                        />
                </BottomSheet>
            )}

            {showGroupsSheet && addressId && (
                <IngredientGroupsSheet
                    groups={ingredientGroups ?? []}
                    countByGroup={countByGroup}
                    ingredients={allIngredients}
                    groupOf={gidOf}
                    addressId={addressId}
                    onChanged={() => refreshProducts?.()}
                    onError={showError}
                    onClose={() => setShowGroupsSheet(false)}
                />
            )}

            {saving && (
                <div className="fixed bottom-4 right-4 z-50 pointer-events-none">
                    <span className="text-text-secondary text-[11px] animate-pulse">Đang lưu...</span>
                </div>
            )}

            <KeySyncModal
                open={showKeySync}
                onClose={() => setShowKeySync(false)}
                mismatches={keyMismatches}
                recipes={liveRecipes}
                allRecipes={contextRecipes || []}
                products={contextProducts || []}
                productExtras={contextProductExtras || {}}
                extraIngredients={liveExtraIngredients}
                ingredientCosts={ingredientCosts}
                addressId={addressId}
                onIgnoreKey={handleIgnoreOrphan}
                onAssignKey={handleAssignOrphan}
                onComplete={async () => {
                    await Promise.all([loadStocks(), refreshProducts?.()])
                }}
            />
        </div>
    )
}
