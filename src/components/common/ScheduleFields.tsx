import DayOfWeekPicker from './DayOfWeekPicker'

interface Props {
    days: number[]
    startDate: string
    endDate: string
    onChange: (patch: { days?: number[]; startDate?: string; endDate?: string }) => void
    disabled?: boolean
}

const DATE_CLASS = 'w-full bg-surface-light border border-border/60 rounded-[12px] px-3 py-2 text-[13px] font-medium text-text focus:outline-none focus:border-primary/40 transition-colors disabled:opacity-60'

// Thứ trong tuần (rỗng = mọi thứ) + khoảng ngày (để trống = không giới hạn phía đó).
export default function ScheduleFields({ days, startDate, endDate, onChange, disabled }: Props) {
    return (
        <>
            <DayOfWeekPicker value={days} onChange={d => onChange({ days: d })} disabled={disabled} />
            <div className="flex gap-2 mt-3">
                <label className="flex-1">
                    <span className="block text-[11px] font-bold text-text-secondary mb-1">Từ ngày</span>
                    <input type="date" disabled={disabled} value={startDate} onChange={e => onChange({ startDate: e.target.value })} className={DATE_CLASS} />
                </label>
                <label className="flex-1">
                    <span className="block text-[11px] font-bold text-text-secondary mb-1">Đến ngày</span>
                    <input type="date" disabled={disabled} value={endDate} onChange={e => onChange({ endDate: e.target.value })} className={DATE_CLASS} />
                </label>
            </div>
        </>
    )
}
