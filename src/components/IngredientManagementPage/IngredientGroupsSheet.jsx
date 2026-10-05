import { useState } from 'react'
import { Trash2, ChevronRight, ChevronLeft, Check } from 'lucide-react'
import { BottomSheet, SheetHeader } from '../common/ModalShell'
import { createIngredientGroup, renameIngredientGroup, deleteIngredientGroup, setIngredientsGroup } from '../../services/orderService'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useSavingAction } from '../../hooks/useSavingAction'
import { INGREDIENT_CATEGORIES, ingredientLabel, normalizeSearchText } from '../../utils/ingredients'

// Quản lý nhóm con của cả 2 section (nguyên liệu chính / bao bì): đổi tên (lưu khi rời ô), xoá, thêm mới, và bấm "N món ›"
// để tick chọn nguyên liệu vào nhóm. Nhóm vừa tạo mở thẳng màn tick chọn.
// ponytail: chưa có kéo-thả sắp xếp — thứ tự = thứ tự tạo (hoặc thứ tự trong file Excel).
export default function IngredientGroupsSheet({ groups, countByGroup, ingredientsBySection, groupOf, addressId, onChanged, onError, onClose }) {
    const confirm = useConfirm()
    const [newNames, setNewNames] = useState({}) // section → tên nhóm đang gõ
    const [picking, setPicking] = useState(null) // nhóm đang tick chọn món
    const { saving: busy, withSaving } = useSavingAction(onError)

    const run = (label, fn) => withSaving(label, async () => { await fn(); await onChanged() })

    const rename = (g, name) => {
        name = name.trim()
        if (!name || name === g.name) return
        run('Đổi tên nhóm', () => renameIngredientGroup(g.id, name))
    }

    const remove = async (g) => {
        const n = countByGroup.get(g.id) || 0
        if (!await confirm({
            title: `Xóa nhóm "${g.name}"?`,
            detail: n > 0 ? `${n} nguyên liệu trong nhóm sẽ chuyển về "Chưa phân nhóm".` : null,
            danger: true, confirmLabel: 'Xóa',
        })) return
        run('Xóa nhóm', () => deleteIngredientGroup(g.id))
    }

    const add = (section) => {
        const name = (newNames[section] || '').trim()
        if (!name) return
        const maxSort = Math.max(0, ...groups.filter(g => g.section === section).map(g => g.sort_order))
        run('Tạo nhóm', async () => {
            setPicking(await createIngredientGroup(addressId, name, section, maxSort + 1))
            setNewNames(prev => ({ ...prev, [section]: '' }))
        })
    }

    const inputClass = 'flex-1 min-w-0 h-10 px-3 rounded-[10px] bg-bg border border-border/60 text-text text-[14px] focus:outline-none focus:border-primary/60'

    return (
        <BottomSheet
            onClose={() => !busy && onClose()}
            panelClassName="w-full max-w-lg bg-surface rounded-t-[24px] border-t border-border/60 shadow-2xl p-5 pb-8 flex flex-col gap-3 animate-slide-up max-h-[85vh] overflow-y-auto"
        >
            {picking ? (
                <GroupPicker
                    group={picking}
                    ingredients={ingredientsBySection[picking.section] || []}
                    groupOf={groupOf}
                    busy={busy}
                    inputClass={inputClass}
                    onBack={() => setPicking(null)}
                    onSave={async (added, removed) => {
                        let saved = false
                        await run('Gán nguyên liệu vào nhóm', async () => {
                            await Promise.all([
                                setIngredientsGroup(added, addressId, picking.id, picking.section),
                                setIngredientsGroup(removed, addressId, null, picking.section),
                            ])
                            saved = true
                        })
                        // Đóng sau khi refresh xong (run chờ cả onChanged) để số món trong danh sách nhóm đã mới.
                        if (saved) setPicking(null)
                    }}
                />
            ) : (
                <>
                    <SheetHeader title="Nhóm nguyên liệu" onClose={onClose} closeDisabled={busy} />
                    {INGREDIENT_CATEGORIES.map(({ key: section, label }) => {
                        const list = groups.filter(g => g.section === section)
                        return (
                            <div key={section} className="flex flex-col gap-3">
                                <p className="text-[11px] font-black uppercase tracking-wider text-text-secondary">{label}</p>
                                {list.length === 0 && <p className="text-text-dim text-[13px]">Chưa có nhóm nào.</p>}
                                {list.map(g => (
                                    <div key={g.id} className="flex items-center gap-2">
                                        <input
                                            defaultValue={g.name}
                                            disabled={busy}
                                            onBlur={e => rename(g, e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
                                            className={inputClass}
                                        />
                                        <button
                                            onClick={() => setPicking(g)}
                                            disabled={busy}
                                            className="shrink-0 h-10 pl-3 pr-2 rounded-[10px] border border-border/60 text-[13px] font-bold text-text-secondary flex items-center gap-0.5 tabular-nums"
                                        >
                                            {countByGroup.get(g.id) || 0} món <ChevronRight size={15} />
                                        </button>
                                        <button
                                            onClick={() => remove(g)}
                                            disabled={busy}
                                            aria-label={`Xóa nhóm ${g.name}`}
                                            className="shrink-0 w-10 h-10 flex items-center justify-center rounded-[10px] text-danger hover:bg-danger/10"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                ))}
                                <div className="flex items-center gap-2 pb-2 border-b border-border/40 last:border-0">
                                    <input
                                        value={newNames[section] || ''}
                                        disabled={busy}
                                        onChange={e => setNewNames(prev => ({ ...prev, [section]: e.target.value }))}
                                        onKeyDown={e => e.key === 'Enter' && add(section)}
                                        placeholder="Tên nhóm mới"
                                        className={inputClass}
                                    />
                                    <button
                                        onClick={() => add(section)}
                                        disabled={busy || !(newNames[section] || '').trim()}
                                        className="shrink-0 h-10 px-4 rounded-[10px] bg-primary text-bg text-[13px] font-bold disabled:opacity-40"
                                    >
                                        Thêm
                                    </button>
                                </div>
                            </div>
                        )
                    })}
                </>
            )}
        </BottomSheet>
    )
}

// Tick chọn nguyên liệu vào `group`. Mỗi món chỉ thuộc 1 nhóm → chỉ liệt kê món chưa phân nhóm + món
// của chính nhóm này (món ở nhóm khác phải bỏ ra từ nhóm đó trước). Chỉ ghi khi bấm Lưu: phần thêm →
// group, phần bỏ tick → chưa phân nhóm.
function GroupPicker({ group, ingredients, groupOf, busy, inputClass, onBack, onSave }) {
    const initial = () => new Set(ingredients.filter(ing => groupOf(ing) === group.id))
    const [checked, setChecked] = useState(initial)
    const [search, setSearch] = useState('')
    const q = normalizeSearchText(search.trim())
    const shown = ingredients.filter(ing => (groupOf(ing) === 'none' || groupOf(ing) === group.id)
        && (!q || normalizeSearchText(ingredientLabel(ing)).includes(q)))

    const toggle = (ing) => setChecked(prev => {
        const next = new Set(prev)
        if (next.has(ing)) next.delete(ing)
        else next.add(ing)
        return next
    })

    const save = () => {
        const before = initial()
        onSave([...checked].filter(ing => !before.has(ing)), [...before].filter(ing => !checked.has(ing)))
    }

    return (
        <>
            <div className="sticky -top-5 z-10 -mx-5 -mt-5 px-5 pt-5 pb-2 bg-surface flex flex-col gap-3">
                <div className="flex items-center gap-2">
                    <button onClick={onBack} disabled={busy} aria-label="Quay lại" className="shrink-0 w-9 h-9 -ml-2 flex items-center justify-center rounded-full text-text-secondary hover:bg-surface-light">
                        <ChevronLeft size={20} />
                    </button>
                    <h3 className="flex-1 min-w-0 truncate text-[16px] font-black text-text">{group.name}</h3>
                    <span className="shrink-0 text-[13px] font-bold text-text-dim tabular-nums">{checked.size} món</span>
                </div>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm nguyên liệu…" className={`${inputClass} flex-none`} />
            </div>
            <div className="flex flex-col -mx-1 min-h-[50vh] shrink-0">
                {shown.map(ing => {
                    const on = checked.has(ing)
                    return (
                        <button
                            key={ing}
                            onClick={() => toggle(ing)}
                            className="flex items-center gap-3 px-1 py-2.5 text-left border-b border-border/30 last:border-0"
                        >
                            <span className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center ${on ? 'bg-primary border-primary text-bg' : 'border-border'}`}>
                                {on && <Check size={14} strokeWidth={3} />}
                            </span>
                            <span className="flex-1 min-w-0 truncate text-[14px] font-bold text-text">{ingredientLabel(ing)}</span>
                        </button>
                    )
                })}
                {shown.length === 0 && <p className="text-text-dim text-[13px] text-center py-4">{q ? 'Không tìm thấy nguyên liệu nào.' : 'Mọi nguyên liệu đã thuộc nhóm khác.'}</p>}
            </div>
            <div className="sticky -bottom-8 -mx-5 -mb-8 px-5 pt-2 pb-8 bg-surface border-t border-border/40">
                <button
                    onClick={save}
                    disabled={busy}
                    className="w-full h-11 rounded-[12px] bg-primary text-bg text-[14px] font-black disabled:opacity-40"
                >
                    {busy ? 'Đang lưu…' : 'Lưu'}
                </button>
            </div>
        </>
    )
}
