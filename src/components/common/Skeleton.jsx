export default function Skeleton({ className = '', ...props }) {
    return (
        <div
            className={`animate-pulse bg-surface-light rounded-[16px] ${className}`}
            {...props}
        />
    )
}
