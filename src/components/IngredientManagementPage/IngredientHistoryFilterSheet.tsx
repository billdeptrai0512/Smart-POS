import { BottomSheet, SheetHeader, SHEET_PANEL } from '../common/ModalShell'
import type { Row } from '../../types/domain'

export type HistoryKind = 'restock' | 'adjustment' | 'withdrawal' | 'cancelled'

export const HISTORY_KINDS: [HistoryKind, string][] = [
    ['restock', 'Nhập kho'],
    ['adjustment', 'Hiệu chỉnh tồn'],
    ['withdrawal', 'Rút ra quầy'],
    ['cancelled', 'Đã hủy'],
]

// Đã hủy ưu tiên trước loại gốc (phiếu hủy bị zero trong DB nhưng vẫn mang cờ adjustment/restock).
export const kindOf = (e: Row): HistoryKind =>
    e.metadata?.cancelled ? 'cancelled' : e.is_withdrawal ? 'withdrawal' : e.metadata?.adjustment ? 'adjustment' : 'restock'

interface Props {
    onClose: () => void
    kind: HistoryKind | null
    onKind: (k: HistoryKind | null) => void
    /** {id: name} — chỉ truyền khi địa chỉ thuộc 1 warehouse group (kho tổng chung). */
    addressNameById?: Record<string, string> | null
    addressFilter: string | null
    onAddressFilter: (id: string | null) => void
}

// Lọc nhật ký NVL: áp dụng ngay khi chạm chip, "Xong" chỉ để đóng.
export default function IngredientHistoryFilterSheet({ onClose, kind, onKind, addressNameById, addressFilter, onAddressFilter }: Props) {
    return (
        <BottomSheet onClose={onClose} panelClassName={SHEET_PANEL}>
            <SheetHeader title="Lọc nhật ký" onClose={onClose} />
            {addressNameById && (
                <Group label="Địa chỉ">
                    {[[null, 'Tất cả'], ...Object.entries(addressNameById)].map(([id, name]) => (
                        <Chip key={id ?? 'all'} active={addressFilter === id} onClick={() => onAddressFilter(id)}>{name}</Chip>
                    ))}
                </Group>
            )}
            <Group label="Loại thẻ">
                <Chip active={kind === null} onClick={() => onKind(null)}>Tất cả</Chip>
                {HISTORY_KINDS.map(([k, name]) => (
                    <Chip key={k} active={kind === k} onClick={() => onKind(k)}>{name}</Chip>
                ))}
            </Group>
            <button
                type="button"
                onClick={onClose}
                className="py-3 rounded-[14px] bg-primary text-black font-black text-sm hover:bg-primary/90 transition-colors"
            >
                Xong
            </button>
        </BottomSheet>
    )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-text-secondary">{label}</span>
            <div className="flex flex-wrap gap-2">{children}</div>
        </div>
    )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`px-3 py-1.5 rounded-full border text-[12px] font-bold transition-colors ${
                active ? 'bg-primary/15 border-primary/40 text-primary' : 'bg-surface-light border-border/60 text-text-secondary'}`}
        >
            {children}
        </button>
    )
}
