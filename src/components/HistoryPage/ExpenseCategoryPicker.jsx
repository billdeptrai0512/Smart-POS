import { useState } from 'react'
import { Plus, Check } from 'lucide-react'

// Tag picker for the expense form. Manager-managed inline:
//   - Tap a tag chip to select it
//   - Tap "+ Nhãn mới" to inline-create. The new tag immediately appears in the
//     chip list and is auto-selected. Manager chooses Vận hành vs Quản lý/khác
//     in the inline form (group_section is a per-tag, not per-expense, property).
//
// Edit/rename/delete is NOT here — that lands in a future tap-to-manage panel.
// For now manager-created mistakes are recoverable by creating a new tag and
// re-tagging affected expenses one by one.
export default function ExpenseCategoryPicker({
    categories,             // [{ id, name, group_section, is_default }] — already pre-filtered by caller
    selectedId,
    onSelect,               // (id) => void
    onCreate,               // ({ name, group_section }) => Promise<{id}>
    lockedGroupSection,     // when set: hide group radio, new tag inherits this group.
                            // Caller filters `categories` to this group too — so the picker
                            // shows only matching chips. This is the normal usage from
                            // AddExpenseModal (top tab decides operating vs overhead).
    disabled = false,
}) {
    const [isCreating, setIsCreating] = useState(false)
    const [newName, setNewName] = useState('')
    const [newGroup, setNewGroup] = useState(lockedGroupSection || 'operating')
    const [isSaving, setIsSaving] = useState(false)

    const effectiveGroup = lockedGroupSection || newGroup

    const handleCreate = async () => {
        if (!newName.trim() || isSaving) return
        setIsSaving(true)
        try {
            const created = await onCreate({ name: newName.trim(), group_section: effectiveGroup })
            if (created?.id) onSelect(created.id)
            setIsCreating(false)
            setNewName('')
            setNewGroup(lockedGroupSection || 'operating')
        } catch {
            // Parent surfaces error via toast.
        } finally {
            setIsSaving(false)
        }
    }

    // When the caller doesn't lock a group, split the chip list into 2 captioned
    // sections (Vận hành / Quản lý & khác) so user still sees the group context
    // that the old top tab provided — without taking up a full toggle row.
    const sections = lockedGroupSection
        ? [{ key: lockedGroupSection, label: null, items: categories }]
        : [
            { key: 'operating', label: 'Vận hành', items: categories.filter(c => c.group_section !== 'overhead') },
            { key: 'overhead', label: 'Quản lý & khác', items: categories.filter(c => c.group_section === 'overhead') },
        ]

    const renderChip = (c) => {
        const active = c.id === selectedId
        const sectionDot = c.group_section === 'overhead' ? 'bg-warning' : 'bg-danger'
        return (
            <button
                key={c.id}
                type="button"
                disabled={disabled}
                onClick={() => onSelect(c.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold border transition-all ${
                    active
                        ? 'bg-primary/15 border-primary/50 text-primary'
                        : 'bg-surface-light border-border/60 text-text-secondary hover:text-text hover:border-border'
                }`}
            >
                <span className={`w-1.5 h-1.5 rounded-full ${sectionDot} opacity-70`} />
                {c.name}
                {active && <Check size={11} strokeWidth={3} />}
            </button>
        )
    }

    return (
        <div className="flex flex-col gap-2">
            <span className="text-[11px] font-black uppercase tracking-wider text-text-secondary">Nhãn chi phí</span>

            {sections.map((section, idx) => (
                <div key={section.key} className={`flex flex-col gap-1.5 ${idx > 0 ? 'mt-1' : ''}`}>
                    {section.label && (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-text-dim">{section.label}</span>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                        {section.items.map(renderChip)}
                        {/* "+ Nhãn mới" lives at the end of the last section so the inline
                            create form sits next to the chips it'll join. */}
                        {idx === sections.length - 1 && !isCreating && (
                            <button
                                type="button"
                                disabled={disabled}
                                onClick={() => setIsCreating(true)}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-bold border border-dashed border-border text-text-secondary hover:text-primary hover:border-primary/50 transition-all"
                            >
                                <Plus size={12} strokeWidth={2.5} />
                                Nhãn mới
                            </button>
                        )}
                    </div>
                </div>
            ))}

            {isCreating && (
                <div className="flex flex-col gap-2 p-3 bg-surface-light border border-border/60 rounded-[12px]">
                    <input
                        autoFocus
                        type="text"
                        placeholder="Tên nhãn mới…"
                        value={newName}
                        onChange={e => setNewName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
                        className="w-full bg-surface border border-border/60 rounded-[10px] px-3 py-2 text-[13px] text-text placeholder:text-text-secondary/40 focus:outline-none focus:border-primary/50"
                    />
                    {!lockedGroupSection && (
                        <div className="flex bg-surface border border-border/60 rounded-[10px] p-0.5">
                            <GroupTab
                                active={newGroup === 'operating'}
                                color="bg-danger/20 text-danger"
                                onClick={() => setNewGroup('operating')}
                            >
                                Vận hành
                            </GroupTab>
                            <GroupTab
                                active={newGroup === 'overhead'}
                                color="bg-warning/20 text-warning"
                                onClick={() => setNewGroup('overhead')}
                            >
                                Quản lý & khác
                            </GroupTab>
                        </div>
                    )}
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => { setIsCreating(false); setNewName('') }}
                            className="flex-1 py-1.5 rounded-[10px] text-[12px] font-bold text-text-secondary border border-border/60 hover:bg-border/20"
                        >
                            Huỷ
                        </button>
                        <button
                            type="button"
                            disabled={!newName.trim() || isSaving}
                            onClick={handleCreate}
                            className="flex-1 py-1.5 rounded-[10px] text-[12px] font-black uppercase tracking-wide text-white bg-primary disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {isSaving ? 'Đang lưu…' : 'Tạo nhãn'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

function GroupTab({ active, color, onClick, children }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex-1 py-1 rounded-[8px] text-[11px] font-bold transition-all ${active ? `${color} shadow-sm` : 'text-text-secondary hover:text-text'}`}
        >
            {children}
        </button>
    )
}
