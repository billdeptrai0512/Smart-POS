import { Check } from 'lucide-react'

// Danh sách yêu cầu mật khẩu mạnh, live-check theo từng ký tự gõ — dùng chung
// SignUpPage/ForgotPasswordPage/CreateStaffModal. `confirm` (optional) thêm rule
// "khớp nhau" khi có ô nhập lại mật khẩu.
export default function PasswordChecklist({ password, confirm }) {
    const rules = [
        { ok: password.length >= 8, label: 'Ít nhất 8 ký tự' },
        { ok: /[a-zA-Z]/.test(password), label: 'Có chữ cái' },
        { ok: /[0-9]/.test(password), label: 'Có chữ số' },
    ]
    if (confirm !== undefined) rules.push({ ok: !!password && password === confirm, label: 'Hai mật khẩu khớp nhau' })

    return (
        <ul className="mt-2 space-y-1">
            {rules.map((r, i) => (
                <li key={i} className={`flex items-center gap-1.5 text-[11px] ${r.ok ? 'text-success' : 'text-text-secondary'}`}>
                    <Check size={12} className={r.ok ? 'opacity-100' : 'opacity-30'} />
                    {r.label}
                </li>
            ))}
        </ul>
    )
}
