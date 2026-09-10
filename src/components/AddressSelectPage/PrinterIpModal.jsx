import { useRef, useState } from 'react'
import { Printer } from 'lucide-react'
import { Dialog, ModalHeader, ModalActions } from '../common/ModalShell'

// Modal cấu hình IP máy in — chỉ có tác dụng trên app native (Capacitor), web vẫn
// window.print() bất kể có nhập gì ở đây. Xem escposBitmap.js.
export default function PrinterIpModal({ addr, onSetPrinters, onCancel, onClose, onSuccess, setError }) {
    const [printerForm, setPrinterForm] = useState({
        counterPrinterIp: addr.counter_printer_ip || '',
        kitchenPrinterIp: addr.kitchen_printer_ip || '',
    })
    const [savingPrinters, setSavingPrinters] = useState(false)
    const submitGuardRef = useRef(false)

    async function handleSubmit(e) {
        e.preventDefault()
        if (submitGuardRef.current) return
        submitGuardRef.current = true
        setSavingPrinters(true)
        setError('')
        try {
            await onSetPrinters(addr.id, printerForm)
            onSuccess()
        } catch (err) {
            setError(err.message || 'Không thể lưu IP máy in')
        } finally {
            setSavingPrinters(false)
            submitGuardRef.current = false
        }
    }

    return (
        <Dialog
            onClose={() => { if (!savingPrinters) onClose() }}
            panelClassName="w-full max-w-sm mx-4 bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden"
        >
            <form onSubmit={handleSubmit}>
                <ModalHeader icon={Printer} title="IP máy in (app native)" onClose={onClose} hideClose={savingPrinters} />
                <div className="p-5 flex flex-col gap-4">
                    <p className="text-text-secondary text-xs font-medium -mt-1">
                        Để trống nếu chưa có máy in — app sẽ dùng hộp in của trình duyệt như bình thường.
                    </p>
                    <div className="flex flex-col gap-1.5">
                        <label className="text-text-secondary text-xs font-bold uppercase tracking-wide">Máy in quầy (Tính tiền)</label>
                        <input
                            type="text"
                            inputMode="decimal"
                            placeholder="192.168.1.100"
                            value={printerForm.counterPrinterIp}
                            onChange={e => setPrinterForm(f => ({ ...f, counterPrinterIp: e.target.value }))}
                            disabled={savingPrinters}
                            className="w-full px-4 py-3 rounded-[12px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-50"
                            autoFocus
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <label className="text-text-secondary text-xs font-bold uppercase tracking-wide">Máy in bếp (Tạo đơn)</label>
                        <input
                            type="text"
                            inputMode="decimal"
                            placeholder="192.168.1.101"
                            value={printerForm.kitchenPrinterIp}
                            onChange={e => setPrinterForm(f => ({ ...f, kitchenPrinterIp: e.target.value }))}
                            disabled={savingPrinters}
                            className="w-full px-4 py-3 rounded-[12px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-50"
                        />
                    </div>
                    <ModalActions
                        confirmLabel="Lưu"
                        confirmType="submit"
                        onCancel={onCancel}
                        loading={savingPrinters}
                    />
                </div>
            </form>
        </Dialog>
    )
}
