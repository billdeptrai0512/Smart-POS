import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

// Input mật khẩu dùng chung Login/Đăng ký — cùng style input thường, cộng nút mắt toggle hiện/ẩn.
// Truyền id + label để bật floating label (nổi lên nằm ngang border khi focus/có giá trị,
// pattern giống FloatingLabelInput). Không truyền thì dùng placeholder tĩnh như cũ.
export default function PasswordInput({
    id,
    label,
    value,
    onChange,
    placeholder,
    required = false,
    autoComplete,
    className = '',
}) {
    const [visible, setVisible] = useState(false)

    return (
        <div className="relative">
            <input
                id={id}
                type={visible ? 'text' : 'password'}
                value={value}
                onChange={onChange}
                required={required}
                autoComplete={autoComplete}
                placeholder={label ? ' ' : placeholder}
                className={`peer w-full px-4 py-3 pr-11 rounded-[14px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all ${className}`}
            />
            {label && (
                <label
                    htmlFor={id}
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary text-xs font-bold uppercase tracking-wider transition-all duration-150 pointer-events-none
                        peer-focus:top-0 peer-focus:text-[10px] peer-focus:px-1 peer-focus:bg-surface peer-focus:text-primary
                        peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:text-[10px] peer-[:not(:placeholder-shown)]:px-1 peer-[:not(:placeholder-shown)]:bg-surface"
                >
                    {label}
                </label>
            )}
            <button
                type="button"
                onClick={() => setVisible(v => !v)}
                tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text transition-colors"
                aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
            >
                {visible ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
        </div>
    )
}
