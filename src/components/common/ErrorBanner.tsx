interface Props { message?: string | null; small?: boolean; className?: string }

export default function ErrorBanner({ message, small = false, className = '' }: Props) {
    if (!message) return null
    const base = small
        ? 'bg-danger/10 border border-danger/20 text-danger text-xs font-medium rounded-[10px] p-2'
        : 'bg-danger/10 border border-danger/20 text-danger text-sm font-medium rounded-[12px] p-3'
    return <div className={`${base} ${className}`}>{message}</div>
}
