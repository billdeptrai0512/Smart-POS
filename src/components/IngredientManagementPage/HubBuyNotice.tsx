import { useState, useMemo } from 'react'
import { Package } from 'lucide-react'
import { useAddress } from '../../contexts/AddressContext'
import { useAuth } from '../../contexts/AuthContext'
import { useProducts } from '../../contexts/ProductContext'
import { useHistory } from '../../contexts/HistoryContext'
import { useGroupPrep } from '../../hooks/useGroupPrep'
import { useCashClosedToday } from '../../hooks/useCashClosedToday'
import { processIngredientRestock } from '../../services/orderService'
import { ceilToBigUnit, fmtQty } from '../../utils/warehouseTransfer'
import { byIngredientLabel, ingredientLabel, lookupByLabel } from '../../utils/ingredients'
import { pack2Of } from '../../utils/inventory'
import NoticeBar from '../common/NoticeBar'
import NoticeSheet from '../common/NoticeSheet'
import RestockModal from './RestockModal'

// "Bổ sung tồn kho" của KHO TỔNG trong nhóm kho chung (thay cho bản tính riêng từng địa chỉ — vốn sai khi cả nhóm dùng chung 1 kho):
// cần mua = tồn tối thiểu + tổng dự báo rút ngày mai của MỌI địa chỉ trong nhóm − kho còn, làm tròn LÊN theo đơn vị nhập lớn nhất.
// Tính khi mở (~5 request × số địa chỉ) chứ không tính sẵn lúc vào trang.
export default function HubBuyNotice({ onRestocked }: { onRestocked?: () => unknown }) {
    const { selectedAddress, siblingsByAddress } = useAddress()
    const [open, setOpen] = useState(false)
    const siblings = selectedAddress?.id ? siblingsByAddress[selectedAddress.id] : null
    if (!selectedAddress?.id) return null
    return (
        <>
            <NoticeBar icon={<Package size={15} className="text-primary shrink-0" />} label="Bổ sung tồn kho" onClick={() => setOpen(true)} />
            {open && (
                <Sheet addressId={selectedAddress.id} addresses={[selectedAddress, ...(siblings ?? [])]} onClose={() => setOpen(false)} onRestocked={onRestocked} />
            )}
        </>
    )
}

function Sheet({ addressId, addresses: all, onClose, onRestocked }: { addressId: string; addresses: { id?: string | null; name: string }[]; onClose: () => void; onRestocked?: () => unknown }) {
    const { profile } = useAuth()
    const { refreshProducts } = useProducts()
    const { refreshTodayExpenses } = useHistory()
    const addresses = useMemo(() => all.map(a => ({ id: a.id!, name: a.name })), [all])
    const { plan, pool, cfgOf, error, reload } = useGroupPrep(addresses)
    const [restock, setRestock] = useState<{ ingredient: string; qty: number } | null>(null)
    const cashClosedToday = useCashClosedToday(addressId, !!restock)

    const buyList = useMemo(() => (plan ?? [])
        .map(r => ({ ingredient: r.ingredient, unit: r.unit, buy: ceilToBigUnit(r.buy, r.unit, cfgOf[r.ingredient]) }))
        .filter(x => x.buy > 0)
        .sort((a, b) => byIngredientLabel(a.ingredient, b.ingredient)), [plan, cfgOf])
    const cfg = restock ? cfgOf[restock.ingredient] : undefined

    return (
        <>
            <NoticeSheet icon={<Package size={18} className="text-primary shrink-0" />} title="Bổ sung tồn kho" count={plan ? buyList.length : ''} onClose={onClose}>
                {error ? (
                    <div className="py-6 text-center flex flex-col items-center gap-2">
                        <span className="text-[14px] font-bold text-danger">Không tải được số liệu kho</span>
                        <button type="button" onClick={reload} className="text-[13px] font-bold text-primary">Thử lại</button>
                    </div>
                ) : !plan ? (
                    <p className="py-8 text-center text-[14px] text-text-secondary">Đang tính…</p>
                ) : buyList.length === 0 ? (
                    <p className="py-8 text-center text-[14px] text-text-secondary">Kho tổng đủ cho ngày mai — không cần đi chợ.</p>
                ) : buyList.map(x => (
                    <div key={x.ingredient} className="flex items-center gap-2 py-2.5 border-b border-border/20 last:border-0">
                        <span className="flex-1 min-w-0 truncate text-[14px] font-medium text-text">{ingredientLabel(x.ingredient)}</span>
                        <span className="text-[15px] font-black tabular-nums text-text">{fmtQty(x.buy, x.unit, cfgOf[x.ingredient])}</span>
                        <button type="button" onClick={() => setRestock({ ingredient: x.ingredient, qty: x.buy })} className="shrink-0 px-2.5 py-1.5 rounded-[8px] bg-primary text-bg text-[11px] font-black">Nhập kho</button>
                    </div>
                ))}
            </NoticeSheet>

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
                        await Promise.all([reload(), refreshProducts?.(), refreshTodayExpenses?.(), onRestocked?.()])
                        return result
                    }}
                />
            )}
        </>
    )
}
