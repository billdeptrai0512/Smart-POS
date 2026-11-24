import type { ReactNode } from 'react'

// Co/giãn chiều cao + mờ dần khi `show` đổi — dải guide hiện/biến mất mượt, không làm giật phần trang bên dưới.
// Khoảng cách (pt-…) phải đặt TRONG children: phần đó bị cắt nên co về 0 cùng dải.
export default function Collapse({ show, className = '', children }: { show: boolean; className?: string; children: ReactNode }) {
    return (
        <div className={`grid transition-[grid-template-rows,opacity] duration-300 ${show ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'} ${className}`}>
            <div className="min-h-0 overflow-hidden">{children}</div>
        </div>
    )
}
