import { useState } from 'react'
import { Warehouse, X, Pencil, Trash2, Loader } from 'lucide-react'
import { Dialog, ModalHeader } from '../common/ModalShell'
import type { Address, UUID, WarehouseGroup } from '../../types/domain'
import { errorMessage } from '../../utils/errorMessage'

interface Props {
    addr: Address
    addresses: Address[]
    warehouseGroups: WarehouseGroup[]
    onCreateWarehouseGroup: (addressId: UUID, name: string) => Promise<UUID>
    onRenameWarehouseGroup: (groupId: UUID, name: string) => Promise<unknown>
    onRemoveWarehouseGroup: (groupId: UUID) => Promise<unknown>
    onSetAddressGroup: (addressId: UUID, groupId: UUID | null) => Promise<unknown>
    onSetGroupHub: (groupId: UUID, addressId: UUID | null) => Promise<unknown>
    onClose: () => void
}

// Modal kho tổng chung — chọn/tạo nhóm để dùng chung kho tổng với địa chỉ khác.
// Không phải thao tác phá dữ liệu (ON DELETE SET NULL khi xoá nhóm) nên không cần
// gõ lại tên xác nhận như xoá địa chỉ — chỉ 1 lần tap xác nhận cho việc xoá nhóm.
export default function WarehouseGroupModal({
    addr, addresses, warehouseGroups,
    onCreateWarehouseGroup, onRenameWarehouseGroup, onRemoveWarehouseGroup, onSetAddressGroup, onSetGroupHub,
    onClose,
}: Props) {
    const [busy, setBusy] = useState(false)
    const [groupError, setGroupError] = useState('')
    const [newGroupName, setNewGroupName] = useState('')
    const [confirmDeleteGroupId, setConfirmDeleteGroupId] = useState<UUID | null>(null)
    const [renamingGroupId, setRenamingGroupId] = useState<UUID | null>(null)
    const [renameGroupName, setRenameGroupName] = useState('')

    // Mọi thao tác nhóm cùng khuôn: bật busy, xoá lỗi, chạy, báo lỗi, tắt busy.
    async function run(fallback: string, fn: () => Promise<unknown>) {
        setBusy(true)
        setGroupError('')
        try { await fn() } catch (err) { setGroupError(errorMessage(err, fallback)) } finally { setBusy(false) }
    }

    const handleJoinGroup = (groupId: UUID | null) =>
        !busy && run('Không thể đổi nhóm kho tổng', () => onSetAddressGroup(addr.id, groupId))

    // Đặt / bỏ địa chỉ đang mở làm kho tổng (nơi giữ hàng thật) của nhóm.
    const handleToggleHub = (group: WarehouseGroup) =>
        !busy && run('Không thể đặt kho tổng', () => onSetGroupHub(group.id, group.hub_address_id === addr.id ? null : addr.id))

    function handleCreateAndJoinGroup() {
        const name = newGroupName.trim()
        if (!name || busy) return
        return run('Không thể tạo nhóm', async () => {
            await onCreateWarehouseGroup(addr.id, name)
            setNewGroupName('')
        })
    }

    function handleRenameGroup(groupId: UUID) {
        const name = renameGroupName.trim()
        if (!name || busy) return
        return run('Không thể đổi tên nhóm', async () => {
            await onRenameWarehouseGroup(groupId, name)
            setRenamingGroupId(null)
        })
    }

    const handleDeleteGroup = (groupId: UUID) => run('Không thể xoá nhóm', async () => {
        await onRemoveWarehouseGroup(groupId)
        setConfirmDeleteGroupId(null)
    })

    return (
        <Dialog
            onClose={() => { if (!busy) onClose() }}
            panelClassName="w-full max-w-sm mx-4 my-4 bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden max-h-[calc(100dvh-2rem)] flex flex-col"
        >
            <ModalHeader icon={Warehouse} iconColorClass="text-warning" iconBgClass="bg-warning/10" title="Kho tổng chung" onClose={onClose} className="shrink-0" />
            <div className="p-5 flex flex-col gap-2.5 overflow-y-auto">
                <p className="text-text-secondary text-xs leading-relaxed mb-1">
                    Gộp <span className="font-bold text-text">{addr.name}</span> vào 1 nhóm để dùng chung kho tổng —
                    mua ở đâu cũng cộng chung, giá vốn hợp nhất, quầy vẫn riêng từng địa chỉ.{' '}
                    <span className="text-warning font-bold">Số tồn đổi ngay khi gộp/rời nhóm.</span>
                </p>

                <button
                    onClick={() => handleJoinGroup(null)}
                    disabled={busy || !addr.warehouse_group_id}
                    className={`flex items-center justify-between px-4 py-3 rounded-[12px] border text-sm font-bold transition-colors disabled:opacity-100 ${!addr.warehouse_group_id ? 'border-primary bg-primary/10 text-primary' : 'border-border/60 bg-bg text-text hover:bg-surface-light'}`}
                >
                    Không gộp nhóm
                </button>

                {/* Admin tải nhóm của mọi chủ → chỉ hiện nhóm của chủ địa chỉ này, cộng nhóm địa chỉ đang ở (kể cả khi lệch chủ). */}
                {warehouseGroups.filter(g => g.manager_id === addr.manager_id || g.id === addr.warehouse_group_id).map(g => {
                    const members = addresses.filter(a => a.warehouse_group_id === g.id)
                    const memberCount = members.length
                    const hub = members.find(a => a.id === g.hub_address_id) // hub đã rời nhóm → coi như chưa đặt
                    const isCurrent = addr.warehouse_group_id === g.id
                    const confirming = confirmDeleteGroupId === g.id
                    const isRenaming = renamingGroupId === g.id

                    if (isRenaming) {
                        return (
                            <div key={g.id} className="flex items-center gap-1.5">
                                <input
                                    type="text"
                                    value={renameGroupName}
                                    onChange={e => setRenameGroupName(e.target.value)}
                                    disabled={busy}
                                    autoFocus
                                    className="flex-1 min-w-0 px-4 py-2.5 rounded-[12px] bg-bg border border-primary/60 text-text text-sm font-medium focus:outline-none disabled:opacity-50"
                                />
                                <button
                                    onClick={() => handleRenameGroup(g.id)}
                                    disabled={busy || !renameGroupName.trim()}
                                    className="shrink-0 px-3 py-2.5 rounded-[12px] bg-primary text-black font-black text-xs disabled:opacity-50"
                                >
                                    Lưu
                                </button>
                                <button
                                    onClick={() => setRenamingGroupId(null)}
                                    disabled={busy}
                                    className="shrink-0 p-2.5 rounded-[12px] bg-surface-light text-text-secondary"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        )
                    }

                    return (
                        <div
                            key={g.id}
                            className={`flex items-center gap-2 px-4 py-3 rounded-[12px] border text-sm font-bold transition-colors ${isCurrent ? 'border-primary bg-primary/10 text-primary' : 'border-border/60 bg-bg text-text'}`}
                        >
                            <button
                                onClick={() => handleJoinGroup(g.id)}
                                disabled={busy || isCurrent}
                                className="flex-1 min-w-0 text-left disabled:opacity-100"
                            >
                                <span className="truncate block">{g.name}</span>
                                <span className="block text-[11px] font-medium text-text-secondary">
                                    {memberCount} địa chỉ{hub ? ` · Kho tổng: ${hub.name}` : ' · Chưa đặt kho tổng'}
                                </span>
                            </button>
                            {isCurrent && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleToggleHub(g) }}
                                    disabled={busy}
                                    className={`shrink-0 px-2 py-1.5 rounded-lg text-[11px] font-black disabled:opacity-50 ${g.hub_address_id === addr.id ? 'bg-primary text-black' : 'bg-surface-light text-text-secondary'}`}
                                >
                                    {g.hub_address_id === addr.id ? 'Là kho tổng ✓' : 'Đặt làm kho tổng'}
                                </button>
                            )}
                            {confirming ? (
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                        onClick={() => handleDeleteGroup(g.id)}
                                        disabled={busy}
                                        className="px-2 py-1.5 rounded-lg bg-danger text-white text-[11px] font-black disabled:opacity-50"
                                    >
                                        Xoá
                                    </button>
                                    <button
                                        onClick={() => setConfirmDeleteGroupId(null)}
                                        className="px-2 py-1.5 rounded-lg bg-surface-light text-text-secondary text-[11px] font-bold"
                                    >
                                        Hủy
                                    </button>
                                </div>
                            ) : (
                                <div className="flex items-center gap-0.5 shrink-0">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setRenamingGroupId(g.id); setRenameGroupName(g.name) }}
                                        className="p-1.5 text-text-secondary hover:text-text transition-colors"
                                        title="Đổi tên nhóm"
                                    >
                                        <Pencil size={14} />
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteGroupId(g.id) }}
                                        className="p-1.5 text-text-secondary hover:text-danger transition-colors"
                                        title="Xoá nhóm"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            )}
                        </div>
                    )
                })}

                <div className="flex items-center gap-2 pt-1">
                    <input
                        type="text"
                        value={newGroupName}
                        onChange={e => setNewGroupName(e.target.value)}
                        placeholder="Tên nhóm mới…"
                        disabled={busy}
                        className="flex-1 min-w-0 px-4 py-2.5 rounded-[12px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-50"
                    />
                    <button
                        onClick={handleCreateAndJoinGroup}
                        disabled={busy || !newGroupName.trim()}
                        className="shrink-0 px-4 py-2.5 rounded-[12px] bg-primary text-black font-black text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                    >
                        {busy ? <Loader size={14} className="animate-spin" /> : 'Tạo & gộp'}
                    </button>
                </div>

                {groupError && <p className="text-danger text-xs font-medium">{groupError}</p>}
            </div>
        </Dialog>
    )
}
