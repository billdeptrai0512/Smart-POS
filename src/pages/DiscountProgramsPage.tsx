import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../hooks/useToast'
import Toast from '../components/POSPage/Toast'
import IngredientDetailHeader from '../components/IngredientManagementPage/IngredientDetailHeader'
import MoneyInput from '../components/common/MoneyInput'
import DiscountTypePicker from '../components/common/DiscountTypePicker'
import ScheduleFields from '../components/common/ScheduleFields'
import { FormDialog } from '../components/common/ModalShell'
import { formatVND } from '../utils'
import { insertDiscountProgram } from '../services/discountService'
import { activePrograms, clampPercentInput, parseDiscountValue, TABLE_SCOPE_LABELS, type DiscountProgram, type TableScope } from '../utils/discountPrograms'
import { DISCOUNT_TYPE_LABELS } from '../constants/discountTypes'
import { DISCOUNT_TAB } from '../constants/menuTabs'

const initialForm = { name: '', type: 'fixed', value: '', days: [] as number[], startDate: '', endDate: '', tableScope: 'all' as TableScope }

function programSummary(p: Pick<DiscountProgram, 'type' | 'value' | 'table_scope'>) {
    const base = p.type === 'fixed' ? `Đồng giá ${formatVND(p.value)}` : p.type === 'percent' ? `Giảm ${p.value}%` : `Giảm ${formatVND(p.value)}`
    return p.table_scope && p.table_scope !== 'all' ? `${base} · ${TABLE_SCOPE_LABELS[p.table_scope]}` : base
}

export default function DiscountProgramsPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const { discountPrograms, refreshProducts } = useProducts()
    const { addressId } = useAddress()
    const { isManager, isAdmin } = useAuth()
    const canEdit = isManager || isAdmin
    const { toast, showToast, showError } = useToast()

    const [showCreate, setShowCreate] = useState(false)
    const [form, setForm] = useState(initialForm)
    const [saving, setSaving] = useState(false)

    const rawValue = parseDiscountValue(form.type, form.value)
    const canSubmit = !!form.name.trim() && rawValue > 0 && !!addressId && !saving

    function setField(patch: Partial<typeof initialForm>) {
        setForm(f => ({ ...f, ...patch }))
    }

    function resetForm() {
        setForm(initialForm)
        setShowCreate(false)
    }

    async function handleCreate() {
        if (!canSubmit) return
        setSaving(true)
        try {
            await insertDiscountProgram({
                name: form.name.trim(), type: form.type, value: rawValue, address_id: addressId,
                days_of_week: form.days, start_date: form.startDate || null, end_date: form.endDate || null, table_scope: form.tableScope, enabled: false,
            })
            await refreshProducts()
            resetForm()
            showToast('Đã tạo chương trình', 'success')
        } catch (err) {
            showError(err, 'Tạo chương trình giảm giá')
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="flex flex-col h-full bg-bg">
            <Toast toast={toast} />

            <IngredientDetailHeader
                title={DISCOUNT_TAB.label}
                subtitle={`${activePrograms(discountPrograms).length} đang chạy`}
                onBack={() => navigate('/category/overall', { state: location.state })}
                onAdd={canEdit && addressId ? () => setShowCreate(true) : undefined}
                addTitle="Tạo chương trình mới"
            />

            <main className="flex-1 overflow-y-auto px-4 py-4 pb-8 space-y-3">
                {!addressId && (
                    <p className="text-warning text-[13px] text-center py-4 bg-warning-soft rounded-[16px] border border-warning/20">
                        Chọn 1 địa chỉ cụ thể trước khi tạo chương trình giảm giá.
                    </p>
                )}

                {discountPrograms.length === 0 && (
                    <p className="text-text-secondary text-[13px] text-center py-8 bg-surface-light/50 rounded-[16px] border border-border/40">
                        Chưa có chương trình nào (VD: Đồng giá 10k thứ Hai...)
                    </p>
                )}

                {discountPrograms.map(p => (
                    <div
                        key={p.id}
                        onClick={() => navigate(`/category/discounts/${p.id}`)}
                        className="bg-surface border border-border/60 rounded-[16px] p-4 flex items-center justify-between gap-2 cursor-pointer transition-all shadow-sm hover:border-text/30 hover:shadow-md active:scale-[0.98]"
                    >
                        <div className="min-w-0">
                            <h3 className="font-black text-[15px] text-text truncate">{p.name}</h3>
                            <span className="text-[12px] text-text-secondary">{programSummary(p)}</span>
                        </div>
                        <span className={`text-[11px] font-black uppercase shrink-0 px-2 py-1 rounded-full ${p.enabled ? 'bg-success/10 text-success' : 'bg-border/40 text-text-secondary'}`}>
                            {p.enabled ? 'Đang bật' : 'Đang tắt'}
                        </span>
                    </div>
                ))}

                {showCreate && (
                    <FormDialog title="Tạo chương trình mới" saving={saving} canSubmit={canSubmit} onClose={resetForm} onConfirm={handleCreate}>
                        <div className="pb-3 border-b border-border/40">
                            <span className="block text-[11px] font-black text-text-secondary uppercase tracking-wide mb-1">Lịch áp dụng</span>
                            <ScheduleFields days={form.days} startDate={form.startDate} endDate={form.endDate} onChange={setField} />
                        </div>

                        <label className="flex flex-col">
                            <span className="block text-[11px] font-black text-text-secondary uppercase tracking-wide mb-1">Tên chương trình</span>
                            <input
                                type="text"
                                placeholder="VD: Đồng giá thứ Hai"
                                value={form.name}
                                onChange={e => setField({ name: e.target.value })}
                                className="bg-surface-light border border-border/60 rounded-[12px] px-3 py-2.5 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-primary/40 transition-colors"
                            />
                        </label>
                        <div>
                            <span className="block text-[11px] font-black text-text-secondary uppercase tracking-wide mb-1">{DISCOUNT_TYPE_LABELS[form.type as keyof typeof DISCOUNT_TYPE_LABELS]}</span>
                            {form.type === 'percent' ? (
                                <div className="flex items-center bg-surface-light border border-border/60 rounded-[12px] focus-within:border-primary/40 transition-colors overflow-hidden">
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        placeholder="VD: 20"
                                        value={form.value}
                                        onChange={e => setField({ value: clampPercentInput(e.target.value) })}
                                        className="w-full bg-transparent px-3 py-2.5 text-[14px] font-bold text-text tabular-nums placeholder:text-text-secondary/40 placeholder:font-normal focus:outline-none"
                                    />
                                    {form.value && <span className="text-[12px] font-bold text-text-secondary pr-2.5 shrink-0 pointer-events-none">%</span>}
                                </div>
                            ) : (
                                <MoneyInput
                                    value={form.value}
                                    align="left"
                                    onChange={v => setField({ value: v })}
                                    onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
                                />
                            )}
                            <div className="mt-1.5">
                                <DiscountTypePicker value={form.type} onChange={t => setField({ type: t, value: '' })} />
                            </div>
                        </div>

                        <div className="pt-2 border-t border-border/40">
                            <span className="block text-[11px] font-black text-text-secondary uppercase tracking-wide mb-1">Áp dụng cho</span>
                            <DiscountTypePicker labels={TABLE_SCOPE_LABELS} value={form.tableScope} onChange={tableScope => setField({ tableScope: tableScope as TableScope })} />
                        </div>
                    </FormDialog>
                )}
            </main>
        </div>
    )
}
