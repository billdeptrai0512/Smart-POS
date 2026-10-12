import { useState, type ReactNode } from 'react'

// Self-contained click-to-edit editor. Parent passes value + onSave;
// internal state handles the edit toggle and draft string.
//
// `type`: 'number' | 'text'
// `parse`: converts string draft → saved value (defaults to parseInt for number, identity for text)
// `renderDisplay`: nội dung của span chỉ-đọc (mặc định hiện thẳng value)
// `suffix`: optional small text rendered next to the input (e.g. unit name)
interface InlineEditorProps {
    value: string | number | null | undefined
    canEdit?: boolean
    // any: caller quyết định kiểu giá trị lưu (string cho text, number cho number, hoặc parse tuỳ biến).
    onSave: (value: any) => void
    type?: 'number' | 'text'
    allowNegative?: boolean
    transform?: (raw: string) => string
    parse?: (draft: string) => any
    renderDisplay?: (value: any) => ReactNode
    suffix?: ReactNode
    inputClassName?: string
    displayClassName?: string
    inputWidthClassName?: string
}

export default function InlineEditor({
    value, canEdit, onSave,
    type = 'number',
    allowNegative = false,
    transform,
    parse,
    renderDisplay,
    suffix,
    inputClassName = '',
    displayClassName = '',
    inputWidthClassName = 'w-[72px]',
}: InlineEditorProps) {
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState('')

    const begin = () => {
        if (!canEdit) return
        setDraft(value != null ? String(value) : '')
        setEditing(true)
    }

    const commit = () => {
        const parsed = parse
            ? parse(draft)
            : type === 'number'
                ? (parseInt(draft) || 0)
                : draft
        setEditing(false)
        onSave(parsed)
    }

    if (editing) {
        return (
            <span className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                {allowNegative && (
                    // ± toggle: some phones' numeric keyboards have no reachable "-".
                    // preventDefault keeps the input focused so onBlur doesn't commit+close.
                    <button
                        type="button"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => setDraft(d => d.startsWith('-') ? d.slice(1) : '-' + d)}
                        className={`shrink-0 w-6 h-6 flex items-center justify-center rounded border text-[14px] font-bold ${draft.startsWith('-') ? 'border-danger/50 text-danger' : 'border-border/60 text-text-secondary hover:text-primary hover:border-primary/50'}`}
                        title="Đổi dấu âm/dương"
                    >
                        {draft.startsWith('-') ? '−' : '+'}
                    </button>
                )}
                <input
                    type={type === 'number' ? 'text' : type}
                    inputMode={type === 'number' ? 'decimal' : undefined}
                    autoFocus
                    value={draft}
                    onChange={e => setDraft(transform ? transform(e.target.value) : e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') commit()
                        if (e.key === 'Escape') setEditing(false)
                    }}
                    onBlur={commit}
                    className={`${inputWidthClassName} bg-bg border border-primary/60 rounded-lg px-2 py-1 text-[13px] text-text text-right focus:outline-none focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${inputClassName}`}
                />
                {suffix && <span className="text-[12px] text-text-dim">{suffix}</span>}
            </span>
        )
    }

    const display = renderDisplay ? renderDisplay(value) : value

    return (
        <span
            className={`${canEdit ? 'cursor-pointer hover:underline' : ''} ${displayClassName}`}
            onClick={begin}
        >
            {display}
        </span>
    )
}
