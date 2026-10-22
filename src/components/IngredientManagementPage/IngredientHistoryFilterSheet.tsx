import { useState, type ReactNode } from 'react'
import { X, Layers, type LucideIcon, PackagePlus, Scale, Store, Ban, FlaskConical, CircleDollarSign, CircleCheck } from 'lucide-react'
import { BottomSheet, SHEET_PANEL } from '../common/ModalShell'
import Dropdown from '../common/Dropdown'
import type { Row } from '../../types/domain'

export type HistoryKind = 'restock' | 'adjustment' | 'withdrawal' | 'production' | 'cancelled'

const HISTORY_KINDS: [HistoryKind, string, LucideIcon][] = [
    ['restock', 'Nhập kho', PackagePlus],
    ['adjustment', 'Hiệu chỉnh tồn', Scale],
    ['withdrawal', 'Rút ra quầy', Store],
    ['production', 'Sản xuất', FlaskConical],
    ['cancelled', 'Đã hủy', Ban],
]

// Đã hủy ưu tiên trước loại gốc (phiếu hủy bị zero trong DB nhưng vẫn mang cờ adjustment/restock).
export const kindOf = (e: Row): HistoryKind =>
    e.metadata?.cancelled ? 'cancelled' : e.is_withdrawal ? 'withdrawal' : e.is_production ? 'production' : e.metadata?.adjustment ? 'adjustment' : 'restock'

type DebtStatus = 'owing' | 'paid'

// Chỉ phiếu nhập còn hiệu lực mới có công nợ; các loại thẻ khác → null (bị loại khi lọc theo công nợ).
export const debtOf = (e: Row): DebtStatus | null => {
    if (kindOf(e) !== 'restock') return null
    const paid = (e.payments || []).reduce((s: number, p: Row) => s + (p.amount || 0), 0)
    return (e.amount || 0) - paid > 0 ? 'owing' : 'paid'
}

export interface HistoryFilter { kind: HistoryKind | null; address: string | null; staff: string | null; debt: DebtStatus | null }

interface Props {
    onClose: () => void
    value: HistoryFilter
    /** Tên người ghi nhận có trong khoảng ngày đang xem. */
    staffNames: string[]
    /** {id: name} — chỉ truyền khi địa chỉ thuộc 1 warehouse group (kho tổng chung). */
    addressNameById?: Record<string, string> | null
    onApply: (f: HistoryFilter) => void
}

// Lọc nhật ký NVL: chọn loại thẻ (ô icon) + địa chỉ (dropdown) trên bản nháp, bấm "Lọc" mới áp dụng; X = bỏ qua.
export default function IngredientHistoryFilterSheet({ onClose, value, staffNames, addressNameById, onApply }: Props) {
    const [f, setF] = useState(value)
    const set = <K extends keyof HistoryFilter>(key: K, v: HistoryFilter[K]) => setF(cur => ({ ...cur, [key]: v }))
    return (
        <BottomSheet onClose={onClose} panelClassName={`${SHEET_PANEL} gap-5`}>
            <div className="relative flex items-center justify-center min-h-8">
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Đóng"
                    className="absolute left-0 w-8 h-8 flex items-center justify-center rounded-full bg-surface-light border border-border/60 text-text-secondary hover:text-text transition-all"
                >
                    <X size={16} />
                </button>
                <span className="text-[15px] font-black uppercase tracking-wide text-text">Lọc nhật ký</span>
            </div>

            <Group label="Loại thẻ">
                <TileRow value={f.kind} options={HISTORY_KINDS} onChange={v => set('kind', v)} />
            </Group>

            <Group label="Công nợ">
                <TileRow value={f.debt} options={[['owing', 'Còn nợ', CircleDollarSign], ['paid', 'Đã trả đủ', CircleCheck]]} onChange={v => set('debt', v)} />
            </Group>

            {staffNames.length > 0 && (
                <Group label="Người ghi nhận">
                    <Select value={f.staff} all="Tất cả" options={staffNames.map(n => [n, n])} onChange={v => set('staff', v)} />
                </Group>
            )}

            {addressNameById && (
                <Group label="Địa chỉ">
                    <Select value={f.address} all="Tất cả địa chỉ" options={Object.entries(addressNameById)} onChange={v => set('address', v)} />
                </Group>
            )}

            <button
                type="button"
                onClick={() => { onApply(f); onClose() }}
                className="h-12 rounded-[14px] bg-primary text-bg text-[14px] font-black uppercase tracking-wide active:scale-[0.98] transition-all"
            >
                Lọc
            </button>
        </BottomSheet>
    )
}

function Select({ value, all, options, onChange }: { value: string | null; all: string; options: [string, string][]; onChange: (v: string | null) => void }) {
    return (
        <Dropdown
            up
            align="left"
            value={value ?? ''}
            triggerLabel={options.find(([v]) => v === value)?.[1] ?? all}
            onChange={v => onChange(v || null)}
            items={[{ value: '', label: all }, ...options.map(([v, name]) => ({ value: v, label: name }))]}
            triggerClassName="h-12 px-4 rounded-[14px] bg-surface-light border border-border/60 text-[14px]"
        />
    )
}

function Group({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-2">
            <span className="text-[12px] font-bold text-text-secondary">{label}</span>
            {children}
        </div>
    )
}

// Hàng ô icon, tự thêm ô "Tất cả" (null) ở đầu.
function TileRow<T extends string>({ value, options, onChange }: { value: T | null; options: [T, string, LucideIcon][]; onChange: (v: T | null) => void }) {
    return (
        <div className="grid grid-cols-3 gap-2">
            <Tile active={value === null} icon={Layers} onClick={() => onChange(null)}>Tất cả</Tile>
            {options.map(([key, name, icon]) => <Tile key={key} active={value === key} icon={icon} onClick={() => onChange(key)}>{name}</Tile>)}
        </div>
    )
}

function Tile({ active, icon: Icon, onClick, children }: { active: boolean; icon: LucideIcon; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`h-[84px] flex flex-col items-center justify-center gap-2 rounded-[14px] border text-[12px] font-bold transition-colors ${
                active ? 'bg-primary/15 border-primary/50 text-primary' : 'bg-surface-light border-border/60 text-text-secondary'}`}
        >
            <Icon size={22} strokeWidth={2} />
            {children}
        </button>
    )
}
