import { useState } from 'react'
import { Plus, Check, ChevronDown } from 'lucide-react'

// Single dropdown gộp 2 nhóm. Trigger hiện nhãn đang chọn (chấm màu theo nhóm). Khi mở,
// panel liệt kê 2 nhóm "Vận hành" / "Quản lý & khác", mỗi nhóm có list nhãn + "Thêm mới"
// (inline-create suy nhóm từ section đang đứng). Chọn nhãn nào thì set selection + đóng.
export default function ExpenseCategoryPicker({
    categories,
    selectedId,
    onSelect,
    onCreate,
    disabled = false,
}) {
    const operating = categories.filter(c => c.group_section !== 'overhead')
    const overhead = categories.filter(c => c.group_section === 'overhead')

    const [open, setOpen] = useState(false)
    const selected = categories.find(c => c.id === selectedId)
    const selectedDot = selected
        ? (selected.group_section === 'overhead' ? 'bg-warning' : 'bg-danger')
        : ''

    const handlePick = (id) => {
        onSelect(id)
        setOpen(false)
    }

    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-text-dim">Phân loại</span>

            <div className="relative">
                <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setOpen(o => !o)}
                    className="flex items-center justify-between gap-2 w-full bg-surface-light border border-border/60 rounded-[12px] px-4 py-3 hover:border-primary/40 transition-all"
                >
                    {selected ? (
                        <span className="flex items-center gap-2 text-[14px] font-bold text-text">
                            <span className={`w-1.5 h-1.5 rounded-full ${selectedDot} opacity-80 shrink-0`} />
                            <span className="truncate">{selected.name}</span>
                        </span>
                    ) : (
                        <span className="text-[14px] font-medium text-text-secondary/60 truncate">Chọn phân loại…</span>
                    )}
                    <ChevronDown
                        size={16}
                        className={`text-text-secondary shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
                    />
                </button>

                {open && (
                    // Anchor above the trigger — modal pinned to viewport bottom, empty
                    // space sits above. Caps at 60vh + inner scroll for long lists.
                    <div className="absolute bottom-full left-0 right-0 mb-1.5 z-10 bg-surface border border-border/60 rounded-[12px] shadow-xl p-2 flex flex-col gap-2 max-h-[60vh] overflow-y-auto hide-scrollbar">
                        <GroupSection
                            label="Vận hành"
                            group="operating"
                            dotCls="bg-danger"
                            items={operating}
                            selectedId={selectedId}
                            onPick={handlePick}
                            onCreate={onCreate}
                            disabled={disabled}
                        />
                        <div className="h-px bg-border/60 rounded-full mx-1" />
                        <GroupSection
                            label="Quản lý & khác"
                            group="overhead"
                            dotCls="bg-warning"
                            items={overhead}
                            selectedId={selectedId}
                            onPick={handlePick}
                            onCreate={onCreate}
                            disabled={disabled}
                        />
                    </div>
                )}
            </div>
        </div>
    )
}

function GroupSection({ label, group, dotCls, items, selectedId, onPick, onCreate, disabled }) {
    const [isCreating, setIsCreating] = useState(false)
    const [newName, setNewName] = useState('')
    const [isSaving, setIsSaving] = useState(false)

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
        <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-text-dim px-1">{label}</span>

            {items.map(c => {
                const active = c.id === selectedId
                return (
                    <button
                        key={c.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => onPick(c.id)}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-[10px] text-[13px] font-bold border transition-all ${
                            active
                                ? 'bg-primary/15 border-primary/50 text-primary'
                                : 'bg-surface-light border-border/60 text-text-secondary hover:text-text hover:border-border'
                        }`}
                    >
                        <span className="flex items-center gap-2 min-w-0">
                            <span className={`w-1.5 h-1.5 rounded-full ${dotCls} opacity-70 shrink-0`} />
                            <span className="truncate">{c.name}</span>
                        </span>
                        {active && <Check size={12} strokeWidth={3} className="shrink-0" />}
                    </button>
                )
            })}

            {!isCreating ? (
                <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setIsCreating(true)}
                    className="w-full flex items-center justify-center gap-1 px-3 py-2 rounded-[10px] text-[12px] font-bold border border-dashed border-border text-text-secondary hover:text-primary hover:border-primary/50 transition-all"
                >
                    <Plus size={12} strokeWidth={2.5} />
                    Thêm mới
                </button>
            ) : (
                <div className="flex flex-col gap-2 p-2 bg-surface-light border border-border/60 rounded-[10px]">
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
    )
}
