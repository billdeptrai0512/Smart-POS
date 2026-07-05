import { useState } from 'react'
import { Pencil } from 'lucide-react'
import MoneyInput from '../common/MoneyInput'
import { formatVND, formatVNDInput, parseVNDInput } from '../../utils'
import { formatPackedQty } from '../../utils/inventory'
import { INGREDIENT_CATEGORIES } from '../../utils/ingredients'

// All "tap-to-edit" state lives inside this component. The page only hands in
// current values + one save callback per field — keeps the page's state
// surface small and lets the row components be self-contained.
//
// Save callbacks are async-friendly: parent decides what to do on success/failure
// (we just close the edit affordance optimistically before awaiting).
export default function IngredientDetailsTab({
    nameLabel, unit, cost, category, packSize, packUnit, minStock, tareWeight,
    warehouseStock, counterStock, currentStock,
    countInAudit = true,
    canEdit, saving,
    onSaveName,         // (newDisplayName: string) => Promise
    onSaveWarehouse,    // (newWarehouse: number)  => Promise  (Kho sau)
    onSaveCounter,      // (newCounter: number)    => Promise  (Tồn quầy → ghi remaining ca mới nhất)
    onSaveUnit,         // (newUnit: string)       => Promise
    onSaveCost,         // (newCost: number)       => Promise
    onSaveMinStock,     // (newMin: number)        => Promise
    onSaveTareWeight,   // (newTare: number)       => Promise  (0 = xoá bì)
    onChangeCategory,   // (newCat: string)        => Promise (still controlled — single tap)
    onToggleAudit,      // (next: boolean)         => Promise (hiện khi kiểm kê hao hụt)
    onConfigurePack,    // ()                      => void   (opens modal)
}) {
    const hasPack = !!(packSize && packUnit)
    // Bì chỉ có nghĩa với NVL cân/đong (hộp thiếc matcha, chai nhựa sữa đặc).
    // NVL đếm cái (ly/nắp/gói) → ẩn hàng.
    const tareApplies = ['g', 'ml', 'kg', 'l'].includes(unit)
    const hasTare = tareApplies && tareWeight > 0
    // Tồn quầy đang lưu = số cân (gồm bì) → lượng thật = trừ bì (chỉ để hiển thị).
    const counterReal = hasTare && counterStock != null
        ? Math.max(0, Math.round((counterStock - tareWeight) * 10) / 10)
        : null
    return (
        <div className="flex flex-col gap-4">
            {/* Panel 1 — Thông tin: thuộc tính NVL/bao bì (không phải số tồn). */}
            <Panel title="Thông tin">
                <CategoryRow value={category} canEdit={canEdit} saving={saving} onChange={onChangeCategory} />
                <NameRow value={nameLabel} canEdit={canEdit} onSave={onSaveName} />
                <UnitRow value={unit} canEdit={canEdit} onSave={onSaveUnit} />
                <PackRow
                    hasPack={hasPack}
                    packSize={packSize}
                    packUnit={packUnit}
                    unit={unit}
                    canEdit={canEdit}
                    onConfigure={onConfigurePack}
                />
                {(minStock != null || canEdit) && (
                    <MinStockRow
                        minStock={minStock}
                        unit={unit}
                        hasPack={hasPack}
                        packSize={packSize}
                        packUnit={packUnit}
                        canEdit={canEdit}
                        onSave={onSaveMinStock}
                    />
                )}
                {tareApplies && (tareWeight != null || canEdit) && (
                    <TareRow tareWeight={tareWeight} unit={unit} canEdit={canEdit} onSave={onSaveTareWeight} />
                )}
                <CostRow cost={cost} unit={unit} canEdit={canEdit} onSave={onSaveCost} />
            </Panel>

            {/* Panel 2 — Kiểm kê: Tồn kho (warehouse) + Tồn quầy (counter) sửa độc lập,
                nhập số tuyệt đối. Tổng cộng = chỉ đọc (= kho + quầy). */}
            <Panel title="Kiểm kê">
                <QtyRow
                    label="Tồn kho" value={warehouseStock} unit={unit}
                    hasPack={hasPack} packSize={packSize} packUnit={packUnit}
                    canEdit={canEdit} editable onSave={onSaveWarehouse}
                />
                <QtyRow
                    label="Tồn quầy" value={counterStock} unit={unit}
                    hasPack={hasPack} packSize={packSize} packUnit={packUnit}
                    canEdit={canEdit} editable onSave={onSaveCounter}
                    note={counterReal != null ? `− bì ${tareWeight} → ${counterReal} ${unit} thật` : null}
                />
                <QtyRow
                    label="Tổng cộng" value={currentStock} unit={unit}
                    hasPack={hasPack} packSize={packSize} packUnit={packUnit}
                    canEdit={canEdit} editable={false} valueClass="text-primary"
                />
                <AuditRow value={countInAudit} canEdit={canEdit} saving={saving} onToggle={onToggleAudit} />
            </Panel>
        </div>
    )
}

// ── Panel (titled section card) ─────────────────────────────────────────────
function Panel({ title, children }) {
    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-black uppercase tracking-widest text-text-secondary px-1">{title}</span>
            <section className="bg-surface rounded-[18px] border border-border/60 p-4 flex flex-col divide-y divide-border/40">
                {children}
            </section>
        </div>
    )
}

// ── Row container ───────────────────────────────────────────────────────────
function Row({ label, children }) {
    return (
        <div className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
            <span className="text-[12px] font-bold text-text-secondary">{label}</span>
            <div>{children}</div>
        </div>
    )
}

// ── Name ────────────────────────────────────────────────────────────────────
function NameRow({ value, canEdit, onSave }) {
    const [editing, setEditing] = useState(false)
    const [input, setInput] = useState('')
    const start = () => { setInput(value); setEditing(true) }
    const commit = () => { setEditing(false); onSave?.(input) }
    return (
        <Row label="Tên">
            {editing && canEdit ? (
                <input
                    autoFocus
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onBlur={commit}
                    onKeyDown={e => {
                        if (e.key === 'Enter') commit()
                        if (e.key === 'Escape') setEditing(false)
                    }}
                    className="w-40 bg-surface-light border border-border/60 rounded-[8px] px-2 py-1 text-[13px] font-bold text-text text-right focus:outline-none focus:border-primary/50"
                />
            ) : (
                <button
                    onClick={canEdit ? start : undefined}
                    className={`text-[13px] font-bold text-text text-right ${canEdit ? 'cursor-pointer hover:text-primary' : 'cursor-default'}`}
                >
                    {value}
                </button>
            )}
        </Row>
    )
}

// ── Stock qty row (Kho sau / Tồn quầy / Tổng tồn) ───────────────────────────
// editable=false → chỉ đọc (dùng cho "Tổng tồn"). editable + canEdit → tap để nhập
// SỐ TUYỆT ĐỐI (đếm được bao nhiêu nhập bấy nhiêu); parent tự quy ra delta/ghi.
function QtyRow({ label, value, unit, hasPack, packSize, packUnit, canEdit, editable = true, onSave, valueClass = 'text-text', note = null }) {
    const [editing, setEditing] = useState(false)
    const [input, setInput] = useState('')
    const tappable = editable && canEdit
    const start = () => {
        setInput(String(value != null ? Math.round(value * 10) / 10 : 0))
        setEditing(true)
    }
    const commit = () => {
        setEditing(false)
        const num = Number(input)
        if (Number.isFinite(num) && num >= 0) onSave?.(num)
    }
    return (
        <Row label={label}>
            {editing && tappable ? (
                <div className="flex items-center gap-1">
                    <input
                        autoFocus
                        type="text"
                        inputMode="decimal"
                        value={input}
                        onChange={e => setInput(e.target.value.replace(',', '.').replace(/[^\d.]/g, ''))}
                        onBlur={commit}
                        onKeyDown={e => {
                            if (e.key === 'Enter') commit()
                            if (e.key === 'Escape') setEditing(false)
                        }}
                        className="w-24 bg-surface-light border border-border/60 rounded-[8px] px-2 py-1 text-[14px] font-black text-text text-right tabular-nums focus:outline-none focus:border-primary/50"
                    />
                    <span className="text-[12px] text-text-dim font-medium">{unit}</span>
                </div>
            ) : (
                <div className="flex flex-col items-end gap-0.5 leading-tight">
                    <button
                        onClick={tappable ? start : undefined}
                        className={`text-[14px] font-black tabular-nums ${valueClass} ${tappable ? 'cursor-pointer hover:text-primary' : 'cursor-default'}`}
                    >
                        {value != null ? Math.round(value * 10) / 10 : '—'}
                        <span className="text-text-dim font-medium ml-1">{unit}</span>
                    </button>
                    {hasPack && value != null && value >= packSize && (
                        <span className="text-[11px] font-medium text-text-dim tabular-nums">
                            = {formatPackedQty(value, packSize, packUnit, unit, { compact: true })}
                        </span>
                    )}
                    {note && (
                        <span className="text-[11px] font-medium text-text-dim/80 tabular-nums">{note}</span>
                    )}
                </div>
            )}
        </Row>
    )
}

// ── Unit ────────────────────────────────────────────────────────────────────
function UnitRow({ value, canEdit, onSave }) {
    const [editing, setEditing] = useState(false)
    const [input, setInput] = useState('')
    const start = () => { setInput(value); setEditing(true) }
    const commit = () => { setEditing(false); onSave?.((input || '').trim() || 'đv') }
    return (
        <Row label="Đơn vị">
            {editing && canEdit ? (
                <input
                    autoFocus
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onBlur={commit}
                    onKeyDown={e => {
                        if (e.key === 'Enter') commit()
                        if (e.key === 'Escape') setEditing(false)
                    }}
                    className="w-20 bg-surface-light border border-border/60 rounded-[8px] px-2 py-1 text-[13px] font-bold text-text text-right focus:outline-none focus:border-primary/50"
                />
            ) : (
                <button
                    onClick={canEdit ? start : undefined}
                    className={`text-[13px] font-bold text-text ${canEdit ? 'cursor-pointer hover:text-primary' : 'cursor-default'}`}
                >
                    {value}
                </button>
            )}
        </Row>
    )
}

// ── Cost ────────────────────────────────────────────────────────────────────
function CostRow({ cost, unit, canEdit, onSave }) {
    const [editing, setEditing] = useState(false)
    const [input, setInput] = useState('')
    const start = () => { setInput(formatVNDInput(cost)); setEditing(true) }
    const commit = () => { setEditing(false); onSave?.(parseVNDInput(input)) }
    return (
        <Row label="Giá vốn">
            {canEdit && editing ? (
                <div className="flex items-center gap-1">
                    <MoneyInput
                        value={input}
                        onChange={setInput}
                        onBlur={commit}
                        onKeyDown={e => {
                            if (e.key === 'Enter') commit()
                            if (e.key === 'Escape') setEditing(false)
                        }}
                        autoFocus
                        size="sm"
                        className="w-32"
                    />
                    <span className="text-[12px] text-text-dim font-medium">/{unit}</span>
                </div>
            ) : (
                <button
                    onClick={canEdit ? start : undefined}
                    className={`text-[14px] font-bold text-text tabular-nums ${canEdit ? 'cursor-pointer hover:text-primary' : ''}`}
                >
                    {formatVND(cost)}<span className="text-text-dim font-medium">/{unit}</span>
                </button>
            )}
        </Row>
    )
}

// ── Category (single-tap select; no edit toggle) ────────────────────────────
function CategoryRow({ value, canEdit, saving, onChange }) {
    return (
        <Row label="Nhóm">
            {canEdit ? (
                <select
                    value={value}
                    disabled={saving}
                    onChange={e => onChange?.(e.target.value)}
                    className="bg-transparent border-0 text-[13px] font-bold text-text text-right focus:outline-none cursor-pointer"
                >
                    {INGREDIENT_CATEGORIES.map(c => (
                        <option key={c.key} value={c.key}>{c.label}</option>
                    ))}
                </select>
            ) : (
                <span className="text-[13px] font-bold text-text">
                    {INGREDIENT_CATEGORIES.find(c => c.key === value)?.label || 'Nguyên liệu chính'}
                </span>
            )}
        </Row>
    )
}

// ── Pack (opens modal) ──────────────────────────────────────────────────────
function PackRow({ hasPack, packSize, packUnit, unit, canEdit, onConfigure }) {
    return (
        <Row label="Quy đổi">
            {hasPack ? (
                <button
                    onClick={canEdit ? onConfigure : undefined}
                    disabled={!canEdit}
                    className={`flex items-center gap-2 text-[13px] font-bold text-text tabular-nums ${canEdit ? 'hover:text-primary cursor-pointer' : 'cursor-default'}`}
                >
                    <span>1 {packUnit} = {packSize} {unit}</span>
                </button>
            ) : canEdit ? (
                <button
                    onClick={onConfigure}
                    className="text-[13px] font-bold text-primary hover:underline"
                >
                    + Thêm quy cách
                </button>
            ) : (
                <span className="text-[13px] text-text-dim italic">Chưa thiết lập</span>
            )}
        </Row>
    )
}

// ── Kiểm kê tồn kho (toggle) ─────────────────────────────────────────────────
// Bật = nguyên liệu này hiện trong list kiểm kê hao hụt lúc chốt ca. Tắt cho thứ
// không cần đếm cuối ca (vd vật tư cố định). Single-tap switch, lưu ngay.
function AuditRow({ value, canEdit, saving, onToggle }) {
    return (
        <Row label="Kiểm kê tồn kho">
            <button
                type="button"
                role="switch"
                aria-checked={value}
                disabled={!canEdit || saving}
                onClick={() => canEdit && onToggle?.(!value)}
                className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${value ? 'bg-primary' : 'bg-border'} ${canEdit ? 'cursor-pointer' : 'cursor-default opacity-60'}`}
            >
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${value ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
        </Row>
    )
}

// ── Min stock ───────────────────────────────────────────────────────────────
function MinStockRow({ minStock, unit, hasPack, packSize, packUnit, canEdit, onSave }) {
    const [editing, setEditing] = useState(false)
    const [input, setInput] = useState('')
    const start = () => {
        // Soft sync: first-time setup with a pack config pre-fills the pack
        // size, since "min = 1 pack" matches how owners reason about restock
        // thresholds. User can overwrite freely before saving.
        const seed = minStock != null
            ? String(minStock)
            : (packSize ? String(packSize) : '')
        setInput(seed)
        setEditing(true)
    }
    const commit = () => {
        setEditing(false)
        const raw = String(input).replace(',', '.').replace(/[^\d.]/g, '')
        onSave?.(raw ? Number(raw) : 0)
    }
    return (
        <Row label="Tồn tối thiểu">
            {editing && canEdit ? (
                <div className="flex items-center gap-1">
                    <input
                        autoFocus
                        type="text"
                        inputMode="decimal"
                        value={input}
                        onChange={e => setInput(e.target.value.replace(',', '.').replace(/[^\d.]/g, ''))}
                        onBlur={commit}
                        onKeyDown={e => {
                            if (e.key === 'Enter') commit()
                            if (e.key === 'Escape') setEditing(false)
                        }}
                        className="w-20 bg-surface-light border border-border/60 rounded-[8px] px-2 py-1 text-[13px] font-bold text-text text-right tabular-nums focus:outline-none focus:border-primary/50"
                    />
                    <span className="text-[12px] text-text-dim font-medium">{unit}</span>
                </div>
            ) : minStock != null ? (
                <button
                    onClick={canEdit ? start : undefined}
                    className={`flex flex-col items-end gap-0.5 leading-tight text-[13px] font-bold text-text tabular-nums ${canEdit ? 'cursor-pointer hover:text-primary' : 'cursor-default'}`}
                >
                    <span>
                        {minStock} <span className="text-text-dim font-medium">{unit}</span>
                    </span>
                    {hasPack && minStock >= packSize && (
                        <span className="text-[11px] font-medium text-text-dim">
                            = {formatPackedQty(minStock, packSize, packUnit, unit, { compact: true })}
                        </span>
                    )}
                </button>
            ) : (
                <button
                    onClick={start}
                    className="text-[13px] font-bold text-primary hover:underline"
                >
                    + Thêm mức tối thiểu
                </button>
            )}
        </Row>
    )
}

// ── Tare weight (khối lượng bì) ─────────────────────────────────────────────
// Hộp/chai đựng NVL tại quầy — cân kiểm kê cuối ca gộp cả bì (không tare được).
// Số cân GIỮ nguyên (bì tự khử trong hao hụt); bì chỉ được TRỪ khi DỰ BÁO để ra
// lượng thật. Hiệu ứng "còn bao nhiêu thật" hiện ở dòng Tồn quầy — không lặp ở đây.
function TareRow({ tareWeight, unit, canEdit, onSave }) {
    const [editing, setEditing] = useState(false)
    const [input, setInput] = useState('')
    const start = () => {
        setInput(tareWeight != null ? String(tareWeight) : '')
        setEditing(true)
    }
    const commit = () => {
        setEditing(false)
        const raw = String(input).replace(',', '.').replace(/[^\d.]/g, '')
        onSave?.(raw ? Number(raw) : 0)
    }
    return (
        <Row label="Khối lượng bì">
            {editing && canEdit ? (
                <div className="flex items-center gap-1">
                    <input
                        autoFocus
                        type="text"
                        inputMode="decimal"
                        value={input}
                        onChange={e => setInput(e.target.value.replace(',', '.').replace(/[^\d.]/g, ''))}
                        onBlur={commit}
                        onKeyDown={e => {
                            if (e.key === 'Enter') commit()
                            if (e.key === 'Escape') setEditing(false)
                        }}
                        className="w-20 bg-surface-light border border-border/60 rounded-[8px] px-2 py-1 text-[13px] font-bold text-text text-right tabular-nums focus:outline-none focus:border-primary/50"
                    />
                    <span className="text-[12px] text-text-dim font-medium">{unit}</span>
                </div>
            ) : tareWeight != null && tareWeight > 0 ? (
                <button
                    onClick={canEdit ? start : undefined}
                    className={`text-[13px] font-bold text-text tabular-nums ${canEdit ? 'cursor-pointer hover:text-primary' : 'cursor-default'}`}
                >
                    {tareWeight} <span className="text-text-dim font-medium">{unit}</span>
                </button>
            ) : (
                <button
                    onClick={start}
                    className="text-[13px] font-bold text-primary hover:underline"
                >
                    + Khai báo bì hộp
                </button>
            )}
        </Row>
    )
}
