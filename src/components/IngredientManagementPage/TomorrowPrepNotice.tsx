import { useState, useEffect, useMemo } from 'react'
import { CalendarClock, Check } from 'lucide-react'
import { useAddress } from '../../contexts/AddressContext'
import { useAuth } from '../../contexts/AuthContext'
import { useStats } from '../../contexts/StatsContext'
import { useToast } from '../../hooks/useToast'
import { useGroupPrep } from '../../hooks/useGroupPrep'
import { fetchWarehouseTransfer, setTomorrowPrepConfirmed } from '../../services/warehouseTransferService'
import { fmtQty, isTrivialQty } from '../../utils/warehouseTransfer'
import { byIngredientLabel, ingredientLabel } from '../../utils/ingredients'
import { addDaysVN, dateStringVN } from '../../utils/dateVN'
import NoticeBar from '../common/NoticeBar'
import NoticeSheet from '../common/NoticeSheet'
import Toast from '../POSPage/Toast'
import type { UUID } from '../../types/domain'

// Dải "Soạn cho ngày mai" ở Kiểm kê → bottom sheet của ĐỊA CHỈ ĐANG MỞ: những gì sáng mai cần lấy ra quầy (dự báo bán − tồn quầy,
// như "Soạn cho hôm nay" ở POS nhưng cho ngày mai), theo bịch/túi/cây của kho chung. Tick chỉ là XÁC NHẬN đã soạn — không trừ kho
// (kho chỉ trừ khi chi nhánh ghi "Nhập thêm"). Chỉ chủ/quản lý, và chỉ địa chỉ thuộc nhóm kho chung.
export default function TomorrowPrepNotice() {
    const { isGuest, isManager, isAdmin } = useAuth()
    const { selectedAddress, warehouseRole } = useAddress()
    const { isOnline } = useStats()
    const [open, setOpen] = useState(false)
    const groupId = selectedAddress?.warehouse_group_id
    const inGroup = warehouseRole === 'hub' || warehouseRole === 'member' || warehouseRole === 'nohub'
    if (!((isManager || isAdmin) && !isGuest && isOnline && inGroup && groupId && selectedAddress?.id)) return null
    return (
        <>
            <NoticeBar icon={<CalendarClock size={15} className="text-primary shrink-0" />} label="Soạn cho ngày mai" onClick={() => setOpen(true)} />
            {open && <Sheet groupId={groupId} addressId={selectedAddress.id} name={selectedAddress.name} onClose={() => setOpen(false)} />}
        </>
    )
}

interface Confirmed { qty: number; at: boolean }

function Sheet({ groupId, addressId, name, onClose }: { groupId: UUID; addressId: UUID; name: string; onClose: () => void }) {
    const { toast, showError } = useToast()
    const forDate = useMemo(() => dateStringVN(addDaysVN(new Date(), 1)), [])
    const addresses = useMemo(() => [{ id: addressId, name }], [addressId, name])
    const { plan, cfgOf, error, reload } = useGroupPrep(addresses)
    // Dòng đã xác nhận (số lúc xác nhận): { [ingredient]: qty }. null = đang tải.
    const [confirmed, setConfirmed] = useState<Record<string, Confirmed> | null>(null)
    useEffect(() => {
        fetchWarehouseTransfer(groupId, forDate)
            .then(t => setConfirmed(Object.fromEntries((t?.items || []).filter(i => i.address_id === addressId && i.packed_at).map(i => [i.ingredient, { qty: Number(i.qty), at: true }]))))
            .catch(err => { setConfirmed({}); showError(err, 'Đọc phiếu soạn') })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [groupId, addressId, forDate])

    const rows = useMemo(() => (plan ?? [])
        .map(r => ({ ingredient: r.ingredient, unit: r.unit, qty: r.branches.find(b => b.id === addressId)?.qty ?? 0 }))
        .filter(r => r.qty > 0 && !isTrivialQty(r.qty, r.unit))
        .sort((a, b) => byIngredientLabel(a.ingredient, b.ingredient)), [plan, addressId])
    // Đổi số sau khi đã xác nhận thì dấu cũ không còn đúng → coi như chưa xác nhận.
    const isDone = (r: { ingredient: string; qty: number }) => confirmed?.[r.ingredient]?.qty === r.qty
    const done = rows.filter(isDone).length

    async function toggle(r: (typeof rows)[number]) {
        const on = !isDone(r)
        setConfirmed(c => {
            const next = { ...c }
            if (on) next[r.ingredient] = { qty: r.qty, at: true }; else delete next[r.ingredient]
            return next
        })
        try {
            await setTomorrowPrepConfirmed(groupId, forDate, addressId, r.ingredient, r.unit, r.qty, on)
        } catch (err) {
            showError(err, 'Lưu xác nhận')
            setConfirmed(c => {
                const next = { ...c }
                if (on) delete next[r.ingredient]; else next[r.ingredient] = { qty: r.qty, at: true }
                return next
            })
        }
    }

    const loading = !plan || confirmed === null
    return (
        <>
            <NoticeSheet icon={<CalendarClock size={18} className="text-primary shrink-0" />} title="Soạn cho ngày mai" count={loading ? '' : `${done}/${rows.length}`} onClose={onClose}>
                {error ? (
                    <div className="py-6 text-center flex flex-col items-center gap-2">
                        <span className="text-[14px] font-bold text-danger">Không tải được số liệu</span>
                        <button type="button" onClick={reload} className="text-[13px] font-bold text-primary">Thử lại</button>
                    </div>
                ) : loading ? (
                    <p className="py-8 text-center text-[14px] text-text-secondary">Đang tính…</p>
                ) : rows.length === 0 ? (
                    <p className="py-8 text-center text-[14px] text-text-secondary">Quầy đủ cho ngày mai — chưa cần soạn gì.</p>
                ) : (
                    <>
                        <p className="py-2 text-[11px] text-text-dim">Tick để xác nhận đã soạn — không trừ kho.</p>
                        {rows.map(r => {
                            const on = isDone(r)
                            return (
                                <button key={r.ingredient} type="button" onClick={() => toggle(r)} className="w-full flex items-center gap-3 py-2.5 border-b border-border/20 last:border-0 text-left">
                                    <span className={`w-6 h-6 shrink-0 rounded-[7px] border flex items-center justify-center ${on ? 'bg-success border-success text-bg' : 'border-border'}`}>
                                        {on && <Check size={15} strokeWidth={3} />}
                                    </span>
                                    <span className={`flex-1 min-w-0 truncate text-[14px] font-medium ${on ? 'text-text-dim' : 'text-text'}`}>{ingredientLabel(r.ingredient)}</span>
                                    <span className={`shrink-0 text-[15px] font-black tabular-nums ${on ? 'text-text-dim' : 'text-text'}`}>{fmtQty(r.qty, r.unit, cfgOf[r.ingredient])}</span>
                                </button>
                            )
                        })}
                    </>
                )}
            </NoticeSheet>
            <Toast toast={toast} />
        </>
    )
}
