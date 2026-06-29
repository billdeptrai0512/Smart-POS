import { useState } from 'react'

// Self-contained click-to-edit editor. Parent passes value + onSave;
// internal state handles the edit toggle and draft string.
//
// `type`: 'number' | 'text'
// `step`: for number inputs (e.g. 'any' to allow decimals)
// `parse`: converts string draft → saved value (defaults to parseInt for number, identity for text)
// `format`: optional formatter for the read-only display (e.g. formatVND)
// `renderDisplay`: full control over the read-only span content (overrides `format`)
// `suffix`: optional small text rendered next to the input (e.g. unit name)
export default function InlineEditor({
    value, canEdit, onSave,
    type = 'number', step,
    allowNegative = false,
    transform,
    parse,
    format,
    renderDisplay,
    suffix,
    placeholder,
    inputClassName = '',
    displayClassName = '',
    inputWidthClassName = 'w-[72px]',
}) {
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
                ? (step === 'any' ? (parseFloat(draft) || 0) : (parseInt(draft) || 0))
                : draft
        setEditing(false)
        onSave(parsed)
    }

    if (editing) {
        return (
            <span className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                <input
                    type={type === 'number' ? 'text' : type}
                    inputMode={type === 'number' ? (allowNegative ? undefined : 'decimal') : undefined}
                    autoFocus
                    value={draft}
                    onChange={e => setDraft(transform ? transform(e.target.value) : e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') commit()
                        if (e.key === 'Escape') setEditing(false)
                    }}
                    onBlur={commit}
                    placeholder={placeholder}
                    className={`${inputWidthClassName} bg-bg border border-primary/60 rounded-lg px-2 py-1 text-[13px] text-text text-right focus:outline-none focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${inputClassName}`}
                />
                {suffix && <span className="text-[12px] text-text-dim">{suffix}</span>}
            </span>
        )
    }

    const display = renderDisplay
        ? renderDisplay(value)
        : format
            ? format(value)
            : value

    return (
        <span
            className={`${canEdit ? 'cursor-pointer hover:underline' : ''} ${displayClassName}`}
            onClick={begin}
        >
            {display}
        </span>
    )
}
