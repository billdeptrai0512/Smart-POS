// Shared sort-mode list — click-to-select an item, then use ▲/▼ to reorder.
// Used by both /recipes (sort products) and /ingredients (sort ingredients).
//
// `items`: array of any type
// `getKey(item)`: returns stable key (id for objects, the string itself for plain keys)
// `getLabel(item)`: returns the display string for the row
// `selectedKey`: currently-selected row's key (or null)
// `onSelect(key)`: called on row click
// `onMove(fromIndex, toIndex)`: called by ▲/▼ buttons (parent does the splice)
export default function SortableList({ items, getKey, getLabel, selectedKey, onSelect, onMove }) {
    return (
        <div className="space-y-1.5">
            {items.map((item, index) => {
                const key = getKey(item)
                const isSelected = selectedKey === key
                return (
                    <div
                        key={key}
                        onClick={() => onSelect(key)}
                        className={`bg-surface border rounded-[14px] px-4 py-3 flex items-center gap-3 cursor-pointer transition-colors ${isSelected ? 'border-primary ring-1 ring-primary' : 'border-border/60 hover:bg-surface-light'}`}
                    >
                        <span className="text-text-dim text-[13px] font-bold w-6 text-center shrink-0">{index + 1}</span>
                        <span className="flex-1 text-[14px] font-bold text-text truncate">{getLabel(item)}</span>
                        {isSelected && (
                            <div className="flex flex-row gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                                <MoveButton onClick={() => onMove(index, index - 1)} disabled={index === 0}>▲</MoveButton>
                                <MoveButton onClick={() => onMove(index, index + 1)} disabled={index === items.length - 1}>▼</MoveButton>
                            </div>
                        )}
                    </div>
                )
            })}
        </div>
    )
}

function MoveButton({ onClick, disabled, children }) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className="w-10 h-8 flex items-center justify-center rounded-lg bg-surface-light border border-border/40 text-text-secondary text-[14px] hover:bg-border/40 active:scale-95 transition-all disabled:opacity-20 disabled:pointer-events-none"
        >
            {children}
        </button>
    )
}
