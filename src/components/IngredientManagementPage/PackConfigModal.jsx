import { useState, useEffect } from 'react'
import { X, Package, Loader } from 'lucide-react'
import { Dialog } from '../common/ModalShell'

/**
 * Modal cấu hình "quy cách đóng gói" cho 1 nguyên liệu.
 *
 * Manager nhập:
 *   - packUnit (TEXT): tên đơn vị nhập, vd: "hộp", "gói", "thùng", "bao"
 *   - packSize (number): số lượng [base_unit] trong 1 [packUnit]
 *
 * Ví dụ: nguyên liệu "Sữa đặc" (đơn vị ml) → 1 hộp = 380 ml.
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
    onSave,             // async ({ packSize, packUnit }) => void
}) {
    const [packUnit, setPackUnit] = useState('')
    const [packSize, setPackSize] = useState('')
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')

    // Reset form when modal opens or current values change
    useEffect(() => {
        if (open) {
            setPackUnit(currentPackUnit || '')
            setPackSize(currentPackSize != null ? String(currentPackSize) : '')
            setError('')
        }
    }, [open, currentPackSize, currentPackUnit])

    if (!open) return null

    const hasExisting = !!(currentPackSize && currentPackUnit)
    const canSave = packUnit.trim() && Number(packSize) > 0

    const handleSave = async () => {
        if (!canSave) return
        setSaving(true)
        setError('')
        try {
            await onSave({ packUnit: packUnit.trim(), packSize: Number(packSize) })
            onClose()
        } catch (err) {
            setError(err?.message || 'Lưu thất bại')
        } finally {
            setSaving(false)
        }
    }

    const handleClear = async () => {
        setSaving(true)
        setError('')
        try {
            await onSave({ packUnit: null, packSize: null })
            onClose()
        } catch (err) {
            setError(err?.message || 'Xóa thất bại')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog
            onClose={!saving ? onClose : undefined}
            panelClassName="w-full max-w-md mx-4 bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden"
        >
                {/* Header */}
                <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border/40">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-[10px] bg-primary/10 flex items-center justify-center">
                            <Package size={15} className="text-primary" />
                        </div>
                        <div>
                            <p className="text-text font-black text-sm leading-none">Quy cách đóng gói</p>
                            <p className="text-text-secondary text-xs mt-0.5 truncate max-w-[200px]">{ingredientLabel}</p>
                        </div>
                    </div>
                    {!saving && (
                        <button onClick={onClose} className="p-1.5 text-text-secondary hover:text-text rounded-lg hover:bg-surface-light">
                            <X size={16} />
                        </button>
                    )}
                </div>

                {/* Body */}
                <div className="px-5 py-4 space-y-4">
                    <p className="text-text-secondary text-xs">
                        Khai báo quy cách mỗi lần mua. Vd: 1 hộp = 380 ml, 1 gói = 500 g.
                    </p>

                    {/* Inline equation editor */}
                    <div className="flex items-center gap-2">
                        <span className="text-text font-bold text-sm shrink-0">1</span>
                        <input
                            type="text"
                            value={packUnit}
                            onChange={e => setPackUnit(e.target.value)}
                            disabled={saving}
                            placeholder="hộp, gói, bao…"
                            className="flex-1 min-w-0 bg-bg border border-border/60 rounded-[10px] px-3 py-2 text-text text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-50"
                        />
                        <span className="text-text font-bold text-sm shrink-0">=</span>
                        <input
                            type="number"
                            value={packSize}
                            onChange={e => setPackSize(e.target.value)}
                            disabled={saving}
                            placeholder="380"
                            min="0"
                            step="any"
                            className="w-24 bg-bg border border-border/60 rounded-[10px] px-3 py-2 text-text text-sm font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <span className="text-text-secondary font-medium text-sm shrink-0">{baseUnit}</span>
                    </div>

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
