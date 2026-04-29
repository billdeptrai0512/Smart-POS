import { useState, useRef } from 'react'
import { X, ClipboardCopy, Check, ChevronRight, Loader } from 'lucide-react'
import { cloneAddressConfig } from '../../services/backupService'
import { useAddress } from '../../contexts/AddressContext'

const ALL_OPTIONS = { menu: true, recipes: true, extras: true, ingredients: true }

const PROGRESS_LABELS = {
    menu: 'menu',
    recipes: 'công thức',
    extras: 'tùy chọn thêm',
    ingredients: 'nguyên liệu',
}
const PROGRESS_UNITS = {
    menu: 'sản phẩm',
    recipes: 'công thức',
    extras: 'tùy chọn',
    ingredients: 'nguyên liệu',
}

export default function BackupModal({ sourceAddress, onClose }) {
    const { createNewAddress, removeAddress } = useAddress()

    const [newName, setNewName] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [done, setDone] = useState(false)
    const [progress, setProgress] = useState(null)
    const submitGuardRef = useRef(false)

    async function handleSubmit() {
        setError('')

        const cleanName = newName.trim()
        if (!cleanName) {
            setError('Nhập tên địa chỉ mới')
            return
        }

        if (submitGuardRef.current) return
        submitGuardRef.current = true
        setLoading(true)
        setProgress(null)

        let createdAddressId = null
        try {
            const newAddr = await createNewAddress(cleanName)
            createdAddressId = newAddr.id
            await cloneAddressConfig(sourceAddress.id, createdAddressId, ALL_OPTIONS, setProgress)
            setDone(true)
        } catch (err) {
            // Best-effort cleanup: if clone failed midway, the new address is half-populated and useless.
            if (createdAddressId) {
                try { await removeAddress(createdAddressId) } catch { /* keep original error */ }
            }
            setError(err.message || 'Sao lưu thất bại')
        } finally {
            setLoading(false)
            setProgress(null)
            submitGuardRef.current = false
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={!loading ? onClose : undefined} />

            <div className="relative w-full max-w-lg mx-4 mb-4 bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border/40">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-[10px] bg-primary/10 flex items-center justify-center">
                            <ClipboardCopy size={15} className="text-primary" />
                        </div>
                        <div>
                            <p className="text-text font-black text-sm leading-none">Sao lưu cấu hình</p>
                            <p className="text-text-secondary text-xs mt-0.5">Nguồn: <span className="text-primary font-bold">{sourceAddress.name}</span></p>
                        </div>
                    </div>
                    {!loading && (
                        <button onClick={onClose} className="p-1.5 text-text-secondary hover:text-text transition-colors rounded-lg hover:bg-surface-light">
                            <X size={16} />
                        </button>
                    )}
                </div>

                {done ? (
                    /* ── Done state ── */
                    <div className="px-5 py-8 flex flex-col items-center gap-3">
                        <div className="w-14 h-14 rounded-full bg-success/10 flex items-center justify-center">
                            <Check size={28} className="text-success" />
                        </div>
                        <p className="text-text font-black text-base">Sao lưu thành công!</p>
                        <p className="text-text-secondary text-sm text-center">
                            Sao chép toàn bộ cấu hình từ <span className="text-text font-bold">{sourceAddress.name}</span> sang địa chỉ mới.
                        </p>
                        <button
                            onClick={onClose}
                            className="mt-2 w-full py-3 rounded-[14px] bg-primary text-black font-black text-sm hover:bg-primary/90 transition-colors"
                        >
                            Xong
                        </button>
                    </div>
                ) : (
                    <div className="px-5 py-4 space-y-4">
                        {/* ── New address name ── */}
                        <div className="space-y-2">
                            <p className="text-xs font-black text-text-secondary uppercase tracking-wider">Tên địa chỉ mới</p>
                            <input
                                type="text"
                                value={newName}
                                onChange={e => setNewName(e.target.value)}
                                placeholder="vd: KOPHIN Cầu Giấy"
                                autoFocus
                                disabled={loading}
                                className="w-full px-4 py-3 rounded-[12px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all disabled:opacity-50"
                            />
                        </div>

                        <p className="text-text-secondary text-xs">
                            <span className="font-bold text-text">Bao gồm:</span> Menu - Tùy chọn thêm - Công thức - Nguyên liệu.
                        </p>

                        {/* ── Error ── */}
                        {error && (
                            <p className="text-danger text-xs font-medium px-1">{error}</p>
                        )}

                        {/* ── Actions ── */}
                        <div className="flex gap-2 pb-1">
                            <button
                                onClick={onClose}
                                disabled={loading}
                                className="flex-1 py-3 rounded-[14px] bg-bg border border-border/60 text-text-secondary font-bold text-sm hover:bg-surface-light transition-colors disabled:opacity-50"
                            >
                                Hủy
                            </button>
                            <button
                                onClick={handleSubmit}
                                disabled={loading || !newName.trim()}
                                className="flex-1 py-3 rounded-[14px] bg-primary text-black font-black text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {loading ? (
                                    <>
                                        <Loader size={15} className="animate-spin" />
                                        {progress
                                            ? `${PROGRESS_LABELS[progress.phase]} (${progress.count} ${PROGRESS_UNITS[progress.phase]})...`
                                            : 'Đang sao lưu...'}
                                    </>
                                ) : (
                                    <>Sao lưu <ChevronRight size={15} /></>
                                )}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
