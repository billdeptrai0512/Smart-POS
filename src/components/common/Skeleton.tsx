import type { HTMLAttributes } from 'react'

export default function Skeleton({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            className={`animate-pulse bg-surface-light rounded-[16px] ${className}`}
            {...props}
        />
    )
}
