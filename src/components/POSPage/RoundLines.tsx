import type { TableRound } from '../../services/orderService'

// Dòng món của một đợt/đơn (TableDetailModal, TakeawayListModal). Topping/option + ghi chú
// xuống dòng riêng, cùng kiểu thẻ đơn ở Nhật ký (OrdersList).
export default function RoundLines({ lines }: { lines: TableRound['lines'] }) {
    return (
        <div className="flex flex-col gap-0.5 border-t border-border/40 pt-2 pb-2 pl-2">
            {lines.map(l => (
                <div key={l.name} className="flex flex-col gap-0.5">
                    <span className="text-[13px] font-bold text-text leading-snug">
                        {l.qty > 1 && <span className="tabular-nums text-text-secondary">{l.qty} </span>}{l.dish}
                    </span>
                    {l.opts.map(o => (
                        <span key={o} className="pl-2.5 text-[12px] leading-snug text-text-secondary/70">• {o}</span>
                    ))}
                    {l.note && (
                        <span className="pl-2.5 text-[12px] leading-snug italic text-text-secondary break-words">Ghi chú: {l.note}</span>
                    )}
                </div>
            ))}
        </div>
    )
}
