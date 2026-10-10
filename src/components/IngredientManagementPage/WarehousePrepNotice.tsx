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
import RestockModal, { type RestockPayload } from './RestockModal'
import Toast from '../POSPage/Toast'

// Dải notice "Bổ sung tồn kho" ở đỉnh /inventory (Tồn kho): NVL/bao bì cần MUA thêm để đủ bán ngày
// mai (target = max(dự báo mai, tồn tối thiểu) − tổng tồn kho + quầy). Bấm → danh sách; nút "Mua N …"
// mở RestockModal (cùng form Nhập kho của trang chi tiết), bấm tên → trang chi tiết. Mua đủ thì món chuyển xuống đáy với viên "Đã mua N" (tiến độ x/y, vẫn hiện đến hết ngày).
// Chỉ chủ/quản lý (nhập kho là thao tác ghi chi phí + kho); guest/offline ẩn như dải ở /pos.
// Bấm tên nguyên liệu → sang trang chi tiết (trang cha unmount); cờ module này cho lần mount kế
// (back về /inventory) mở lại đúng bảng — cùng kiểu cache `saved` của IngredientManagementPage.
let reopenSheet = false

interface Props {
    onRestocked?: () => unknown
    onOpenIngredient?: (ingredient: string) => void
}

export default function WarehousePrepNotice({ onRestocked, onOpenIngredient }: Props) {
    const { isGuest, isManager, isAdmin } = useAuth()
    const { addressId, warehouseRole } = useAddress()
    const { isOnline } = useStats()
    // Nhóm đã có kho tổng: số "cần mua" của từng chi nhánh so riêng với CÙNG 1 kho chung nên sai — việc mua nằm ở trang Chia hàng.
    const groupedWithHub = warehouseRole === 'hub' || warehouseRole === 'member' || warehouseRole === 'pending'
    return (isManager || isAdmin) && !isGuest && isOnline && addressId && !groupedWithHub
        ? <Notice addressId={addressId} onRestocked={onRestocked} onOpenIngredient={onOpenIngredient} /> : null
}

function Notice({ addressId, onRestocked, onOpenIngredient }: Props & { addressId: string }) {
    const { profile } = useAuth()
    const { ingredientUnits, refreshProducts } = useProducts()
    const { refreshTodayExpenses } = useHistory()
    const { items, ready, ingredientsList, warehouseStocks, reload, toast } = useWarehousePrep()
    // Món đã mua đủ (done) vẫn nằm trong danh sách → đếm tiến độ "đã mua / tổng", mẫu số đứng yên suốt ngày.
    const total = items.length
    const doneCount = items.filter(it => it.done).length
    const progress = `${doneCount}/${total}`
    const [open, setOpen] = useState(reopenSheet)
    useEffect(() => { reopenSheet = false }, [])
    const [restock, setRestock] = useState<{ ingredient: string; qty: number | null } | null>(null)
    const [cashClosedToday, setCashClosedToday] = useState(false)

    // Phân loại dòng tiền đúng (trước/sau chốt két) — refetch mỗi lần mở form nhập kho.
    useEffect(() => {
        if (!restock) return
        let alive = true
        fetchCashClosedToday(addressId).then(v => { if (alive) setCashClosedToday(!!v) })
        return () => { alive = false }
    }, [restock, addressId])

    if (total === 0 && !open && !restock) return null
    const cfg = restock && (ingredientsList || []).find(i => i.ingredient === restock.ingredient)

    return (
        <>
            {total > 0 && (
                <NoticeBar
                    icon={<Package size={15} className="text-primary shrink-0" />}
                    label="Bổ sung tồn kho"
                    count={progress}
                    onClick={ready ? () => setOpen(true) : undefined} // số từ ảnh chụp: chờ tính xong mới mở form nhập kho
                />
            )}
            <Toast toast={toast} />

            {open && !restock && (ready || total > 0) && (
                <NoticeSheet
                    icon={<Package size={18} className="text-primary shrink-0" />}
                    title="Bổ sung tồn kho"
                    count={progress}
                    onClose={() => setOpen(false)}
                >
                    <ShiftPrepCard
                        packVerb="Mua"
                        haveLabel="Tồn quầy cuối ca"
                        emptyTitle="Kho tổng đủ cho mai!"
                        emptyHint="Không cần đi chợ đắp thêm cho ngày mai."
                        items={items}
                        onOpen={onOpenIngredient && (ingredient => { reopenSheet = true; onOpenIngredient(ingredient) })}
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
                    onConfirm={async ({ ingredient: ing, qty, subtotal, discount, extraCost, paid, paymentMethod, cashPhase, purchaseDate }: RestockPayload) => {
                        const wh = (warehouseStocks || {})[ing]
                        const result = await processIngredientRestock(addressId, ing, qty, profile?.name ?? null, {
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
