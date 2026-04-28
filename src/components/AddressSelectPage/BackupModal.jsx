import { useState, useRef } from 'react'
import { X, ClipboardCopy, Check, ChevronRight, Loader } from 'lucide-react'
import { cloneAddressConfig } from '../../services/backupService'
import { useAddress } from '../../contexts/AddressContext'

// Recipes/extras link to products by id, so they require Menu to be cloned in the same run.
const STEPS = [
    { key: 'menu', label: 'Menu (sản phẩm + giá + thứ tự)', requires: null },
    { key: 'recipes', label: 'Công thức', requires: 'menu' },
    { key: 'extras', label: 'Tùy chọn thêm', requires: 'menu' },
    { key: 'ingredients', label: 'Nguyên liệu (giá + thứ tự)', requires: null },
]

export default function BackupModal({ sourceAddress, onClose }) {
    const { createNewAddress, removeAddress } = useAddress()

    const [newName, setNewName] = useState('')
    const [options, setOptions] = useState({ menu: true, recipes: true, extras: true, ingredients: true })
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [done, setDone] = useState(false)
    const [progress, setProgress] = useState(null) // { phase, count }
    const submitGuardRef = useRef(false)

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

    const noneSelected = !Object.values(options).some(Boolean)

    function toggleOption(key) {
        setOptions(prev => {
            const next = { ...prev, [key]: !prev[key] }
            // If menu is being turned off, dependent steps must also turn off.
            if (key === 'menu' && !next.menu) {
                next.recipes = false
                next.extras = false
            }
            // If a dependent is being turned on, ensure its requirement is on too.
            const step = STEPS.find(s => s.key === key)
            if (step?.requires && next[key]) {
                next[step.requires] = true
            }
            return next
        })
    }

    async function handleSubmit() {
        setError('')

        const cleanName = newName.trim()
        if (!cleanName) {
            setError('Nhập tên địa chỉ mới')
            return
        }
        if (noneSelected) {
            setError('Chọn ít nhất một nội dung để sao lưu')
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
            await cloneAddressConfig(sourceAddress.id, createdAddressId, options, setProgress)
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
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={!loading ? onClose : undefined} />

            <div className="relative w-full max-w-sm mx-4 mb-4 sm:mb-0 bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden">
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
                            Đã sao chép cấu hình từ <span className="text-text font-bold">{sourceAddress.name}</span> sang địa chỉ mới.
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

                        {/* ── Options ── */}
                        <div className="space-y-2">
                            <p className="text-xs font-black text-text-secondary uppercase tracking-wider">Nội dung sao lưu</p>
                            <div className="bg-bg rounded-[14px] border border-border/60 divide-y divide-border/40 overflow-hidden">
                                {STEPS.map(({ key, label, requires }) => {
                                    const reqMet = !requires || options[requires]
                                    const checked = options[key]
                                    return (
                                        <button
                                            key={key}
                                            onClick={() => toggleOption(key)}
                                            disabled={loading}
                                            className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-light transition-colors disabled:opacity-50"
                                        >
                                            <span className="flex flex-col items-start">
                                                <span className={`text-sm font-medium ${checked ? 'text-text' : 'text-text-secondary'}`}>{label}</span>
                                                {requires && !reqMet && (
                                                    <span className="text-[10px] text-text-secondary mt-0.5">cần Menu</span>
                                                )}
                                            </span>
                                            <div className={`w-5 h-5 rounded-[6px] border flex items-center justify-center transition-colors ${checked
                                                ? 'bg-primary border-primary'
                                                : 'bg-transparent border-border/60'}`}>
                                                {checked && <Check size={12} strokeWidth={3} className="text-black" />}
                                            </div>
                                        </button>
                                    )
                                })}
                            </div>
                        </div>

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
                                disabled={loading || noneSelected || !newName.trim()}
                                className="flex-1 py-3 rounded-[14px] bg-primary text-black font-black text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {loading ? (
                                    <>
                                        <Loader size={15} className="animate-spin" />
                                        {progress
                                            ? `Đang sao chép ${PROGRESS_LABELS[progress.phase] || ''} (${progress.count} ${PROGRESS_UNITS[progress.phase] || ''})...`
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
