// Input với label nằm trong placeholder lúc rỗng, nổi lên nằm ngang border khi
// focus/có giá trị (peer + :placeholder-shown, không cần JS theo dõi state).
export default function FloatingLabelInput({
    id,
    label,
    type = 'text',
    value,
    onChange,
    required = false,
    autoComplete,
    className = '',
    ...rest
}) {
    return (
        <div className="relative">
            <input
                id={id}
                type={type}
                value={value}
                onChange={onChange}
                required={required}
                autoComplete={autoComplete}
                placeholder=" "
                className={`peer w-full px-4 py-3 rounded-[14px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all ${className}`}
                {...rest}
            />
            <label
                htmlFor={id}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary text-xs font-bold uppercase tracking-wider transition-all duration-150 pointer-events-none
                    peer-focus:top-0 peer-focus:text-[10px] peer-focus:px-1 peer-focus:bg-surface peer-focus:text-primary
                    peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:text-[10px] peer-[:not(:placeholder-shown)]:px-1 peer-[:not(:placeholder-shown)]:bg-surface"
            >
                {label}
            </label>
        </div>
    )
}
