import { useState, useEffect } from 'react'
import { Package, Loader, X } from 'lucide-react'
import { Dialog, ModalHeader } from '../common/ModalShell'
import { errorMessage } from '../../utils/errorMessage'

/** Giá trị gửi lên khi lưu; tất cả null = xoá quy cách. */
export interface PackConfigValues {
    packUnit: string | null
    packSize: number | null
    pack2Unit: string | null
    pack2Size: number | null
}

interface Props {
    open: boolean
    onClose: () => void
    ingredientLabel: string
    baseUnit: string
    currentPackSize?: number | null
    currentPackUnit?: string | null
    currentPack2?: { size: number; unit: string } | null
    onSave: (values: PackConfigValues) => Promise<unknown> | unknown
}

const TEXT_INPUT = 'flex-1 min-w-0 bg-bg border border-border/60 rounded-[10px] px-3 py-2 text-text text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-50'
const CAPTION = 'text-[10px] font-black uppercase tracking-widest text-text-dim'
const OP = 'text-text-secondary font-bold text-sm shrink-0'   // "1" và "=" — mờ hơn ô nhập để mắt dừng ở giá trị
const NUM_INPUT = 'bg-bg border border-border/60 rounded-[10px] px-3 py-2 text-text text-sm font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'

/**
 * Modal cấu hình "quy cách đóng gói" cho 1 nguyên liệu.
 *
 * Manager nhập:
 *   - packUnit (TEXT): tên đơn vị nhập, vd: "hộp", "gói", "thùng", "bao"
 *   - packSize (number): số lượng [base_unit] trong 1 [packUnit]
 *   - (tuỳ chọn) cấp 2: pack2Unit/pack2Size = số [packUnit] trong 1 [pack2Unit]
 *
 * Ví dụ: nguyên liệu "Sữa đặc" (đơn vị ml) → 1 hộp = 380 ml; 1 thùng = 12 hộp.
 *
 * Dữ liệu này dùng cho:
 *   - "Đi chợ" smart forecast (làm tròn theo gói: vd hụt 350ml → mua 1 hộp 380ml)
 *   - Hiển thị "+1 hộp" thay vì "+380 ml" trong báo cáo bổ sung
 */
export default function PackConfigModal({
    open,
    onClose,
    ingredientLabel,
    baseUnit,           // vd 'ml', 'g'
    currentPackSize,    // number | null
    currentPackUnit,    // string | null
    currentPack2,       // { size, unit } | null — cấp 2, size tính theo cấp 1
    onSave,             // async ({ packSize, packUnit, pack2Size, pack2Unit }) => void
}: Props) {
    const [packUnit, setPackUnit] = useState('')
    const [packSize, setPackSize] = useState('')
    const [pack2Unit, setPack2Unit] = useState('')
    const [pack2Size, setPack2Size] = useState('')
    const [showPack2, setShowPack2] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')

    // Reset form when modal opens or current values change
    useEffect(() => {
        if (open) {
            setPackUnit(currentPackUnit || '')
            setPackSize(currentPackSize != null ? String(currentPackSize) : '')
            setPack2Unit(currentPack2?.unit || '')
            setPack2Size(currentPack2 ? String(currentPack2.size) : '')
            setShowPack2(!!currentPack2)
            setError('')
        }
    }, [open, currentPackSize, currentPackUnit, currentPack2])

    if (!open) return null

    const hasExisting = !!(currentPackSize && currentPackUnit)
    const level1Ok = packUnit.trim() && Number(packSize) > 0
    // Cấp 2 để trống cả hai = không dùng; điền thì phải điền đủ.
    const hasPack2 = !!(pack2Unit.trim() || pack2Size)
    const pack2Valid = !!(level1Ok && pack2Unit.trim() && Number(pack2Size) > 0)
    const canSave = level1Ok && (!hasPack2 || pack2Valid)
    const removePack2 = () => { setPack2Unit(''); setPack2Size(''); setShowPack2(false) }

    const handleSave = async () => {
        if (!canSave) return
        setSaving(true)
        setError('')
        try {
            await onSave({
                packUnit: packUnit.trim(), packSize: Number(packSize),
                pack2Unit: hasPack2 ? pack2Unit.trim() : null, pack2Size: hasPack2 ? Number(pack2Size) : null,
            })
            onClose()
        } catch (err) {
            setError(errorMessage(err, 'Lưu thất bại'))
        } finally {
            setSaving(false)
        }
    }

    const handleClear = async () => {
        setSaving(true)
        setError('')
        try {
            await onSave({ packUnit: null, packSize: null, pack2Unit: null, pack2Size: null })
            onClose()
        } catch (err) {
            setError(errorMessage(err, 'Xóa thất bại'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog
            onClose={!saving ? onClose : undefined}
            panelClassName="w-full max-w-md mx-4 bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden"
        >
                <ModalHeader
                    icon={Package}
                    title="Quy đổi định lượng"
                    subtitle={ingredientLabel}
                    subtitleClassName="truncate max-w-[200px]"
                    onClose={onClose}
                    hideClose={saving}
                />

                {/* Body */}
                <div className="px-5 py-4 space-y-4">
                    {/* Cấp 1: đơn vị nhập → đơn vị gốc */}
                    <div className="space-y-1.5">
                        <p className={CAPTION}>Đơn vị nhập</p>
                        <div className="flex items-center gap-2">
                            <span className={OP}>1</span>
                            <input
                                type="text"
                                value={packUnit}
                                onChange={e => setPackUnit(e.target.value)}
                                disabled={saving}
                                placeholder="hộp"
                                className={TEXT_INPUT}
                            />
                            <span className={OP}>=</span>
                            <input
                                type="number"
                                value={packSize}
                                onChange={e => setPackSize(e.target.value)}
                                disabled={saving}
                                placeholder="380"
                                min="0"
                                step="any"
                                className={`${NUM_INPUT} w-24`}
                            />
                            <span className="text-text font-bold text-sm shrink-0">{baseUnit}</span>
                        </div>
                    </div>

                    {/* Cấp 2 (tuỳ chọn): xây trên cấp 1 — thụt vào + vạch trái cho thấy quan hệ. */}
                    {showPack2 ? (
                        <div className="ml-2 pl-3 border-l-2 border-primary/40 space-y-1.5">
                            <div className="flex items-center justify-between">
                                <p className={CAPTION}>Đơn vị lớn hơn</p>
                                <button
                                    type="button"
                                    onClick={removePack2}
                                    disabled={saving}
                                    aria-label="Bỏ đơn vị lớn hơn"
                                    className="-my-1 w-6 h-6 flex items-center justify-center rounded-md text-text-dim hover:text-danger hover:bg-danger/10 transition-colors disabled:opacity-50"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={OP}>1</span>
                                <input
                                    type="text"
                                    value={pack2Unit}
                                    onChange={e => setPack2Unit(e.target.value)}
                                    disabled={saving}
                                    autoFocus={!pack2Unit}
                                    placeholder="thùng"
                                    className={TEXT_INPUT}
                                />
                                <span className={OP}>=</span>
                                <input
                                    type="number"
                                    value={pack2Size}
                                    onChange={e => setPack2Size(e.target.value)}
                                    disabled={saving}
                                    placeholder="12"
                                    min="0"
                                    step="any"
                                    className={`${NUM_INPUT} w-20`}
                                />
                                <span className="text-text font-bold text-sm shrink-0 max-w-[64px] truncate">{packUnit.trim() || 'hộp'}</span>
                            </div>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setShowPack2(true)}
                            disabled={saving}
                            className="w-full py-2 rounded-[10px] border border-dashed border-primary/40 text-[13px] font-bold text-primary hover:bg-primary/5 transition-colors disabled:opacity-50"
                        >
                            + Thêm đơn vị lớn hơn
                        </button>
                    )}

                    {error && <p className="text-danger text-xs font-medium">{error}</p>}
                </div>

                {/* Footer */}
                <div className="px-5 py-4 border-t border-border/40 flex gap-2">
                    {hasExisting && (
                        <button
                            onClick={handleClear}
                            disabled={saving}
                            className="px-4 py-3 rounded-[14px] bg-bg border border-danger/30 text-danger font-bold text-sm hover:bg-danger/5 transition-colors disabled:opacity-50"
                        >
                            Xóa
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        disabled={saving}
                        className="flex-1 py-3 rounded-[14px] bg-bg border border-border/60 text-text-secondary font-bold text-sm hover:bg-surface-light transition-colors disabled:opacity-50"
                    >
                        Hủy
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving || !canSave}
                        className="flex-1 py-3 rounded-[14px] bg-primary text-black font-black text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {saving ? <><Loader size={14} className="animate-spin" /> Đang lưu…</> : 'Lưu'}
                    </button>
                </div>
        </Dialog>
    )
}
