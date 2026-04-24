import { useState } from 'react'
import { X, ClipboardCopy, Check, ChevronRight, Loader } from 'lucide-react'
import { cloneAddressConfig } from '../../services/backupService'
import { useAddress } from '../../contexts/AddressContext'

const STEPS = [
    { key: 'menu', label: 'Menu & thứ tự sản phẩm' },
    { key: 'prices', label: 'Giá menu' },
    { key: 'ingredients', label: 'Nguyên liệu & giá nguyên liệu' },
    { key: 'recipes', label: 'Công thức & định lượng' },
    { key: 'extras', label: 'Tùy chọn thêm & định lượng' },
]

export default function BackupModal({ sourceAddress, addresses, onClose }) {
    const { createNewAddress } = useAddress()

    const [destType, setDestType] = useState('new')
    const [newName, setNewName] = useState('')
    const [targetId, setTargetId] = useState('')
    const [options, setOptions] = useState({ menu: true, prices: true, ingredients: true, recipes: true, extras: true })
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [done, setDone] = useState(false)

    const otherAddresses = addresses.filter(a => a.id !== sourceAddress.id)
    const noneSelected = !Object.values(options).some(Boolean)

    function toggleOption(key) {
        setOptions(prev => ({ ...prev, [key]: !prev[key] }))
    }

    async function handleSubmit() {
        setError('')

        if (destType === 'new' && !newName.trim()) {
            setError('Nhập tên địa chỉ mới')
            return
        }
        if (destType === 'existing' && !targetId) {
            setError('Chọn địa chỉ đích')
            return
        }
        if (noneSelected) {
            setError('Chọn ít nhất một nội dung để sao lưu')
            return
        }

        setLoading(true)
        try {
            let resolvedTargetId = targetId

            if (destType === 'new') {
                const newAddr = await createNewAddress(newName.trim())
                resolvedTargetId = newAddr.id
            }

            await cloneAddressConfig(sourceAddress.id, resolvedTargetId, options)
            setDone(true)
        } catch (err) {
            setError(err.message || 'Sao lưu thất bại')
        } finally {
            setLoading(false)
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
                            Đã sao chép cấu hình từ <span className="text-text font-bold">{sourceAddress.name}</span> sang địa chỉ đích.
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
                        {/* ── Destination ── */}
                        <div className="space-y-2">
                            <p className="text-xs font-black text-text-secondary uppercase tracking-wider">Sao lưu sang</p>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setDestType('new')}
                                    className={`flex-1 py-2.5 rounded-[12px] text-xs font-bold transition-colors border ${destType === 'new'
                                        ? 'bg-primary/10 border-primary/30 text-primary'
                                        : 'bg-bg border-border/60 text-text-secondary hover:text-text'}`}
                                >
                                    Địa chỉ mới
                                </button>
                                <button
                                    onClick={() => { setDestType('existing'); setTargetId(otherAddresses[0]?.id || '') }}
                                    disabled={otherAddresses.length === 0}
                                    className={`flex-1 py-2.5 rounded-[12px] text-xs font-bold transition-colors border ${destType === 'existing'
                                        ? 'bg-primary/10 border-primary/30 text-primary'
                                        : 'bg-bg border-border/60 text-text-secondary hover:text-text'} disabled:opacity-40`}
                                >
                                    Địa chỉ có sẵn
                                </button>
                            </div>

                            {destType === 'new' ? (
                                <input
                                    type="text"
                                    value={newName}
                                    onChange={e => setNewName(e.target.value)}
                                    placeholder="Tên địa chỉ mới..."
                                    autoFocus
                                    className="w-full px-4 py-3 rounded-[12px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                                />
                            ) : (
                                <select
                                    value={targetId}
                                    onChange={e => setTargetId(e.target.value)}
                                    className="w-full px-4 py-3 rounded-[12px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all appearance-none"
                                >
                                    {otherAddresses.map(a => (
                                        <option key={a.id} value={a.id}>{a.name}</option>
                                    ))}
                                </select>
                            )}

                            {destType === 'existing' && targetId && (
                                <p className="text-xs text-danger/80 font-medium px-1">
                                    ⚠ Cấu hình cũ của địa chỉ đích sẽ bị ghi đè
                                </p>
                            )}
                        </div>

                        {/* ── Options ── */}
                        <div className="space-y-2">
                            <p className="text-xs font-black text-text-secondary uppercase tracking-wider">Nội dung sao lưu</p>
                            <div className="bg-bg rounded-[14px] border border-border/60 divide-y divide-border/40 overflow-hidden">
                                {STEPS.map(({ key, label }) => (
                                    <button
                                        key={key}
                                        onClick={() => toggleOption(key)}
                                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-light transition-colors"
                                    >
                                        <span className={`text-sm font-medium ${options[key] ? 'text-text' : 'text-text-secondary'}`}>{label}</span>
                                        <div className={`w-5 h-5 rounded-[6px] border flex items-center justify-center transition-colors ${options[key]
                                            ? 'bg-primary border-primary'
                                            : 'bg-transparent border-border/60'}`}>
                                            {options[key] && <Check size={12} strokeWidth={3} className="text-black" />}
                                        </div>
                                    </button>
                                ))}
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
                                disabled={loading || noneSelected}
                                className="flex-1 py-3 rounded-[14px] bg-primary text-black font-black text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {loading ? (
                                    <><Loader size={15} className="animate-spin" /> Đang sao lưu...</>
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
