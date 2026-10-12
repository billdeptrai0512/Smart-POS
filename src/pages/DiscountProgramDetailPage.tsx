import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { useProducts } from '../contexts/ProductContext'
import { useAuth } from '../contexts/AuthContext'
import { useConfirm } from '../contexts/ConfirmContext'
import { useToast } from '../hooks/useToast'
import { useSavingAction } from '../hooks/useSavingAction'
import { useProductLinks } from '../hooks/useProductLinks'
import Toast from '../components/POSPage/Toast'
import EditableEntityHeader from '../components/common/EditableEntityHeader'
import ScheduleFields from '../components/common/ScheduleFields'
import DiscountTypePicker from '../components/common/DiscountTypePicker'
import MoneyInput from '../components/common/MoneyInput'
import ToggleSwitch from '../components/common/ToggleSwitch'
import ProductLinksSection from '../components/common/ProductLinksSection'
import { clampPercentInput, parseDiscountValue, type DiscountProgram } from '../utils/discountPrograms'
import {
    updateDiscountProgram, deleteDiscountProgram,
    fetchDiscountProgramProductLinks, setDiscountProgramProducts,
} from '../services/discountService'
import { ICON_BTN_DANGER } from '../components/common/ModalShell'

export default function DiscountProgramDetailPage() {
    const navigate = useNavigate()
    const { id: programId } = useParams() as { id: string }
    const { discountPrograms, products, refreshProducts } = useProducts()
    const { isManager, isAdmin } = useAuth()
    const canEdit = isManager || isAdmin
    const { toast, showToast, showError } = useToast()
    const confirm = useConfirm()

    const program = discountPrograms.find(p => p.id === programId)

    const { saving, withSaving } = useSavingAction(showError)
    const productLinks = useProductLinks()

    useEffect(() => {
        let cancelled = false
        async function load() {
            const links = await fetchDiscountProgramProductLinks([programId])
            if (cancelled) return
            productLinks.reset(new Set(links.map(l => l.product_id)))
        }
        load()
        return () => { cancelled = true }
    }, [programId, productLinks.reset])

    async function saveName(name: string) {
        if (!name.trim()) return
        await withSaving('Lưu tên chương trình', async () => {
            await updateDiscountProgram(programId, { name: name.trim() })
            await refreshProducts()
        })
    }

    async function saveValue(type: string, rawValue: number) {
        if (rawValue <= 0) return
        await withSaving('Lưu mức giảm', async () => {
            await updateDiscountProgram(programId, { type, value: rawValue })
            await refreshProducts()
        })
    }

    async function saveSchedule(days: number[], startDate: string, endDate: string) {
        await withSaving('Lưu lịch áp dụng', async () => {
            await updateDiscountProgram(programId, { days_of_week: days, start_date: startDate || null, end_date: endDate || null })
            await refreshProducts()
        })
    }

    async function toggleEnabled() {
        await withSaving('Bật/tắt chương trình', async () => {
            await updateDiscountProgram(programId, { enabled: !program!.enabled })
            await refreshProducts()
        })
    }

    async function saveLinks() {
        await withSaving('Lưu danh sách món áp dụng', async () => {
            await setDiscountProgramProducts(programId, [...productLinks.selected])
            productLinks.markSaved()
            await refreshProducts()
            showToast('Đã lưu', 'success')
        })
    }

    async function handleDelete() {
        if (!await confirm({ title: `Xoá chương trình "${program!.name}"?`, danger: true, confirmLabel: 'Xoá' })) return
        await withSaving('Xoá chương trình', async () => {
            await deleteDiscountProgram(programId)
            await refreshProducts()
            navigate('/category/discounts')
        })
    }

    if (!program) {
        return (
            <div className="flex flex-col h-full bg-bg items-center justify-center gap-3 px-6">
                <p className="text-text-secondary text-[13px] text-center">Không tìm thấy chương trình này (có thể đã bị xoá).</p>
                <button onClick={() => navigate('/category/discounts')} className="text-primary text-[13px] font-bold">Về danh sách chương trình</button>
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full bg-bg">
            <Toast toast={toast} />

            <EditableEntityHeader
                name={program.name}
                canEdit={canEdit}
                onBack={() => navigate('/category/discounts')}
                onSaveName={saveName}
                action={canEdit && (
                    <button
                        onClick={handleDelete}
                        className={ICON_BTN_DANGER}
                        title="Xoá chương trình"
                    >
                        <Trash2 size={20} strokeWidth={2.5} />
                    </button>
                )}
            />

            <main className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-bg">
                <section className="bg-surface border border-border/60 rounded-[16px] p-4 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                        <p className="text-text text-sm font-black">Bật chương trình</p>
                        <p className="text-text-secondary text-[11px] leading-tight">
                            {program.enabled ? 'Đang tự động áp giá đúng lịch bên dưới' : 'Đang tắt — không áp giá dù đúng lịch'}
                        </p>
                    </div>
                    <ToggleSwitch checked={program.enabled} onChange={toggleEnabled} disabled={!canEdit || saving} />
                </section>

                <ValueSection key={program.id} program={program} canEdit={canEdit} saving={saving} onSave={saveValue} />

                <ScheduleSection key={program.id} program={program} canEdit={canEdit} saving={saving} onSave={saveSchedule} />

                <ProductLinksSection links={productLinks} products={products} canEdit={canEdit} saving={saving} onSave={saveLinks} />
            </main>
        </div>
    )
}

// Mức giảm: type/value cục bộ tách khỏi form cha vì có nút Lưu riêng — cha truyền
// key={program.id} nên state seed lại đúng (lazy initializer) mỗi khi đổi chương trình,
// khỏi cần effect đồng bộ riêng (cùng lý do DiscountEditor.tsx không cần effect đó).
interface SectionProps<T extends unknown[]> { program: DiscountProgram; canEdit?: boolean; saving: boolean; onSave: (...args: T) => void }

function ValueSection({ program, canEdit, saving, onSave }: SectionProps<[type: string, rawValue: number]>) {
    const [type, setType] = useState(program.type)
    const [valueInput, setValueInput] = useState(String(program.value))

    const rawValue = parseDiscountValue(type, valueInput)
    const dirty = type !== program.type || rawValue !== program.value

    return (
        <section>
            <span className="block text-[13px] font-black text-text uppercase tracking-wide mb-3">Mức giảm</span>
            <div className="mb-2">
                <DiscountTypePicker value={type} onChange={t => { setType(t); setValueInput('') }} disabled={!canEdit} />
            </div>
            {type === 'percent' ? (
                <input
                    type="text"
                    inputMode="numeric"
                    disabled={!canEdit}
                    value={valueInput}
                    onChange={e => setValueInput(clampPercentInput(e.target.value))}
                    className="w-full bg-surface-light border border-border/60 rounded-[12px] px-3 py-2.5 text-[14px] font-bold text-text text-right tabular-nums focus:outline-none focus:border-primary/40 transition-colors disabled:opacity-60"
                />
            ) : (
                <MoneyInput value={valueInput} onChange={setValueInput} disabled={!canEdit} />
            )}
            {canEdit && dirty && rawValue > 0 && (
                <button
                    onClick={() => onSave(type, rawValue)}
                    disabled={saving}
                    className="w-full mt-2 py-2.5 rounded-[12px] bg-primary text-bg text-[13px] font-black hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 uppercase"
                >
                    Lưu mức giảm
                </button>
            )}
        </section>
    )
}

// Lịch áp dụng: 2 bộ lọc độc lập — thứ trong tuần (rỗng = mọi thứ) và khoảng ngày (để trống =
// không giới hạn phía đó). State cục bộ tách khỏi form cha cùng lý do như ValueSection ở trên.
function ScheduleSection({ program, canEdit, saving, onSave }: SectionProps<[days: number[], startDate: string, endDate: string]>) {
    const [{ days, startDate, endDate }, setSchedule] = useState({
        days: program.days_of_week, startDate: program.start_date || '', endDate: program.end_date || '',
    })

    const dirty = days.join(',') !== program.days_of_week.join(',')
        || startDate !== (program.start_date || '') || endDate !== (program.end_date || '')

    return (
        <section className="pt-4 border-t border-border/40">
            <span className="block text-[13px] font-black text-text uppercase tracking-wide mb-1">Lịch áp dụng</span>
            <p className="text-[11px] text-text-secondary mb-3">Không chọn thứ nào = áp dụng mọi ngày. Để trống ngày = không giới hạn.</p>

            <ScheduleFields days={days} startDate={startDate} endDate={endDate} disabled={!canEdit}
                onChange={patch => setSchedule(prev => ({ ...prev, ...patch }))} />

            {canEdit && dirty && (
                <button
                    onClick={() => onSave(days, startDate, endDate)}
                    disabled={saving}
                    className="w-full mt-3 py-2.5 rounded-[12px] bg-primary text-bg text-[13px] font-black hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 uppercase"
                >
                    Lưu lịch áp dụng
                </button>
            )}
        </section>
    )
}
