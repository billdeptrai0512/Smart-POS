import { useState } from 'react'
import { Dialog, ModalHeader, ModalActions } from '../common/ModalShell'

// Modal "gõ lại tên để xác nhận" dùng chung cho mọi hard-delete không thể hoàn tác
// (xoá địa chỉ, xoá dữ liệu bán hàng) — trước đây là 2 file gần như y hệt nhau.
// "Hủy" quay lại modal thao tác (onCancel), X/tap-outside mới thoát hẳn (onClose).
export default function ConfirmByNameModal({
    icon, title, description, warning, confirmLabel,
    targetName, onConfirm, onCancel, onClose, onSuccess, error, setError,
}) {
    const [confirmName, setConfirmName] = useState('')
    const [busy, setBusy] = useState(false)
    const matches = confirmName.trim().toUpperCase() === targetName.toUpperCase()

    async function handleConfirm() {
        if (!matches || busy) return
        setBusy(true)
        setError('')
        try {
            await onConfirm()
            onSuccess?.()
        } catch (err) {
            setError(err.message || 'Không thể thực hiện')
            setBusy(false)
        }
    }

    return (
        <Dialog
            onClose={() => { if (!busy) onClose() }}
            panelClassName="w-full max-w-sm mx-4 bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden"
        >
            <ModalHeader icon={icon} iconColorClass="text-danger" iconBgClass="bg-danger/10" title={title} onClose={onClose} hideClose={busy} />
            <div className="p-5 flex flex-col gap-4">
                {description}
                {warning}
                <div>
                    <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">Gõ lại tên địa chỉ để xác nhận</label>
                    <input
                        type="text"
                        value={confirmName}
                        onChange={e => setConfirmName(e.target.value)}
                        disabled={busy}
                        placeholder={targetName}
                        className="w-full px-4 py-3 rounded-[12px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-danger/40 focus:border-danger disabled:opacity-50"
                        autoFocus
                    />
                </div>
                {error && (
                    <p className="text-danger text-xs font-medium -mt-2">{error}</p>
                )}
                <ModalActions
                    confirmLabel={confirmLabel}
                    onCancel={onCancel}
                    onConfirm={handleConfirm}
                    loading={busy}
                    confirmDisabled={!matches}
                    danger
                />
            </div>
        </Dialog>
    )
}
