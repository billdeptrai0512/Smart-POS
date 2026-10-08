import { useState } from 'react'
import { Check, Info, Trash2 } from 'lucide-react'
import { formatPackedQty, netStockOf } from '../../utils/inventory'
import { INGREDIENT_CATEGORIES } from '../../utils/ingredients'
import { onboardingHintClass } from '../../utils/onboardingHint'
import Dropdown from '../common/Dropdown'

// All "tap-to-edit" state lives inside this component. The page only hands in
// current values + one save callback per field — keeps the page's state
// surface small and lets the row components be self-contained.
//
// Save callbacks are async-friendly: parent decides what to do on success/failure
// (we just close the edit affordance optimistically before awaiting).
export default function IngredientDetailsTab({
    nameLabel, unit, category, groupId = null, groups = null, packSize, packUnit, pack2,
    countInAudit, onToggleAudit,   // toggle "báo cáo tồn quầy" — rút gọn từ panel Kiểm kê cũ thành 1 row
    hintPack = false,
    canEdit, saving,
    onSaveName,         // (newDisplayName: string) => Promise
    onSaveUnit,         // (newUnit: string)       => Promise
    onChangeGroup,      // (groupId: string|null) => Promise (single tap)
    onConfigurePack,    // ()                      => void   (opens modal)
}) {
    const hasPack = !!(packSize && packUnit)
    return (
        <div className="flex flex-col gap-4">
            {/* Thuộc tính NVL/bao bì (không phải số tồn) — số tồn/kiểm kê nằm ở tab Nhật ký. */}
            <Panel >
                <CategoryRow value={category} groupId={groupId} groups={groups} canEdit={canEdit} saving={saving} onChange={onChangeGroup} />
                <NameRow value={nameLabel} canEdit={canEdit} onSave={onSaveName} />
                <UnitRow value={unit} canEdit={canEdit} onSave={onSaveUnit} />
                {onToggleAudit && (
                    <Row
                        label="Kiểm kê"
                        sub={countInAudit
                            ? 'Nguyên liệu này được liệt kê trong danh sách kiểm kê.'
                            : 'Nguyên liệu này không được liệt kê trong danh sách kiểm kê.'}
                    >
                        <button
                            type="button"
                            role="checkbox"
                            aria-checked={countInAudit}
                            aria-label="Báo cáo tồn quầy"
                            title={countInAudit ? 'Đang báo cáo tồn quầy — bấm để tắt' : 'Đang TẮT báo cáo tồn quầy — bấm để bật'}
                            disabled={!canEdit || saving}
                            onClick={() => canEdit && onToggleAudit(!countInAudit)}
                            className={`relative w-5 h-5 flex items-center justify-center rounded-[6px] border transition-colors focus:outline-none shrink-0 before:absolute before:-inset-2.5 before:content-[''] ${
                                countInAudit ? 'bg-primary border-primary' : 'bg-surface-light border-border/60'
                            } ${canEdit ? 'cursor-pointer' : 'cursor-default opacity-60'}`}
                        >
                            {countInAudit && <Check size={13} strokeWidth={3} className="text-black" />}
                        </button>
                    </Row>
                )}
            </Panel>
            <Panel>
                <PackRow
                    hasPack={hasPack}
                    packSize={packSize}
                    packUnit={packUnit} pack2={pack2}
                    unit={unit}
                    canEdit={canEdit}
                    onConfigure={onConfigurePack}
                    hint={hintPack}
                />
            </Panel>
        </div>
    )
}

// ── Delete action — tách riêng để page kiểm soát vị trí (đặt sau card Kiểm kê). ──
export function DeleteIngredientButton({ canEdit, onDelete }) {
    if (!canEdit || !onDelete) return null
    return (
        <button
            onClick={onDelete}
            className="flex items-center justify-center gap-1.5 w-full text-[12px] font-bold text-danger/80 bg-danger/5 border border-danger/20 rounded-[12px] px-3 py-2.5 hover:bg-danger/10 hover:text-danger active:scale-[0.99] transition-all"
        >
            <Trash2 size={14} /> Xóa nguyên liệu
        </button>
    )
}

// ── Stock panel (Kiểm kê tồn kho / tồn quầy) — breakdown Đầu ngày/Lấy ra/Nhập
// mới + sửa Tồn kho cuối ngày. Tồn quầy/Tổng cộng đã tách thành card riêng
// (IngredientCounterPanel); toggle "báo cáo" đã tách thành 1 row ở tab Thông tin.
export function IngredientStockPanel({
    unit, packSize, packUnit, pack2,
    warehouseStock, warehouseGroupNote, hintWarehouse = false,
    minStock, hintMinStock = false,   // tồn KHO ít nhất (= min_stock)
    dailyContext,       // { today_refill, today_restock } | null — Đầu ngày/Lấy ra/Nhập mới
    canEdit,
    onSaveWarehouse,    // (newWarehouse: number)  => Promise  (Kho sau)
    onSaveMinStock,     // (newMin: number)        => Promise
}) {
    const hasPack = !!(packSize && packUnit)
    const todayRefill = Number(dailyContext?.today_refill || 0)
    const todayRestock = Number(dailyContext?.today_restock || 0)
    const warehouseNow = warehouseStock ?? 0
    const warehouseStart = warehouseNow + todayRestock - todayRefill
    return (
        <>
            {(minStock != null || canEdit) && (
                <Panel>
                    <MinStockRow
                        label="Tồn kho ít nhất" minStock={minStock} unit={unit}
                        hasPack={hasPack} packSize={packSize} packUnit={packUnit} pack2={pack2}
                        canEdit={canEdit} onSave={onSaveMinStock} hint={hintMinStock}
                    />
                </Panel>
            )}
            <Panel>
                <div className="flex flex-col divide-y divide-border/40">
                    <DailyQtyRow label="Tồn kho đầu ngày" value={warehouseStart} unit={unit} hasPack={hasPack} packSize={packSize} packUnit={packUnit} pack2={pack2} />
                    <DailyQtyRow
                        label="Lấy ra" value={todayRestock} unit={unit} hasPack={hasPack} packSize={packSize} packUnit={packUnit} pack2={pack2}
                        sign="−" accentClass={todayRestock > 0 ? 'text-warning' : 'text-text'}
                    />
                    <DailyQtyRow
                        label="Nhập mới" value={todayRefill} unit={unit} hasPack={hasPack} packSize={packSize} packUnit={packUnit} pack2={pack2}
                        sign="+" accentClass={todayRefill > 0 ? 'text-success' : 'text-text'}
                    />
                    <QtyRow
                        label="Tồn kho cuối ngày" value={warehouseStock} unit={unit}
                        hasPack={hasPack} packSize={packSize} packUnit={packUnit} pack2={pack2}
                        canEdit={canEdit} editable onSave={onSaveWarehouse}
                        groupNote={warehouseGroupNote} hint={hintWarehouse}
                    />
                </div>
            </Panel>
        </>
    )
}

// ── Counter panel (Tồn quầy / Tổng cộng) — Tồn quầy sửa được (nhập số tuyệt
// đối); Tổng cộng chỉ đọc (kho + quầy cộng lại, tính ở page).
export function IngredientCounterPanel({
    unit, packSize, packUnit, pack2, tareWeight, hintTare = false,
    minCounterStock,        // tồn QUẦY ít nhất
    counterStock, currentStock,
    counterEstimated,       // true = Tồn quầy đang là số ƯỚC TÍNH theo lý thuyết (chưa đếm hôm nay)
    siblingCounterStocks,   // [{ addressId, addressName, counterStock }] | null — tồn quầy các địa chỉ khác dùng chung kho
    canEdit,
    onSaveCounter,      // (newCounter: number)    => Promise  (Tồn quầy → ghi remaining ca mới nhất)
    onSaveTareWeight,   // (newTare: number)       => Promise  (0 = xoá bì)
    onSaveMinCounter,   // (newMin: number)        => Promise
}) {
    const hasPack = !!(packSize && packUnit)
    const tareApplies = ['g', 'ml', 'kg', 'l'].includes(unit)
    const hasTare = tareApplies && tareWeight > 0
    const showMinCounter = minCounterStock != null || canEdit
    // Bì chỉ có nghĩa với NVL cân/đong (hộp thiếc matcha, chai nhựa sữa đặc); NVL đếm cái → ẩn hàng.
    const showTare = tareApplies && (tareWeight != null || canEdit)
    // Tồn quầy đang lưu = số cân (gồm bì) → lượng thật = trừ bì (chỉ để hiển thị).
    const counterReal = hasTare && counterStock != null
        ? Math.max(0, Math.round((counterStock - tareWeight) * 10) / 10)
        : null
    return (
        <>
            {showMinCounter && (
                <Panel>
                    <MinStockRow
                        label="Tồn quầy ít nhất" minStock={minCounterStock} unit={unit}
                        hasPack={hasPack} packSize={packSize} packUnit={packUnit} pack2={pack2}
                        canEdit={canEdit} onSave={onSaveMinCounter}
                    />
                </Panel>
            )}
            <Panel>
                <QtyRow
                    label={siblingCounterStocks?.length ? 'Tồn quầy cuối kỳ · đây' : 'Tồn quầy cuối kỳ'}
                    value={counterStock} unit={unit}
                    hasPack={hasPack} packSize={packSize} packUnit={packUnit} pack2={pack2}
                    canEdit={canEdit} editable onSave={onSaveCounter}
                    note={counterEstimated ? 'ước tính theo lý thuyết — nhập số đếm để xác nhận' : null}
                />
                {siblingCounterStocks?.map(s => (
                    <QtyRow
                        key={s.addressId}
                        label={`Tồn quầy · ${s.addressName}`} value={s.counterStock} unit={unit}
                        hasPack={hasPack} packSize={packSize} packUnit={packUnit} pack2={pack2}
                        canEdit={false} editable={false}
                    />
                ))}
                {showTare && (
                    <TareRow tareWeight={tareWeight} unit={unit} canEdit={canEdit} onSave={onSaveTareWeight} hint={hintTare} />
                )}
                {/* Kết quả của phép trừ: số cân − bì. Chỉ hiện khi đã có bì và đã có số tồn quầy. */}
                {counterReal != null && (
                    <QtyRow
                        label="Tồn quầy thực" value={counterReal} unit={unit}
                        hasPack={hasPack} packSize={packSize} packUnit={packUnit} pack2={pack2}
                        canEdit={false} editable={false}
                    />
                )}
            </Panel>
            <Panel>
                <QtyRow label="Tổng cộng" value={netStockOf({ current_stock: currentStock, counter_stock: counterStock }, tareWeight, unit)} unit={unit} hasPack={hasPack} packSize={packSize} packUnit={packUnit} pack2={pack2} canEdit={false} editable={false} />
            </Panel>
        </>
    )
}

// ── Panel (titled section card) ─────────────────────────────────────────────
// `action` = control cấp panel (vd toggle "báo cáo tồn quầy"), nằm cuối hàng title cho khỏi
// chiếm 1 dòng trong thẻ — panel nào không truyền thì hàng title y như cũ.
function Panel({ title, children, action }) {
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2 px-1">
                <span className="text-[11px] font-black uppercase tracking-widest text-text-secondary">{title}</span>
                {action}
            </div>
            <section className="bg-surface rounded-[18px] border border-border/60 p-4 flex flex-col divide-y divide-border/40">
                {children}
            </section>
        </div>
    )
}

// ── Row container ───────────────────────────────────────────────────────────
// `sub` = caption spanning the FULL row width (dùng cho note dài, không đoán trước được độ dài —
// vd danh sách địa chỉ cùng nhóm kho tổng). Khác với `note` bên trong QtyRow (ngắn, nằm cạnh số).
// `info` = chú thích ẩn, bấm icon (i) cạnh label mới bung ra — cùng kiểu với "Lý thuyết" ở
// InventoryReportCard.jsx.
function Row({ label, children, sub, info }) {
    const [showInfo, setShowInfo] = useState(false)
    return (
        <div className="py-2.5 first:pt-0 last:pb-0">
            <div className="flex items-center justify-between gap-3">
                {info ? (
                    <button
                        onClick={() => setShowInfo(s => !s)}
                        className="flex items-center gap-1 text-[12px] font-bold text-text-secondary hover:text-text transition-colors"
                    >
                        {label} <Info size={10} className="text-text-dim shrink-0" />
                    </button>
                ) : (
                    <span className="text-[12px] font-bold text-text-secondary">{label}</span>
                )}
                <div>{children}</div>
            </div>
            {showInfo && (
                <div className="mt-1.5 px-3 py-2 bg-surface-light rounded-[10px] border border-border/40 text-[11px] text-text-secondary leading-snug">
                    {info}
                </div>
            )}
            {sub && <div className="mt-1 text-[11px] font-medium text-text-dim/80">{sub}</div>}
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

// ── Daily qty row (Tồn đầu ngày / Lấy ra / Nhập mới) ────────────────────────
// Chỉ đọc, cùng cách diễn đạt với Tồn quy đổi: số gốc đậm ở trên, breakdown quy
// đổi (nếu có) mờ bên dưới — thay vì gộp sẵn thành 1 chuỗi compact như trước.
function DailyQtyRow({ label, value, unit, hasPack, packSize, packUnit, pack2, sign = '', accentClass = 'text-text' }) {
    const rounded = Math.round(value * 10) / 10
    const showPack = hasPack && value >= packSize
    return (
        <Row label={label}>
            {/* min-h giữ chỗ dòng quy đổi kể cả khi không có → các row trong cùng panel cao
                bằng nhau; không có gì để hiện thì canh số ở giữa khối thay vì dính trên */}
            <div className={`flex flex-col items-end gap-0.5 leading-tight ${hasPack ? 'min-h-[32px] justify-center' : ''}`}>
                <span className={`text-[13px] font-bold tabular-nums ${accentClass}`}>
                    {sign && `${sign} `}{rounded} <span className="text-text-dim font-medium">{unit}</span>
                </span>
                {showPack && (
                    <span className="text-[11px] font-medium text-text-dim">
                        = {formatPackedQty(value, packSize, packUnit, unit, { compact: true, pack2 })}
                    </span>
                )}
            </div>
        </Row>
    )
}

// ── Stock qty row (Kho sau / Tồn quầy / Tổng tồn) ───────────────────────────
// editable=false → chỉ đọc (dùng cho "Tổng tồn"). editable + canEdit → tap để nhập
// SỐ TUYỆT ĐỐI (đếm được bao nhiêu nhập bấy nhiêu); parent tự quy ra delta/ghi.
function QtyRow({ label, value, unit, hasPack, packSize, packUnit, pack2, canEdit, editable = true, onSave, valueClass = 'text-text', note = null, groupNote = null, hint = false }) {
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
        <Row label={label} sub={groupNote}>
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
                        className={`w-24 bg-surface-light border border-border/60 rounded-[8px] px-2 py-1 text-[13px] font-bold text-text text-right tabular-nums focus:outline-none focus:border-primary/50 ${onboardingHintClass(hint)}`}
                    />
                    <span className="text-[12px] text-text-dim font-medium">{unit}</span>
                </div>
            ) : (
                // min-h giữ chỗ dòng quy đổi kể cả khi không có → các row trong cùng panel cao
                // bằng nhau; không có gì để hiện thì canh số ở giữa khối thay vì dính trên
                <div className={`flex flex-col items-end gap-0.5 leading-tight ${hasPack ? 'min-h-[32px] justify-center' : ''}`}>
                    <button
                        onClick={tappable ? start : undefined}
                        className={`inline-flex items-baseline gap-1 text-[13px] font-bold tabular-nums rounded-md px-2 -mx-2 py-1 -my-1 ${tappable ? 'text-primary cursor-pointer hover:brightness-110' : `${valueClass} cursor-default`} ${onboardingHintClass(hint)}`}
                    >
                        {value != null ? Math.round(value * 10) / 10 : '—'}
                        <span className="text-text-dim font-medium">{unit}</span>
                    </button>
                    {hasPack && value != null && value >= packSize && (
                        <span className="text-[11px] font-medium text-text-dim tabular-nums">
                            = {formatPackedQty(value, packSize, packUnit, unit, { compact: true, pack2 })}
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


// ── Category (single-tap select; no edit toggle) ────────────────────────────
// Dropdown liệt kê mọi nhóm (value = groupId, '' = chưa phân nhóm); category của món đi theo section của nhóm
// (trigger DB ép), bỏ nhóm thì giữ category cũ. groups = null → địa chỉ không hỗ trợ nhóm (guest/template).
// Tạo/sửa nhóm ở sheet 'Quản lý'.
function CategoryRow({ value, groupId, groups, canEdit, saving, onChange }) {
    const groupName = groups?.find(g => g.id === groupId)?.name
    const sectionLabel = INGREDIENT_CATEGORIES.find(c => c.key === value)?.label || 'Nguyên liệu chính'
    const noGroupLabel = groups ? 'Chưa phân nhóm' : sectionLabel
    return (
        <Row label="Nhóm">
            {canEdit ? (
                <Dropdown
                    value={groupId || ''}
                    disabled={saving}
                    triggerLabel={groupName || noGroupLabel}
                    onChange={id => onChange?.(id || null)}
                    items={[
                        { value: '', label: noGroupLabel },
                        ...(groups || []).map(g => ({ value: g.id, label: g.name })),
                    ]}
                    className="max-w-[200px]"
                    triggerClassName="text-[13px]"
                />
            ) : (
                <span className="text-[13px] font-bold text-text">{groupName || sectionLabel}</span>
            )}
        </Row>
    )
}

// ── Pack (opens modal) ──────────────────────────────────────────────────────
function PackRow({ hasPack, packSize, packUnit, pack2, unit, canEdit, onConfigure, hint = false }) {
    if (!hasPack) {
        return (
            <Row label="Đơn vị quy đổi">
                {canEdit ? (
                    <button
                        onClick={onConfigure}
                        className={`w-6 h-6 flex items-center justify-center rounded-lg border border-primary/30 text-[13px] font-bold text-primary hover:bg-primary/10 transition-colors ${onboardingHintClass(hint)}`}
                    >
                        +
                    </button>
                ) : (
                    <span className="text-[13px] text-text-dim italic">Chưa thiết lập</span>
                )}
            </Row>
        )
    }
    // Mỗi cấp 1 row như các card khác: "1 thùng → 12 hộp", "1 hộp → 1284 g" (lớn → nhỏ).
    const tiers = [
        ...(pack2 ? [[pack2.unit, pack2.size, packUnit]] : []),
        [packUnit, packSize, unit],
    ]
    const rows = tiers.map(([from, qty, to]) => (
        <Row key={from} label={`1 ${from}`}>
            <span className="text-[13px] font-bold text-text tabular-nums">
                {qty} <span className="text-text-dim font-medium">{to}</span>
            </span>
        </Row>
    ))
    // Cả card bấm được để mở modal — không bắt người dùng nhắm vào từng con số.
    return canEdit ? (
        <button type="button" onClick={onConfigure} className="w-full text-left cursor-pointer active:opacity-70 transition-opacity divide-y divide-border/40">
            {rows}
        </button>
    ) : rows
}

// ── Min stock ───────────────────────────────────────────────────────────────
function MinStockRow({ label, minStock, unit, hasPack, packSize, packUnit, pack2, canEdit, onSave, hint = false }) {
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
        <Row label={label}>
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
                        className={`w-20 bg-surface-light border border-border/60 rounded-[8px] px-2 py-1 text-[13px] font-bold text-text text-right tabular-nums focus:outline-none focus:border-primary/50 ${onboardingHintClass(hint)}`}
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
                            = {formatPackedQty(minStock, packSize, packUnit, unit, { compact: true, pack2 })}
                        </span>
                    )}
                </button>
            ) : (
                <button
                    onClick={start}
                    className={`w-6 h-6 flex items-center justify-center rounded-lg border border-primary/30 text-[13px] font-bold text-primary hover:bg-primary/10 transition-colors ${onboardingHintClass(hint)}`}
                >
                    +
                </button>
            )}
        </Row>
    )
}

// ── Tare weight (khối lượng bì) ─────────────────────────────────────────────
// Hộp/chai đựng NVL tại quầy — cân kiểm kê cuối ca gộp cả bì (không tare được).
// Số cân GIỮ nguyên (bì tự khử trong hao hụt); bì chỉ được TRỪ khi DỰ BÁO để ra
// lượng thật. Hiệu ứng "còn bao nhiêu thật" hiện ở dòng Tồn quầy — không lặp ở đây.
// Bì là số CÂN nên hiển thị/nhập theo gram (mặc định), đổi sang kg/ml tuỳ ý khi nhập. DB vẫn lưu
// theo đơn vị của NVL (g/ml: 1:1; kg/l: ÷1000) vì mọi phép trừ bì (tồn quầy, dự báo) chạy trên đơn vị đó.
// ml quy 1:1 như g (tồn quầy ml cũng trừ bì theo số cân) — cho NVL lỏng nhập bì theo ml.
const TARE_UNITS = { g: 1, kg: 1000, ml: 1 }
const TARE_UNIT_KEYS = Object.keys(TARE_UNITS)
function TareRow({ tareWeight, unit, canEdit, onSave, hint = false }) {
    const [editing, setEditing] = useState(false)
    const [input, setInput] = useState('')
    const [tareUnit, setTareUnit] = useState('g')
    const gPerBase = ['kg', 'l'].includes(unit) ? 1000 : 1   // 1 đơn vị NVL = bao nhiêu gram
    const tareGrams = tareWeight != null ? Math.round(tareWeight * gPerBase * 10) / 10 : null
    const start = () => {
        setTareUnit('g')
        setInput(tareGrams != null ? String(tareGrams) : '')
        setEditing(true)
    }
    const commit = () => {
        setEditing(false)
        const raw = String(input).replace(',', '.').replace(/[^\d.]/g, '')
        const grams = raw ? Number(raw) * TARE_UNITS[tareUnit] : 0
        onSave?.(Math.round(grams / gPerBase * 1e4) / 1e4)
    }
    return (
        <Row
            label="Bao bì"
            info="Khối lượng của hộp/chai đựng nguyên liệu tại quầy.
 Kiểm kê cuối ca cân cả bì — số cân giữ nguyên, bì chỉ được trừ khi dự báo còn dùng được bao lâu."
        >
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
                        className={`w-20 bg-surface-light border border-border/60 rounded-[8px] px-2 py-1 text-[13px] font-bold text-text text-right tabular-nums focus:outline-none focus:border-primary/50 ${onboardingHintClass(hint)}`}
                    />
                    {/* mousedown preventDefault: giữ focus ở ô số, không để blur → commit trước khi đổi đơn vị */}
                    <button
                        type="button"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => setTareUnit(u => TARE_UNIT_KEYS[(TARE_UNIT_KEYS.indexOf(u) + 1) % TARE_UNIT_KEYS.length])}
                        title="Đổi đơn vị (g / kg / ml)"
                        className="text-[12px] font-bold text-primary px-1.5 py-0.5 rounded-md bg-primary/10 hover:bg-primary/20 transition-colors"
                    >
                        {tareUnit}
                    </button>
                </div>
            ) : tareWeight != null && tareWeight > 0 ? (
                <button
                    onClick={canEdit ? start : undefined}
                    className={`text-[13px] font-bold text-text tabular-nums ${canEdit ? 'cursor-pointer hover:text-primary' : 'cursor-default'}`}
                >
                    − {tareGrams} <span className="text-text-dim font-medium">g</span>
                </button>
            ) : (
                <button
                    onClick={start}
                    className={`w-6 h-6 flex items-center justify-center rounded-lg border border-primary/30 text-[13px] font-bold text-primary hover:bg-primary/10 transition-colors ${onboardingHintClass(hint)}`}
                >
                    +
                </button>
            )}
        </Row>
    )
}
