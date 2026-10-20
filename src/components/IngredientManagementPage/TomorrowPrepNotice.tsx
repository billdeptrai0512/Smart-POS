import { useState, useEffect, useMemo } from 'react'
import { CalendarClock } from 'lucide-react'
import { useAddress } from '../../contexts/AddressContext'
import { useAuth } from '../../contexts/AuthContext'
import { useStats } from '../../contexts/StatsContext'
import { useToast } from '../../hooks/useToast'
import { useGroupPrep } from '../../hooks/useGroupPrep'
import { fetchWarehouseTransfer, setTomorrowPrepConfirmed } from '../../services/warehouseTransferService'
import { buildTomorrowPrepList } from '../../utils/prepToday'
import { isTrivialQty } from '../../utils/warehouseTransfer'
import { addDaysVN, dateStringVN } from '../../utils/dateVN'
import NoticeBar from '../common/NoticeBar'
import NoticeSheet, { SheetBody } from '../common/NoticeSheet'
import ShiftPrepCard from '../DailyReportPage/ShiftPrepCard'
import Toast from '../POSPage/Toast'
import type { UUID, Row } from '../../types/domain'
import { useProducts } from '../../contexts/ProductContext'

// Dải "Soạn cho ngày mai" ở Kiểm kê → bottom sheet của ĐỊA CHỈ ĐANG MỞ, cùng giao diện "Chuẩn bị hôm nay" của POS nhưng theo dự báo
// NGÀY MAI. Tick = XÁC NHẬN đã soạn (ghi tên người tick) — không trừ kho. Sáng hôm sau "Chuẩn bị hôm nay" của địa chỉ đó đọc đúng
// dòng này ("Kho tổng chia: … ✓ đã soạn bởi …"), nhân viên tick nhận hàng → Nhập thêm. Quản lý và nhân viên đều thấy; chỉ địa chỉ thuộc nhóm kho chung.
export default function TomorrowPrepNotice() {
    const { isGuest } = useAuth()
    const { selectedAddress, warehouseRole } = useAddress()
    const { isOnline } = useStats()
    const [open, setOpen] = useState(false)
    const groupId = selectedAddress?.warehouse_group_id
    const inGroup = warehouseRole === 'hub' || warehouseRole === 'member' || warehouseRole === 'nohub'
    if (!(!isGuest && isOnline && inGroup && groupId && selectedAddress?.id)) return null
    return (
        <>
            <NoticeBar icon={<CalendarClock size={15} className="text-primary shrink-0" />} label="Soạn cho ngày mai" onClick={() => setOpen(true)} />
            {open && <Sheet groupId={groupId} addressId={selectedAddress.id} name={selectedAddress.name} onClose={() => setOpen(false)} />}
        </>
    )
}

type Confirmed = Record<string, { qty: number; by?: string }>

function Sheet({ groupId, addressId, name, onClose }: { groupId: UUID; addressId: UUID; name: string; onClose: () => void }) {
    const { profile } = useAuth()
    const { toast, showError } = useToast()
    const forDate = useMemo(() => dateStringVN(addDaysVN(new Date(), 1)), [])
    const addresses = useMemo(() => [{ id: addressId, name }], [addressId, name])
    const { branches, pool, error, reload } = useGroupPrep(addresses)
    const { batchKeys } = useProducts()
    // Dòng đã xác nhận: { [ingredient]: { qty lúc xác nhận, by } }. null = đang tải.
    const [confirmed, setConfirmed] = useState<Confirmed | null>(null)
    useEffect(() => {
        fetchWarehouseTransfer(groupId, forDate)
            .then(t => setConfirmed(Object.fromEntries((t?.items || []).filter(i => i.address_id === addressId && i.packed_at).map(i => [i.ingredient, { qty: Number(i.qty), by: i.packed_by_name ?? undefined }]))))
            .catch(err => { setConfirmed({}); showError(err, 'Đọc phiếu soạn') })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [groupId, addressId, forDate])

    // Số đã xác nhận (kể cả sửa tay khác gợi ý) vẫn tính là đã soạn — card hiện thêm "Gợi ý" khi lệch.
    const items = useMemo(() => {
        const b = branches?.[0]
        if (!b || !confirmed) return []
        return buildTomorrowPrepList({ ingredientsList: b.ingredientsList.filter((i: Row) => !batchKeys.has(i.ingredient)), counterStock: b.counterStock, forecast: b.forecast, pool })
            .filter(it => !isTrivialQty(it.fillQty ?? 0, it.unit))
            .map(it => {
                const c = confirmed[it.ingredient]
                return c ? { ...it, taken: c.qty, by: c.by } : it
            })
    }, [branches, pool, confirmed, batchKeys])
    const checked = useMemo(() => Object.fromEntries(items.filter(it => it.taken != null).map(it => [it.ingredient, true])), [items])
    const done = Object.keys(checked).length

    // qty = số nhân viên sửa tay (không có → số đã xác nhận / gợi ý). Tick ↔ bỏ tick; lỗi thì trả về trạng thái cũ.
    async function toggle(ingredient: string, qty?: number) {
        const it = items.find(i => i.ingredient === ingredient)
        if (!it?.fillQty) return
        const on = !checked[ingredient]
        const q = qty ?? it.taken ?? it.fillQty
        const prev = confirmed?.[ingredient]
        const apply = (v?: { qty: number; by?: string }) => setConfirmed(c => {
            const next = { ...c }
            if (v) next[ingredient] = v; else delete next[ingredient]
            return next
        })
        apply(on ? { qty: q, by: profile?.name } : undefined)
        try {
            await setTomorrowPrepConfirmed(groupId, forDate, addressId, ingredient, it.unit ?? '', q, on)
        } catch (err) {
            showError(err, 'Lưu xác nhận')
            apply(prev)
        }
    }

    const loading = !branches || confirmed === null
    return (
        <>
            <NoticeSheet icon={<CalendarClock size={18} className="text-primary shrink-0" />} title="Soạn cho ngày mai" count={loading ? '' : `${done}/${items.length}`} onClose={onClose}>
                <SheetBody error={error} loading={loading} onRetry={reload}>
                    <>
                        {items.length > 0 && <p className="py-2 text-[11px] text-text-dim">Tick để xác nhận đã soạn — không trừ kho.</p>}
                        <ShiftPrepCard
                            packVerb="Soạn"
                            haveLabel="Tồn quầy cuối ca"
                            emptyTitle="Quầy đủ cho ngày mai!"
                            emptyHint="Chưa cần soạn gì cho ngày mai."
                            items={items}
                            checked={checked}
                            onToggle={toggle}
                        />
                    </>
                </SheetBody>
            </NoticeSheet>
            <Toast toast={toast} />
        </>
    )
}
