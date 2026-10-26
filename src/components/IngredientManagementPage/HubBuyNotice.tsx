import { useState, useMemo } from 'react'
import { Package } from 'lucide-react'
import { useAddress } from '../../contexts/AddressContext'
import { useAuth } from '../../contexts/AuthContext'
import { useProducts } from '../../contexts/ProductContext'
import { useHistory } from '../../contexts/HistoryContext'
import { useGroupPrep } from '../../hooks/useGroupPrep'
import { useCashClosedToday } from '../../hooks/useCashClosedToday'
import { processIngredientRestock } from '../../services/orderService'
import { buildHubBuyItems } from '../../utils/hubBuy'
import { lookupByLabel } from '../../utils/ingredients'
import { pack2Of, type UsageMap } from '../../utils/inventory'
import NoticeBar from '../common/NoticeBar'
import NoticeSheet, { SheetBody } from '../common/NoticeSheet'
import ShiftPrepCard from '../DailyReportPage/ShiftPrepCard'
import RestockModal from './RestockModal'

// "Bổ sung tồn kho" của KHO TỔNG trong nhóm kho chung (thay cho bản tính riêng từng địa chỉ — vốn sai khi cả nhóm dùng chung 1 kho),
// cùng giao diện card "Mua" như bản thường: cần mua = tồn tối thiểu + tổng dự báo rút ngày mai của MỌI địa chỉ trong nhóm − kho còn,
// làm tròn LÊN theo đơn vị nhập lớn nhất. Tính khi mở (~5 request × số địa chỉ) chứ không tính sẵn lúc vào trang.
export default function HubBuyNotice({ onRestocked }: { onRestocked?: () => unknown }) {
    const { selectedAddress, siblingsByAddress } = useAddress()
    const [open, setOpen] = useState(false)
    if (!selectedAddress?.id) return null
    return (
        <>
            <NoticeBar icon={<Package size={15} className="text-primary shrink-0" />} label="Bổ sung tồn kho" onClick={() => setOpen(true)} />
            {open && (
                <Sheet addressId={selectedAddress.id} addresses={[selectedAddress, ...(siblingsByAddress[selectedAddress.id] ?? [])]} onClose={() => setOpen(false)} onRestocked={onRestocked} />
            )}
        </>
    )
}

// Bản trong trang Tồn kho: lấy số liệu + các hàm làm tươi từ context của địa chỉ đang chọn.
function Sheet({ addressId, addresses: all, onClose, onRestocked }: { addressId: string; addresses: { id?: string | null; name: string }[]; onClose: () => void; onRestocked?: () => unknown }) {
    const { refreshProducts } = useProducts()
    const { refreshTodayExpenses } = useHistory()
    const addresses = useMemo(() => all.map(a => ({ id: a.id!, name: a.name })), [all])
    const prep = useGroupPrep(addresses)
    const items = buildHubBuyItems(prep)
    return (
        <NoticeSheet icon={<Package size={18} className="text-primary shrink-0" />} title="Bổ sung tồn kho" count={prep.plan ? items.length : ''} onClose={onClose}>
            <HubBuyBody addressId={addressId} prep={prep} onAfterRestock={() => Promise.all([refreshProducts?.(), refreshTodayExpenses?.(), onRestocked?.()])} />
        </NoticeSheet>
    )
}

export type Prep = ReturnType<typeof useGroupPrep>

// Phần danh sách "Mua" + phiếu Nhập kho, không kèm khung sheet — nhúng được vào chỗ khác (vd. dòng mở rộng ở /addresses).
export function HubBuyBody({ addressId, prep, bought, minAsFloor, skipped, onSkip, onOpenIngredient, onAfterRestock }: { addressId: string; prep: Prep; bought?: UsageMap; minAsFloor?: boolean; skipped?: Record<string, boolean>; onSkip?: (ingredient: string) => void; onOpenIngredient?: (ingredient: string) => void; onAfterRestock?: () => unknown }) {
    const { profile } = useAuth()
    const { plan, pool, cfgOf, error, reload } = prep
    const [restock, setRestock] = useState<{ ingredient: string; qty: number | null } | null>(null)
    const cashClosedToday = useCashClosedToday(addressId, !!restock)
    const items = useMemo(() => buildHubBuyItems({ plan, cfgOf, pool }, bought, minAsFloor), [plan, cfgOf, pool, bought, minAsFloor])
    const cfg = restock ? cfgOf[restock.ingredient] : undefined

    return (
        <>
            <SheetBody error={error} loading={!plan} onRetry={reload}>
                <ShiftPrepCard
                    packVerb="Mua"
                    threeFields
                    skipped={skipped}
                    onSkip={onSkip}
                    onOpen={onOpenIngredient}
                    haveLabel="Cả nhóm rút ngày mai"
                    emptyTitle="Kho tổng đủ cho mai!"
                    emptyHint="Không cần đi chợ đắp thêm cho ngày mai."
                    items={items}
                    onRestock={(ingredient, qty) => setRestock({ ingredient, qty: qty > 0 ? qty : null })}
                />
            </SheetBody>
            {restock && (
                <RestockModal
                    ingredient={restock.ingredient}
                    unit={cfg?.unit || 'đv'}
                    packSize={cfg?.pack_size}
                    packUnit={cfg?.pack_unit}
                    pack2={pack2Of(cfg)}
                    initialQty={restock.qty}
                    cashClosedToday={cashClosedToday}
                    onClose={() => setRestock(null)}
                    onConfirm={async ({ ingredient: ing, qty, subtotal, discount, extraCost, paid, paymentMethod, cashPhase, purchaseDate }) => {
                        const wh = lookupByLabel<number | null>(ing, pool, null)
                        const result = await processIngredientRestock(addressId, ing, qty, profile?.name ?? null, {
                            subtotal, discount, extraCost, paid, paymentMethod, cashPhase, purchaseDate,
                            ...(wh != null ? { beforeStock: wh } : {}),
                        })
                        // Kho đổi → tươi lại số kho nhóm, giá vốn (context sản phẩm), chi phí hôm nay và list tồn của trang cha.
                        await Promise.all([reload(), onAfterRestock?.()])
                        return result
                    }}
                />
            )}
        </>
    )
}
