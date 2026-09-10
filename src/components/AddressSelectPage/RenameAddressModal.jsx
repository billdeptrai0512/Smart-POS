import { useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { Dialog, ModalHeader, ModalActions } from '../common/ModalShell'

// Modal đổi tên — "Hủy" quay lại modal thao tác (onCancel, chỉ đóng modal này),
// X/tap-outside mới thoát hẳn (onClose, đóng cả modal thao tác phía sau).
export default function RenameAddressModal({ addr, onRename, onCancel, onClose, onSuccess, setError }) {
    const [editName, setEditName] = useState(addr.name)
    const [renaming, setRenaming] = useState(false)
    const submitGuardRef = useRef(false)

    async function handleSubmit(e) {
        e.preventDefault()
        if (!editName.trim()) return
        if (submitGuardRef.current) return
        submitGuardRef.current = true
        setRenaming(true)
        setError('')
        try {
            await onRename(addr.id, editName.trim())
            onSuccess()
        } catch (err) {
            setError(err.message || 'Không thể đổi tên')
        } finally {
            setRenaming(false)
            submitGuardRef.current = false
        }
    }

    return (
        <Dialog
            onClose={() => { if (!renaming) onClose() }}
            panelClassName="w-full max-w-sm mx-4 bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden"
        >
            <form onSubmit={handleSubmit}>
                <ModalHeader icon={Pencil} title="Đổi tên địa chỉ" onClose={onClose} hideClose={renaming} />
                <div className="p-5 flex flex-col gap-4">
                    <input
                        type="text"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        disabled={renaming}
                        className="w-full px-4 py-3 rounded-[12px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-50"
                        autoFocus
                    />
                    <ModalActions
                        confirmLabel="Lưu"
                        confirmType="submit"
                        onCancel={onCancel}
                        loading={renaming}
                        confirmDisabled={!editName.trim()}
                    />
                </div>
            </form>
        </Dialog>
    )
}
