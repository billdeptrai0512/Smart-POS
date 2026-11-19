import type { ReactNode } from 'react'

export const FIELD_INPUT = 'bg-surface-light border border-border/60 rounded-[12px] px-3 py-2.5 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-primary/40 transition-colors'

// Nhãn nhỏ phía trên ô nhập của các form tạo (món / thành phẩm / topping): placeholder biến mất khi gõ nên cần nhãn cố định.
export default function FormField({ label, className = '', children }: { label: string; className?: string; children: ReactNode }) {
    return (
        <label className={`flex flex-col gap-1.5 ${className}`}>
            <span className="text-[11px] font-black uppercase tracking-widest text-text-secondary">{label}</span>
            {children}
        </label>
    )
}
