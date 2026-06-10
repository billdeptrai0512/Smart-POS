import { useState, useEffect } from 'react'
import { Power, Loader2 } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabaseClient'

/**
 * MonetizationToggle — công tắc bật/tắt monetization runtime (server kill switch).
 * CHỈ admin thấy. Ghi vào app_config.monetization_enabled qua RPC admin_set_app_config
 * (bảng chỉ có RLS SELECT → phải qua RPC SECURITY DEFINER).
 *
 * Đổi xong reload trang để toàn app (cache server flag ở useEntitlement) nhận trạng thái mới.
 * Lưu ý: chỉ có hiệu lực khi build client bật (VITE_MONETIZATION_ENABLED=true);
 * nếu client tắt cứng thì toggle này không làm gì ở phía UI gate.
 */
export default function MonetizationToggle() {
    const { isAdmin } = useAuth()
    const [value, setValue] = useState(null)   // 'true' | 'false' | null (đang tải)
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        if (!isAdmin) return
        let cancelled = false
        supabase
            .from('app_config')
            .select('value')
            .eq('key', 'monetization_enabled')
            .maybeSingle()
            .then(({ data }) => {
                if (!cancelled) setValue(data?.value === 'true' ? 'true' : 'false')
            })
        return () => { cancelled = true }
    }, [isAdmin])

    if (!isAdmin) return null

    const on = value === 'true'

    const handleToggle = async () => {
        if (busy || value === null) return
        setBusy(true)
        try {
            const { error } = await supabase.rpc('admin_set_app_config', {
                p_key: 'monetization_enabled',
                p_value: on ? 'false' : 'true',
            })
            if (error) throw error
            // Reload để cache server flag + toàn bộ gate nhận trạng thái mới.
            window.location.reload()
        } catch (e) {
            alert('Lỗi: ' + e.message)
            setBusy(false)
        }
    }

    return (
        <div className="bg-surface border border-border/60 rounded-[20px] p-3 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${on ? 'bg-primary/10' : 'bg-surface-light'}`}>
                <Power size={16} className={on ? 'text-primary' : 'text-text-secondary'} />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-text text-sm font-black">Tính tiền user</p>
                {/* <p className="text-text-secondary text-[11px] leading-tight">
                    {value === null
                        ? 'Đang tải…'
                        : on
                            ? 'Đang BẬT — gate & đăng ký gói hoạt động'
                            : 'Đang TẮT — mọi tính năng mở khoá'}
                </p> */}
            </div>
            <button
                onClick={handleToggle}
                disabled={busy || value === null}
                role="switch"
                aria-checked={on}
                title="Bật/tắt thu phí (server)"
                className={`relative w-12 h-7 rounded-full shrink-0 transition-colors disabled:opacity-50 ${on ? 'bg-primary' : 'bg-border'}`}
            >
                {busy
                    ? <Loader2 size={14} className="animate-spin text-bg absolute inset-0 m-auto" />
                    : <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? 'left-6' : 'left-1'}`} />}
            </button>
        </div>
    )
}
