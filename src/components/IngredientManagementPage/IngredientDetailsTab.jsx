import { useState } from 'react'
import { Check, Info, Pencil, Trash2 } from 'lucide-react'
import { formatPackedQty } from '../../utils/inventory'
import { INGREDIENT_CATEGORIES } from '../../utils/ingredients'
import { onboardingHintClass } from '../../utils/onboardingHint'

// All "tap-to-edit" state lives inside this component. The page only hands in
// current values + one save callback per field — keeps the page's state
// surface small and lets the row components be self-contained.
//
// Save callbacks are async-friendly: parent decides what to do on success/failure
// (we just close the edit affordance optimistically before awaiting).
export default function IngredientDetailsTab({
    nameLabel, unit, category, packSize, packUnit, minStock, tareWeight,
    countInAudit, onToggleAudit,   // toggle "báo cáo tồn quầy" — rút gọn từ panel Kiểm kê cũ thành 1 row
    hintPack = false, hintMinStock = false, hintTare = false,
    canEdit, saving,
    onSaveName,         // (newDisplayName: string) => Promise
    onSaveUnit,         // (newUnit: string)       => Promise
    onSaveMinStock,     // (newMin: number)        => Promise
    onSaveTareWeight,   // (newTare: number)       => Promise  (0 = xoá bì)
    onChangeCategory,   // (newCat: string)        => Promise (still controlled — single tap)
    onConfigurePack,    // ()                      => void   (opens modal)
}) {
    const hasPack = !!(packSize && packUnit)
    // Bì chỉ có nghĩa với NVL cân/đong (hộp thiếc matcha, chai nhựa sữa đặc).
    // NVL đếm cái (ly/nắp/gói) → ẩn hàng.
    const tareApplies = ['g', 'ml', 'kg', 'l'].includes(unit)
    return (
        <div className="flex flex-col gap-4">
            {/* Thuộc tính NVL/bao bì (không phải số tồn) — số tồn/kiểm kê nằm ở tab Nhật ký. */}
            <Panel >
                <CategoryRow value={category} canEdit={canEdit} saving={saving} onChange={onChangeCategory} />
                <NameRow value={nameLabel} canEdit={canEdit} onSave={onSaveName} />
                <UnitRow value={unit} canEdit={canEdit} onSave={onSaveUnit} />
                {tareApplies && (tareWeight != null || canEdit) && (
                    <TareRow tareWeight={tareWeight} unit={unit} canEdit={canEdit} onSave={onSaveTareWeight} hint={hintTare} />
                )}
                {onToggleAudit && (
                    <Row
                        label="Báo cáo"
                        info="Bật để nguyên liệu này được tính vào báo cáo tồn kho/tồn quầy khi kiểm kê cuối ca. Tắt nếu không cần theo dõi (VD: nước, đá, gia vị lặt vặt)."
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
          <Panel >
                
                <PackRow
                    hasPack={hasPack}
                    packSize={packSize}
                    packUnit={packUnit}
                    unit={unit}
                    canEdit={canEdit}
                    onConfigure={onConfigurePack}
                    hint={hintPack}
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
                        hint={hintMinStock}
                    />
                )}
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
    unit, packSize, packUnit,
    warehouseStock, warehouseGroupNote, hintWarehouse = false,
    dailyContext,       // { today_refill, today_restock } | null — Đầu ngày/Lấy ra/Nhập mới
    canEdit,
    onSaveWarehouse,    // (newWarehouse: number)  => Promise  (Kho sau)
}) {
    const hasPack = !!(packSize && packUnit)
    const todayRefill = Number(dailyContext?.today_refill || 0)
    const todayRestock = Number(dailyContext?.today_restock || 0)
    const warehouseNow = warehouseStock ?? 0
    const warehouseStart = warehouseNow + todayRestock - todayRefill
    return (
        <Panel>
            <div className="flex flex-col divide-y divide-border/40">
                <DailyQtyRow label="Tồn kho đầu ngày" value={warehouseStart} unit={unit} hasPack={hasPack} packSize={packSize} packUnit={packUnit} />
                <DailyQtyRow
                    label="Lấy ra" value={todayRestock} unit={unit} hasPack={hasPack} packSize={packSize} packUnit={packUnit}
                    sign="−" accentClass={todayRestock > 0 ? 'text-warning' : 'text-text'}
                />
                <DailyQtyRow
                    label="Nhập mới" value={todayRefill} unit={unit} hasPack={hasPack} packSize={packSize} packUnit={packUnit}
                    sign="+" accentClass={todayRefill > 0 ? 'text-success' : 'text-text'}
                />
                <QtyRow
                    label="Tồn kho cuối ngày" value={warehouseStock} unit={unit}
                    hasPack={hasPack} packSize={packSize} packUnit={packUnit}
                    canEdit={canEdit} editable onSave={onSaveWarehouse}
                    groupNote={warehouseGroupNote} hint={hintWarehouse}
                />
            </div>
        </Panel>
    )
}

// ── Counter panel (Tồn quầy / Tổng cộng) — Tồn quầy sửa được (nhập số tuyệt
// đối); Tổng cộng chỉ đọc (kho + quầy cộng lại, tính ở page).
export function IngredientCounterPanel({
    unit, packSize, packUnit, tareWeight,
    counterStock, currentStock,
    siblingCounterStocks,   // [{ addressId, addressName, counterStock }] | null — tồn quầy các địa chỉ khác dùng chung kho
    canEdit,
    onSaveCounter,      // (newCounter: number)    => Promise  (Tồn quầy → ghi remaining ca mới nhất)
}) {
    const hasPack = !!(packSize && packUnit)
    const tareApplies = ['g', 'ml', 'kg', 'l'].includes(unit)
    const hasTare = tareApplies && tareWeight > 0
    // Tồn quầy đang lưu = số cân (gồm bì) → lượng thật = trừ bì (chỉ để hiển thị).
    const counterReal = hasTare && counterStock != null
        ? Math.max(0, Math.round((counterStock - tareWeight) * 10) / 10)
        : null
    return (
        <Panel>
            <QtyRow
                label={siblingCounterStocks?.length ? 'Tồn quầy · đây' : 'Tồn quầy'}
                value={counterStock} unit={unit}
                hasPack={hasPack} packSize={packSize} packUnit={packUnit}
                canEdit={canEdit} editable onSave={onSaveCounter}
                note={counterReal != null ? `− bì ${tareWeight} → ${counterReal} ${unit} thật` : null}
            />
            {siblingCounterStocks?.map(s => (
                <QtyRow
                    key={s.addressId}
                    label={`Tồn quầy · ${s.addressName}`} value={s.counterStock} unit={unit}
                    hasPack={hasPack} packSize={packSize} packUnit={packUnit}
                    canEdit={false} editable={false}
                />
            ))}
            <QtyRow label="Tổng cộng" value={currentStock} unit={unit} hasPack={hasPack} packSize={packSize} packUnit={packUnit} canEdit={false} editable={false} />
        </Panel>
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
function DailyQtyRow({ label, value, unit, hasPack, packSize, packUnit, sign = '', accentClass = 'text-text' }) {
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
                        = {formatPackedQty(value, packSize, packUnit, unit, { compact: true })}
                    </span>
                )}
            </div>
        </Row>
    )
}

// ── Stock qty row (Kho sau / Tồn quầy / Tổng tồn) ───────────────────────────
// editable=false → chỉ đọc (dùng cho "Tổng tồn"). editable + canEdit → tap để nhập
// SỐ TUYỆT ĐỐI (đếm được bao nhiêu nhập bấy nhiêu); parent tự quy ra delta/ghi.
function QtyRow({ label, value, unit, hasPack, packSize, packUnit, canEdit, editable = true, onSave, valueClass = 'text-text', note = null, groupNote = null, hint = false }) {
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
function PackRow({ hasPack, packSize, packUnit, unit, canEdit, onConfigure, hint = false }) {
    return (
        <Row label="Tồn quy đổi">
            {hasPack ? (
                <button
                    onClick={canEdit ? onConfigure : undefined}
                    disabled={!canEdit}
                    className={`flex flex-col items-end gap-0.5 leading-tight text-[13px] font-bold text-text tabular-nums ${canEdit ? 'cursor-pointer hover:text-primary' : 'cursor-default'}`}
                >
                    <span>
                        {packSize} <span className="text-text-dim font-medium">{unit}</span>
                    </span>
                    <span className="text-[11px] font-medium text-text-dim">= 1 {packUnit}</span>
                </button>
            ) : canEdit ? (
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

// ── Min stock ───────────────────────────────────────────────────────────────
function MinStockRow({ minStock, unit, hasPack, packSize, packUnit, canEdit, onSave, hint = false }) {
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
        <Row label="Tồn ít nhất">
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
                            = {formatPackedQty(minStock, packSize, packUnit, unit, { compact: true })}
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
function TareRow({ tareWeight, unit, canEdit, onSave, hint = false }) {
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
                    className={`w-6 h-6 flex items-center justify-center rounded-lg border border-primary/30 text-[13px] font-bold text-primary hover:bg-primary/10 transition-colors ${onboardingHintClass(hint)}`}
                >
                    +
                </button>
            )}
        </Row>
    )
}
