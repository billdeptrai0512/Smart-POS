import { useState } from 'react'
import { X, Plus, Check, Pencil, Trash2 } from 'lucide-react'

// Bottom sheet for re-tagging an expense card. Tap a chip → auto-save + close.
// Groups categories by section (Operating top, Overhead bottom) so manager sees
// both options without a tab toggle. New tag inline-create supports either group.
// "Sửa" toggle reveals rename/delete affordances on each chip; defaults can be
// renamed but not deleted (to preserve seed).
export default function ChangeCategorySheet({
    open,
    expense,           // the row being re-tagged (needed only for name display)
    selectedId,        // current category_id of the expense
    categories,        // full list (both sections)
    onSelect,          // (newCategoryId) => Promise — called with new id; sheet closes when done
    onCreate,          // ({name, group_section}) => Promise<{id}>
    onUpdate,          // (id, { name?, group_section? }) => Promise
    onDelete,          // (id) => Promise — manager-created chips only
    onClose,
}) {
    const [isCreating, setIsCreating] = useState(false)
    const [newName, setNewName] = useState('')
    const [newGroup, setNewGroup] = useState('operating')
    const [isSaving, setIsSaving] = useState(false)
    const [manageMode, setManageMode] = useState(false)
    const [editingId, setEditingId] = useState(null)
    const [editName, setEditName] = useState('')

    if (!open) return null

    const operating = categories.filter(c => c.group_section === 'operating')
    const overhead = categories.filter(c => c.group_section === 'overhead')

    const handlePick = async (id) => {
        if (isSaving || id === selectedId) {
            onClose()
            return
        }
        setIsSaving(true)
        try {
            await onSelect(id)
        } finally {
            setIsSaving(false)
        }
    }

    const handleCreate = async () => {
        if (!newName.trim() || isSaving) return
        setIsSaving(true)
        try {
            const created = await onCreate({ name: newName.trim(), group_section: newGroup })
            if (created?.id) await onSelect(created.id)
            setIsCreating(false)
            setNewName('')
            setNewGroup('operating')
        } finally {
            setIsSaving(false)
        }
    }

    const startEdit = (c) => {
        setEditingId(c.id)
        setEditName(c.name)
    }
    const cancelEdit = () => { setEditingId(null); setEditName('') }
    const submitEdit = async () => {
        if (!editName.trim() || isSaving) return
        setIsSaving(true)
        try {
            await onUpdate(editingId, { name: editName.trim() })
            cancelEdit()
        } finally {
            setIsSaving(false)
        }
    }

    const handleDelete = async (c) => {
        if (isSaving) return
        if (!window.confirm(`Xoá nhãn "${c.name}"?\n\nCác chi phí đã gán nhãn này sẽ chuyển về "Chi phí khác".`)) return
        setIsSaving(true)
        try {
            await onDelete(c.id)
        } finally {
            setIsSaving(false)
        }
    }

    const chipHandlers = manageMode ? {
        onEdit: startEdit,
        onDelete: handleDelete,
        editingId,
        editName,
        onEditNameChange: setEditName,
        onSubmitEdit: submitEdit,
        onCancelEdit: cancelEdit,
    } : { onPick: handlePick }

    return (
        <div className="fixed inset-0 z-[100] flex items-end justify-center" onClick={onClose}>
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div
                className="relative w-full max-w-lg bg-surface rounded-t-[24px] border-t border-border/60 shadow-2xl p-5 pb-8 flex flex-col gap-4 animate-slide-up max-h-[85vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                        <span className="text-[16px] font-black text-text">
                            {manageMode ? 'Quản lý nhãn' : 'Đổi nhãn'}
                        </span>
                        {!manageMode && expense?.name && (
                            <span className="text-[12px] text-text-secondary truncate max-w-[260px]">{expense.name}</span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => { setManageMode(m => !m); cancelEdit() }}
                            className={`px-3 py-1 rounded-full text-[11px] font-bold border transition-all ${
                                manageMode
                                    ? 'bg-primary/15 border-primary/50 text-primary'
                                    : 'bg-surface-light border-border/60 text-text-secondary hover:text-text'
                            }`}
                        >
                            {manageMode ? 'Xong' : 'Sửa'}
                        </button>
                        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-light border border-border/60 text-text-secondary hover:text-text transition-all">
                            <X size={16} />
                        </button>
                    </div>
                </div>

                <Section title="Vận hành" dotCls="bg-danger">
                    <ChipGroup chips={operating} selectedId={selectedId} dotCls="bg-danger" disabled={isSaving} {...chipHandlers} />
                </Section>

                <Section title="Quản lý & khác" dotCls="bg-warning">
                    <ChipGroup chips={overhead} selectedId={selectedId} dotCls="bg-warning" disabled={isSaving} {...chipHandlers} />
                </Section>

                {!manageMode && (!isCreating ? (
                    <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => setIsCreating(true)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-[10px] text-[12px] font-bold border border-dashed border-border text-text-secondary hover:text-primary hover:border-primary/50 transition-all self-start"
                    >
                        <Plus size={12} strokeWidth={2.5} />
                        Tạo nhãn mới
                    </button>
                ) : (
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
                        <div className="flex bg-surface border border-border/60 rounded-[10px] p-0.5">
                            <GroupTab active={newGroup === 'operating'} color="bg-danger/20 text-danger" onClick={() => setNewGroup('operating')}>Vận hành</GroupTab>
                            <GroupTab active={newGroup === 'overhead'} color="bg-warning/20 text-warning" onClick={() => setNewGroup('overhead')}>Quản lý & khác</GroupTab>
                        </div>
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
                                {isSaving ? 'Đang lưu…' : 'Tạo & gán'}
                            </button>
                        </div>
                    </div>
                ))}

                {manageMode && (
                    <span className="text-[11px] text-text-dim leading-snug">
                        Nhãn mặc định chỉ đổi tên được. Xoá nhãn → các chi phí đã gán chuyển về "Chi phí khác".
                    </span>
                )}
            </div>
        </div>
    )
}

function Section({ title, dotCls, children }) {
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${dotCls} opacity-80`} />
                <span className="text-[10px] font-black uppercase tracking-wider text-text-secondary">{title}</span>
            </div>
            {children}
        </div>
    )
}

function ChipGroup({
    chips, selectedId, dotCls, disabled,
    onPick,
    // Manage-mode props (mutually exclusive with onPick)
    onEdit, onDelete, editingId, editName, onEditNameChange, onSubmitEdit, onCancelEdit,
}) {
    if (chips.length === 0) {
        return <span className="text-[12px] text-text-dim italic">Chưa có nhãn nào trong nhóm này.</span>
    }
    const isManage = !onPick
    return (
        <div className="flex flex-wrap gap-1.5">
            {chips.map(c => {
                // Inline rename form for the chip being edited
                if (isManage && editingId === c.id) {
                    return (
                        <div key={c.id} className="flex items-center gap-1 px-1 py-0.5 rounded-full bg-primary/10 border border-primary/50">
                            <input
                                autoFocus
                                value={editName}
                                onChange={e => onEditNameChange(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') onSubmitEdit()
                                    if (e.key === 'Escape') onCancelEdit()
                                }}
                                className="bg-transparent text-[12px] font-bold text-text focus:outline-none w-32 px-2"
                            />
                            <button onClick={onSubmitEdit} disabled={disabled} className="text-success px-1 hover:opacity-80">
                                <Check size={14} strokeWidth={3} />
                            </button>
                            <button onClick={onCancelEdit} className="text-text-dim px-1 hover:text-danger">
                                <X size={14} strokeWidth={3} />
                            </button>
                        </div>
                    )
                }
                if (isManage) {
                    return (
                        <div key={c.id} className={`flex items-center gap-1 pl-3 pr-1 py-0.5 rounded-full text-[12px] font-bold border bg-surface-light border-border/60 text-text-secondary`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${dotCls} opacity-70`} />
                            <span className="mr-1">{c.name}</span>
                            <button
                                type="button"
                                disabled={disabled}
                                onClick={() => onEdit(c)}
                                className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-primary/10 hover:text-primary transition-colors"
                                aria-label="Đổi tên"
                            >
                                <Pencil size={11} />
                            </button>
                            {!c.is_default && (
                                <button
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => onDelete(c)}
                                    className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-danger/10 hover:text-danger transition-colors"
                                    aria-label="Xoá"
                                >
                                    <Trash2 size={11} />
                                </button>
                            )}
                        </div>
                    )
                }
                // Select-mode: tap chip to pick
                const active = c.id === selectedId
                return (
                    <button
                        key={c.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => onPick(c.id)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold border transition-all ${
                            active
                                ? 'bg-primary/15 border-primary/50 text-primary'
                                : 'bg-surface-light border-border/60 text-text-secondary hover:text-text hover:border-border'
                        }`}
                    >
                        <span className={`w-1.5 h-1.5 rounded-full ${dotCls} opacity-70`} />
                        {c.name}
                        {active && <Check size={11} strokeWidth={3} />}
                    </button>
                )
            })}
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
