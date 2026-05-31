import { useState } from 'react'
import { Plus, Check, ChevronDown } from 'lucide-react'

// Two group-scoped dropdowns (Vận hành / Quản lý & khác). Only one is expanded
// at a time — picking from either group sets the single selection and closes.
// Inline-create lives inside whichever dropdown is open; group is inferred from
// that dropdown so no group toggle is needed in the create form.
export default function ExpenseCategoryPicker({
    categories,
    selectedId,
    onSelect,
    onCreate,
    disabled = false,
}) {
    const operating = categories.filter(c => c.group_section !== 'overhead')
    const overhead = categories.filter(c => c.group_section === 'overhead')
    const selected = categories.find(c => c.id === selectedId)

    // Expand the group that owns the current selection; if none, default to
    // operating since that's the common bucket for daily expenses.
    const [openGroup, setOpenGroup] = useState(() =>
        selected ? (selected.group_section === 'overhead' ? 'overhead' : 'operating') : 'operating'
    )

    const toggleGroup = (group) => setOpenGroup(prev => prev === group ? null : group)
    const handlePick = (id) => {
        onSelect(id)
        setOpenGroup(null)
    }

    return (
        <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-3 items-start">
            <GroupDropdown
                label="Vận hành"
                group="operating"
                items={operating}
                selectedId={selectedId}
                isOpen={openGroup === 'operating'}
                onToggle={() => toggleGroup('operating')}
                onPick={handlePick}
                onCreate={onCreate}
                disabled={disabled}
            />
            <GroupDropdown
                label="Quản lý & khác"
                group="overhead"
                items={overhead}
                selectedId={selectedId}
                isOpen={openGroup === 'overhead'}
                onToggle={() => toggleGroup('overhead')}
                onPick={handlePick}
                onCreate={onCreate}
                disabled={disabled}
            />
        </div>
    )
}

function GroupDropdown({ label, group, items, selectedId, isOpen, onToggle, onPick, onCreate, disabled }) {
    const [isCreating, setIsCreating] = useState(false)
    const [newName, setNewName] = useState('')
    const [isSaving, setIsSaving] = useState(false)

    const selected = items.find(c => c.id === selectedId)
    const dotCls = group === 'overhead' ? 'bg-warning' : 'bg-danger'

    const handleCreate = async () => {
        if (!newName.trim() || isSaving) return
        setIsSaving(true)
        try {
            const created = await onCreate({ name: newName.trim(), group_section: group })
            if (created?.id) onPick(created.id)
            setIsCreating(false)
            setNewName('')
        } catch {
            // Parent surfaces error via toast.
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-text-dim">{label}</span>

            <div className="relative">
                <button
                    type="button"
                    disabled={disabled}
                    onClick={onToggle}
                    className="flex items-center justify-between gap-2 w-full bg-surface-light border border-border/60 rounded-[12px] px-4 py-3 hover:border-primary/40 transition-all"
                >
                    {selected ? (
                        <span className="flex items-center gap-2 text-[14px] font-bold text-text">
                            <span className={`w-1.5 h-1.5 rounded-full ${dotCls} opacity-80 shrink-0`} />
                            <span className="truncate">{selected.name}</span>
                        </span>
                    ) : (
                        <span className="text-[14px] font-medium text-text-secondary/60 truncate">Chọn nhãn…</span>
                    )}
                    <ChevronDown
                        size={16}
                        className={`text-text-secondary shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    />
                </button>

                {isOpen && (
                    // Anchor above the trigger — the modal is pinned to the viewport
                    // bottom, so the empty space sits above. Opens upward to avoid
                    // overflowing the modal frame; caps at 60vh + inner scroll so a
                    // very long list never escapes the viewport on small screens.
                    <div className="absolute bottom-full left-0 right-0 mb-1.5 z-10 bg-surface border border-border/60 rounded-[12px] shadow-xl p-2 flex flex-col gap-1.5 max-h-[60vh] overflow-y-auto hide-scrollbar">
                    <div className="flex flex-col gap-1.5">
                        {items.map(c => {
                            const active = c.id === selectedId
                            return (
                                <button
                                    key={c.id}
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => onPick(c.id)}
                                    className={`w-full flex items-center justify-between gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold border transition-all ${
                                        active
                                            ? 'bg-primary/15 border-primary/50 text-primary'
                                            : 'bg-surface-light border-border/60 text-text-secondary hover:text-text hover:border-border'
                                    }`}
                                >
                                    <span className="flex items-center gap-1.5 min-w-0">
                                        <span className={`w-1.5 h-1.5 rounded-full ${dotCls} opacity-70 shrink-0`} />
                                        <span className="truncate">{c.name}</span>
                                    </span>
                                    {active && <Check size={11} strokeWidth={3} className="shrink-0" />}
                                </button>
                            )
                        })}
                        {!isCreating && (
                            <button
                                type="button"
                                disabled={disabled}
                                onClick={() => setIsCreating(true)}
                                className="w-full flex items-center justify-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-bold border border-dashed border-border text-text-secondary hover:text-primary hover:border-primary/50 transition-all"
                            >
                                <Plus size={12} strokeWidth={2.5} />
                                Nhãn mới
                            </button>
                        )}
                    </div>

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
                )}
            </div>
        </div>
    )
}
