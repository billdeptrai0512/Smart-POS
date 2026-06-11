import { useState } from 'react'
import { Phone, Loader2, Check } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { setMyPhone } from '../../services/authService'
import { useMonetizationEnabled } from '../../hooks/useEntitlement'

/**
 * AccountCard — SĐT của tài khoản đang đăng nhập (xem/nhập/sửa).
 * Đặt ở tab Staff (AddressSelectPage). Giai đoạn B sẽ gắn nút "Xác thực OTP" vào đây.
 * Lưu qua RPC set_my_phone — lần đầu nhập có thể được cấp trial (1 SĐT = 1 lần).
 */
export default function AccountCard() {
    const { profile, refreshProfile, isGuest } = useAuth()
    const { enabled: monetizationEnabled } = useMonetizationEnabled()
    const [editing, setEditing] = useState(false)
    const [value, setValue] = useState('')
    const [busy, setBusy] = useState(false)
    const [notice, setNotice] = useState('')   // thông báo thành công (vd: trial kích hoạt)
    const [err, setErr] = useState('')

    if (isGuest || !profile) return null

    const phone = profile.phone

    async function handleSave() {
        if (!value.trim() || busy) return
        setBusy(true)
        setErr('')
        setNotice('')
        try {
            const result = await setMyPhone(value.trim())
            refreshProfile()
            setEditing(false)
            setValue('')
            if (result === 'trial_granted') {
                setNotice('Đã kích hoạt 7 ngày dùng thử báo cáo 🎉')
            }
        } catch (e) {
            setErr(e.message || 'Không thể lưu số điện thoại')
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="bg-surface border border-border/60 rounded-[20px] p-3 space-y-2">
            <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${phone ? 'bg-primary/10' : 'bg-surface-light'}`}>
                    <Phone size={16} className={phone ? 'text-primary' : 'text-text-secondary'} />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-text text-sm font-bold truncate">Số điện thoại</p>
                    <p className="text-text-secondary text-xs truncate">
                        {phone || (monetizationEnabled
                            ? 'Nhập SĐT để nhận 7 ngày dùng thử báo cáo'
                            : 'Chưa có số điện thoại')}
                    </p>
                </div>
                {!editing && (
                    <button
                        onClick={() => { setEditing(true); setValue(phone || ''); setNotice(''); setErr('') }}
                        className="px-3 py-1.5 rounded-[10px] bg-surface-light border border-border/60 text-text-secondary text-xs font-bold hover:text-text active:scale-95 transition-all shrink-0"
                    >
                        {phone ? 'Sửa' : 'Nhập'}
                    </button>
                )}
            </div>

            {editing && (
                <div className="flex gap-2">
                    <input
                        type="tel"
                        autoFocus
                        placeholder="Số điện thoại (vd: 0901234567)"
                        value={value}
                        onChange={e => setValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
                        className="flex-1 min-w-0 bg-surface-light border border-border/60 rounded-[12px] px-3 py-2 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-primary/40 transition-colors"
                    />
                    <button
                        onClick={handleSave}
                        disabled={!value.trim() || busy}
                        className="px-3 rounded-[12px] bg-primary text-bg font-black hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-50 shrink-0 flex items-center"
                    >
                        {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    </button>
                    <button
                        onClick={() => { setEditing(false); setErr('') }}
                        disabled={busy}
                        className="px-3 rounded-[12px] bg-surface-light border border-border/60 text-text-secondary text-xs font-bold hover:text-text active:scale-95 transition-all disabled:opacity-50 shrink-0"
                    >
                        Huỷ
                    </button>
                </div>
            )}

            {notice && <p className="text-primary text-xs font-bold px-1">{notice}</p>}
            {err && <p className="text-danger text-xs font-medium px-1">{err}</p>}
        </div>
    )
}
