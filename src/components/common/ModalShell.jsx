// Shared overlay shell behind every bottom-sheet / centered-dialog modal in the
// app — the "fixed inset-0 + backdrop + panel" boilerplate was copy-pasted into
// 15+ files. Panel content/classes stay fully caller-owned (panelClassName);
// only the overlay + backdrop + dismiss-on-backdrop-click wiring is shared.

// Slides up from the bottom (mobile action-sheet style). Backdrop click closes;
// clicking the panel itself does not (stopPropagation), since the outer wrapper
// — not the backdrop — owns the close handler here.
export function BottomSheet({ onClose, zIndexClass = 'z-[100]', className = '', panelClassName, children }) {
    return (
        <div className={`fixed inset-0 ${zIndexClass} flex items-end justify-center ${className}`} onClick={onClose}>
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div className={`relative ${panelClassName}`} onClick={e => e.stopPropagation()}>
                {children}
            </div>
        </div>
    )
}

// Centered dialog. The backdrop (not the wrapper) owns the close handler, so the
// panel needs no stopPropagation — it's a sibling, never a bubble target of a
// backdrop click.
export function Dialog({ onClose, zIndexClass = 'z-50', className = '', panelClassName, children }) {
    return (
        <div className={`fixed inset-0 ${zIndexClass} flex items-center justify-center ${className}`}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div className={`relative ${panelClassName}`}>
                {children}
            </div>
        </div>
    )
}
