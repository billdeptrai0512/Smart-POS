import { useState, useRef } from 'react'
import { X, ClipboardCopy, Check, ChevronRight, Loader, Share2, Copy } from 'lucide-react'
import { cloneAddressConfig, createAddressShareCode } from '../../services/backupService'
import { useAddress } from '../../contexts/AddressContext'

const ALL_OPTIONS = { menu: true, recipes: true, extras: true, ingredients: true }

// Thứ tự khớp với applySnapshot trong backupService (menu → recipes → extras → ingredients).
const PHASES = [
    { key: 'menu', label: 'Menu' },
    { key: 'recipes', label: 'Công thức' },
    { key: 'extras', label: 'Tùy chọn thêm' },
    { key: 'ingredients', label: 'Nguyên liệu' },
]

// Copy text an toàn: clipboard API có thể bị chặn trong iframe / webview Zalo-FB
// (reject NotAllowedError). Bắt lỗi + fallback execCommand qua textarea ẩn.
async function copyText(text) {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text)
            return true
        }
    } catch { /* fall through */ }
    try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        return ok
    } catch {
        return false
    }
}

// Checklist trực quan từng bước clone (thay cho progress nhồi trong nút).
function PhaseChecklist({ progress }) {
    const currentIdx = progress ? PHASES.findIndex(p => p.key === progress.phase) : -1
    return (
        <div className="py-2 space-y-3">
            {PHASES.map((p, i) => {
                const status = i < currentIdx ? 'done' : i === currentIdx ? 'active' : 'pending'
                return (
                    <div key={p.key} className="flex items-center gap-3">
                        <span className="w-5 h-5 flex items-center justify-center shrink-0">
                            {status === 'done' && <Check size={16} className="text-success" />}
                            {status === 'active' && <Loader size={15} className="animate-spin text-primary" />}
                            {status === 'pending' && <span className="w-2 h-2 rounded-full bg-border" />}
                        </span>
                        <span className={`text-sm font-bold ${status === 'pending' ? 'text-text-secondary/50' : 'text-text'}`}>
                            {p.label}
                        </span>
                        {status === 'active' && progress?.count != null && (
                            <span className="text-text-secondary text-xs tabular-nums">({progress.count})</span>
                        )}
                    </div>
                )
            })}
        </div>
    )
}

export default function BackupModal({ sourceAddress, onClose }) {
    const { createNewAddress, removeAddress } = useAddress()

    const [tab, setTab] = useState('self') // 'self' = nhân bản trong tài khoản này | 'other' = sang tài khoản khác

    // ── Tab "self": nhân bản sang địa chỉ mới trong tài khoản này ──
    const [newName, setNewName] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [done, setDone] = useState(false)
    const [progress, setProgress] = useState(null)
    const submitGuardRef = useRef(false)

    // ── Tab "other": phát link/mã cho tài khoản khác clone xuyên tài khoản ──
    const [shareCode, setShareCode] = useState('')
    const [sharing, setSharing] = useState(false)
    const [shareErr, setShareErr] = useState('')
    const [codeCopied, setCodeCopied] = useState(false)
    const [linkCopied, setLinkCopied] = useState(false)

    const shareLink = shareCode ? `${window.location.origin}/signup?clone=${shareCode}` : ''

    async function handleGenerateCode() {
        setShareErr('')
        setSharing(true)
        try {
            const code = await createAddressShareCode(sourceAddress.id)
            setShareCode(code)
        } catch (err) {
            setShareErr(err.message || 'Không thể tạo mã')
        } finally {
            setSharing(false)
        }
    }

    async function handleCopyCode() {
        if (await copyText(shareCode)) {
            setCodeCopied(true)
            setTimeout(() => setCodeCopied(false), 2000)
        }
    }

    async function handleCopyLink() {
        if (await copyText(shareLink)) {
            setLinkCopied(true)
            setTimeout(() => setLinkCopied(false), 2000)
        }
    }

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
                            <p className="text-text font-black text-sm leading-none">Nhân bản cấu hình</p>
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
                        <p className="text-text font-black text-base">Nhân bản thành công!</p>
                        <p className="text-text-secondary text-sm text-center">
                            Đã sao chép toàn bộ cấu hình từ <span className="text-text font-bold">{sourceAddress.name}</span> sang địa chỉ mới.
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
                        {/* ── Tabs (ẩn khi đang chạy) ── */}
                        {!loading && (
                            <div className="flex gap-2">
                                {[
                                    { key: 'self', label: 'Cùng tài khoản' },
                                    { key: 'other', label: 'Khác tài khoản' },
                                ].map(t => (
                                    <button
                                        key={t.key}
                                        onClick={() => { setTab(t.key); setError(''); setShareErr('') }}
                                        className={`flex-1 py-2.5 rounded-[12px] text-xs font-black border transition-all ${tab === t.key
                                            ? 'bg-primary/10 text-primary border-primary/30'
                                            : 'bg-bg text-text-secondary border-border/60 hover:bg-surface-light'}`}
                                    >
                                        {t.label}
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* ════ TAB: trong tài khoản này ════ */}
                        {tab === 'self' && (
                            loading ? (
                                <div className="space-y-2">
                                    <p className="text-xs font-black text-text-secondary uppercase tracking-wider">Đang nhân bản...</p>
                                    <PhaseChecklist progress={progress} />
                                </div>
                            ) : (
                                <>
                                    <div className="space-y-2">
                                        <p className="text-xs font-black text-text-secondary uppercase tracking-wider">Tên địa chỉ mới</p>
                                        <input
                                            type="text"
                                            value={newName}
                                            onChange={e => setNewName(e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
                                            placeholder="vd: KOPHIN Cầu Giấy"
                                            autoFocus
                                            className="w-full px-4 py-3 rounded-[12px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                                        />
                                    </div>

                                    {error && <p className="text-danger text-xs font-medium px-1">{error}</p>}

                                    <div className="flex gap-2 pb-1">
                                        <button
                                            onClick={onClose}
                                            className="flex-1 py-3 rounded-[14px] bg-bg border border-border/60 text-text-secondary font-bold text-sm hover:bg-surface-light transition-colors"
                                        >
                                            Hủy
                                        </button>
                                        <button
                                            onClick={handleSubmit}
                                            disabled={!newName.trim()}
                                            className="flex-1 py-3 rounded-[14px] bg-primary text-black font-black text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                        >
                                            Nhân bản <ChevronRight size={15} />
                                        </button>
                                    </div>
                                </>
                            )
                        )}

                        {/* ════ TAB: sang tài khoản khác ════ */}
                        {tab === 'other' && (
                            <div className="space-y-2">
                                {shareCode ? (
                                    <>
                                        {/* Link mời — ô chọn được + nút copy (chép tay được cả khi clipboard bị chặn, vd webview Zalo) */}
                                        <div className="flex gap-2">
                                            <input
                                                readOnly
                                                value={shareLink}
                                                onFocus={e => e.target.select()}
                                                className="flex-1 min-w-0 px-3 py-2.5 rounded-[12px] bg-bg border border-border/60 text-text-secondary text-xs font-medium focus:outline-none focus:border-primary/40 truncate"
                                            />
                                            <button
                                                onClick={handleCopyLink}
                                                className="px-3 py-2.5 bg-primary text-black rounded-[12px] shrink-0 hover:bg-primary/90 active:scale-95 transition-all flex items-center gap-1.5 font-black text-xs"
                                                title="Sao chép link mời"
                                            >
                                                {linkCopied ? <><Check size={14} /> Đã chép</> : <><Copy size={14} /> Chép link</>}
                                            </button>
                                        </div>
                                        <div className="text-text-secondary text-[11px] space-y-1 pt-0.5">
                                            <p className="font-bold text-text">Gửi link cho chủ chi nhánh mới — họ:</p>
                                            <p className="flex gap-2"><span className="text-primary font-bold shrink-0">•</span><span>Bấm link, tự đăng ký tài khoản riêng</span></p>
                                            <p className="flex gap-2"><span className="text-primary font-bold shrink-0">•</span><span>Tạo địa chỉ → <span className="font-bold text-text">tự chép toàn bộ cấu hình</span></span></p>
                                            <p className="flex gap-2"><span className="text-primary font-bold shrink-0">•</span><span>Link dùng lại nhiều lần, hết hạn 30 ngày</span></p>
                                        </div>
                                        {/* Mã thủ công (fallback nếu không bấm được link) */}
                                        <div className="flex items-center gap-2 pt-0.5">
                                            <span className="text-text-secondary text-[11px] shrink-0">Hoặc mã:</span>
                                            <code className="flex-1 min-w-0 text-text font-black tracking-widest text-sm truncate">{shareCode}</code>
                                            <button
                                                onClick={handleCopyCode}
                                                className="p-1.5 text-text-secondary hover:text-text rounded-lg hover:bg-surface-light transition-colors shrink-0"
                                                title="Sao chép mã"
                                            >
                                                {codeCopied ? <Check size={13} /> : <Copy size={13} />}
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <p className="text-text-secondary text-[11px] px-1">
                                            Tạo 1 link gửi cho chủ chi nhánh khác. Họ tự đăng ký tài khoản riêng và chép nguyên cấu hình này.
                                        </p>
                                        <button
                                            onClick={handleGenerateCode}
                                            disabled={sharing}
                                            className="w-full py-2.5 rounded-[12px] bg-primary text-black font-black text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                        >
                                            {sharing ? <><Loader size={14} className="animate-spin" /> Đang tạo link...</> : <><Share2 size={14} /> Tạo link mời</>}
                                        </button>
                                    </>
                                )}
                                {shareErr && <p className="text-danger text-xs font-medium px-1">{shareErr}</p>}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
