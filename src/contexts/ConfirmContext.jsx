import { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react'
import { BottomSheet } from '../components/common/ModalShell'

// Promise-based confirm thay cho window.confirm — vốn bị chặn/treo trong webview
// & preview panel. `await confirm(...)` trả boolean.
const ConfirmContext = createContext(() => Promise.resolve(false))

// eslint-disable-next-line react-refresh/only-export-components -- hook + provider chung 1 file (theo pattern các context khác)
export function useConfirm() { return useContext(ConfirmContext) }

export function ConfirmProvider({ children }) {
    const [opts, setOpts] = useState(null)
    const resolver = useRef(null)

    const confirm = useCallback((arg) => {
        const o = typeof arg === 'string' ? { title: arg } : (arg || {})
        // Confirm mới khi cái cũ còn mở → coi cái cũ là huỷ.
        resolver.current?.(false)
        setOpts(o)
        return new Promise(resolve => { resolver.current = resolve })
    }, [])

    const close = useCallback((result) => {
        resolver.current?.(result)
        resolver.current = null
        setOpts(null)
    }, [])

    // Escape = huỷ (chuẩn dialog). Chỉ gắn listener khi đang mở.
    useEffect(() => {
        if (!opts) return
        const onKey = (e) => { if (e.key === 'Escape') close(false) }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [opts, close])

    return (
        <ConfirmContext.Provider value={confirm}>
            {children}
            {opts && (
                <BottomSheet
                    onClose={() => close(false)}
                    zIndexClass="z-[200]"
                    panelClassName="w-full max-w-lg bg-surface rounded-t-[24px] border-t border-border/60 shadow-2xl p-5 pb-8 flex flex-col gap-5 animate-slide-up"
                >
                        <div className="flex flex-col gap-1.5">
                            <span className="text-[17px] font-black text-text leading-snug">{opts.title}</span>
                            {opts.detail && (
                                <span className="text-[13px] font-medium text-text-secondary leading-snug whitespace-pre-line">{opts.detail}</span>
                            )}
                        </div>
                        <div className="flex gap-3">
                            <button
                                autoFocus
                                onClick={() => close(false)}
                                className="flex-1 py-3 rounded-[14px] bg-surface-light border border-border/60 text-text-secondary text-[14px] font-black uppercase tracking-wide hover:bg-border/40 active:scale-[0.98] transition-all"
                            >
                                {opts.cancelLabel || 'Huỷ'}
                            </button>
                            <button
                                onClick={() => close(true)}
                                className={`flex-1 py-3 rounded-[14px] text-white text-[14px] font-black uppercase tracking-wide active:scale-[0.98] transition-all shadow-lg ${opts.danger ? 'bg-danger hover:bg-danger/90 shadow-danger/20' : 'bg-primary hover:bg-primary/90 shadow-primary/20'}`}
                            >
                                {opts.confirmLabel || 'Xác nhận'}
                            </button>
                        </div>
                </BottomSheet>
            )}
        </ConfirmContext.Provider>
    )
}
