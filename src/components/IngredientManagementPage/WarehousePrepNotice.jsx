import { useState, useEffect } from 'react'
import { Package } from 'lucide-react'
import { useAddress } from '../../contexts/AddressContext'
import { useAuth } from '../../contexts/AuthContext'
import { useStats } from '../../contexts/StatsContext'
import { useHistory } from '../../contexts/HistoryContext'
import { useProducts } from '../../contexts/ProductContext'
import { useWarehousePrep } from '../../hooks/usePrepNotice'
import { processIngredientRestock } from '../../services/orderService'
import { fetchCashClosedToday } from '../../services/reportService'
import { getIngredientUnit } from '../../utils/ingredients'
import { pack2Of } from '../../utils/inventory'
import NoticeBar from '../common/NoticeBar'
import NoticeSheet from '../common/NoticeSheet'
import ShiftPrepCard from '../DailyReportPage/ShiftPrepCard'
import RestockModal from './RestockModal'
import Toast from '../POSPage/Toast'

// Dải notice "Bổ sung tồn kho" ở đỉnh /inventory (Tồn kho): NVL/bao bì cần MUA thêm để đủ bán ngày
// mai (target = max(dự báo mai, tồn tối thiểu) − tổng tồn kho + quầy). Bấm → danh sách "Mua N …", bấm
// dòng mở RestockModal (cùng form Nhập kho của trang chi tiết). Mua đủ thì món tự rớt khỏi danh sách.
// Chỉ chủ/quản lý (nhập kho là thao tác ghi chi phí + kho); guest/offline ẩn như dải ở /pos.
export default function WarehousePrepNotice({ onRestocked }) {
    const { isGuest, isManager, isAdmin } = useAuth()
    const { selectedAddress } = useAddress()
    const { isOnline } = useStats()
    return (isManager || isAdmin) && !isGuest && isOnline && selectedAddress?.id ? <Notice onRestocked={onRestocked} /> : null
}

function Notice({ onRestocked }) {
    const { selectedAddress } = useAddress()
    const { profile } = useAuth()
    const { ingredientUnits, refreshProducts } = useProducts()
    const { refreshTodayExpenses } = useHistory()
    const { items, ready, ingredientsList, warehouseStocks, reload, toast } = useWarehousePrep()
    const pendingCount = items.length
    const [open, setOpen] = useState(false)
    const [restock, setRestock] = useState(null) // { ingredient, qty }
    const [cashClosedToday, setCashClosedToday] = useState(false)

    // Phân loại dòng tiền đúng (trước/sau chốt két) — refetch mỗi lần mở form nhập kho.
    useEffect(() => {
        if (!restock) return
        let alive = true
        fetchCashClosedToday(selectedAddress.id).then(v => { if (alive) setCashClosedToday(!!v) })
        return () => { alive = false }
    }, [restock, selectedAddress.id])

    if (pendingCount === 0 && !open && !restock) return null
    const cfg = restock && (ingredientsList || []).find(i => i.ingredient === restock.ingredient)

    return (
        <>
            {pendingCount > 0 && (
                <NoticeBar
                    icon={<Package size={15} className="text-primary shrink-0" />}
                    label="Bổ sung tồn kho"
                    count={pendingCount}
                    onClick={ready ? () => setOpen(true) : undefined} // số từ ảnh chụp: chờ tính xong mới mở form nhập kho
                />
            )}
            <Toast toast={toast} />

            {open && !restock && (
                <NoticeSheet
                    icon={<Package size={18} className="text-primary shrink-0" />}
                    title="Bổ sung tồn kho"
                    count={pendingCount}
                    onClose={() => setOpen(false)}
                >
                    <ShiftPrepCard
                        packVerb="Mua"
                        haveLabel="Tồn quầy cuối ca"
                        emptyTitle="Kho tổng đủ cho mai!"
                        emptyHint="Không cần đi chợ đắp thêm cho ngày mai."
                        items={items}
                        onRestock={(ingredient, qty) => setRestock({ ingredient, qty: qty > 0 ? qty : null })}
                    />
                </NoticeSheet>
            )}

            {restock && (
                <RestockModal
                    ingredient={restock.ingredient}
                    unit={getIngredientUnit(restock.ingredient, ingredientUnits[restock.ingredient])}
                    packSize={cfg?.pack_size}
                    packUnit={cfg?.pack_unit}
                    pack2={pack2Of(cfg)}
                    initialQty={restock.qty}
                    cashClosedToday={cashClosedToday}
                    onClose={() => setRestock(null)}
                    onConfirm={async ({ ingredient: ing, qty, subtotal, discount, extraCost, paid, paymentMethod, cashPhase, purchaseDate }) => {
                        const wh = (warehouseStocks || {})[ing]
                        const result = await processIngredientRestock(selectedAddress.id, ing, qty, profile?.name, {
                            subtotal, discount, extraCost, paid, paymentMethod, cashPhase, purchaseDate,
                            ...(wh != null ? { beforeStock: wh } : {}),
                        })
                        // Kho đổi → tươi lại: danh sách của hook, context sản phẩm/chi phí, và list tồn của trang cha.
                        await Promise.all([reload(), refreshProducts?.(), refreshTodayExpenses?.(), onRestocked?.()])
                        return result
                    }}
                />
            )}
        </>
    )
}
