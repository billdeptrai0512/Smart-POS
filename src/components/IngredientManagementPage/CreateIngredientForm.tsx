import { useState } from 'react'
import { Settings2 } from 'lucide-react'
import Dropdown from '../common/Dropdown'
import FormField, { FIELD_INPUT } from '../RecipeMenuPage/FormField'
import type { IngredientGroup } from '../../types/domain'

interface Props {
    groups: Pick<IngredientGroup, 'id' | 'name'>[] | null
    saving?: boolean
    /** Có → nút 'Quản lý' cạnh nhãn Phân loại (mở sheet quản lý nhóm). */
    onManageGroups?: () => void
    onSubmit: (name: string, unit: string, groupId: string) => void
}

// groups = null (guest/template, chưa có bảng nhóm) → ẩn ô chọn nhóm.
// Tự giữ name/unit/groupId: modal gỡ mount sau khi tạo xong nên state tự reset; lỗi thì form còn nguyên giá trị.
export default function CreateIngredientForm({ groups, saving, onManageGroups, onSubmit }: Props) {
    const [name, setName] = useState('')
    const [unit, setUnit] = useState('')
    const [groupId, setGroupId] = useState('')
    const canSubmit = name.trim() && !saving
    const submit = () => { if (canSubmit) onSubmit(name.trim(), unit, groupId) }

    return (
        <div className="flex flex-col gap-3">
            <div className="flex gap-2">
                <FormField label="Tên nguyên liệu" className="flex-1 min-w-0">
                    <input
                        type="text"
                        autoFocus
                        placeholder="VD: Cà phê hạt"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        className={`w-full ${FIELD_INPUT}`}
                    />
                </FormField>
                <FormField label="Đơn vị" className="shrink-0 w-[100px]">
                    <input
                        type="text"
                        placeholder="VD: g"
                        value={unit}
                        onChange={e => setUnit(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') submit() }}
                        className={`w-full ${FIELD_INPUT}`}
                    />
                </FormField>
            </div>
            {groups && (groups.length > 0 || onManageGroups) && (
                <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-black uppercase tracking-widest text-text-secondary">Phân loại</span>
                        {onManageGroups && (
                            <button type="button" onClick={onManageGroups} className="flex items-center gap-1 text-[12px] font-bold text-primary active:opacity-70">
                                <Settings2 size={14} /> Quản lý
                            </button>
                        )}
                    </div>
                    <Dropdown
                        ariaLabel="Phân loại nguyên liệu"
                        value={groupId}
                        triggerLabel={groups.find(g => g.id === groupId)?.name || 'Chưa phân nhóm'}
                        onChange={setGroupId}
                        align="left"
                        up // sheet sát đáy màn hình: mở xuống sẽ bị cắt mất dòng cuối
                        className="w-full"
                        items={[{ value: '', label: 'Chưa phân nhóm' }, ...groups.map(g => ({ value: g.id, label: g.name }))]}
                        triggerClassName="w-full h-11 px-3 rounded-[12px] bg-surface-light border border-border/60 text-[14px]"
                    />
                </div>
            )}

            <button
                onClick={submit}
                disabled={!canSubmit}
                className="w-full py-3 rounded-[12px] bg-primary text-bg text-[14px] font-black hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed uppercase"
            >
                {saving ? 'Đang tạo...' : 'Tạo'}
            </button>
        </div>
    )
}
