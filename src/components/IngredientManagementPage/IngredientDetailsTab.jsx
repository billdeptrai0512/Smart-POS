import { useState } from 'react'
import { Check, Info, Pencil, Trash2 } from 'lucide-react'
import MoneyInput from '../common/MoneyInput'
import { formatVND, formatVNDInput, parseVNDInput } from '../../utils'
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
    nameLabel, unit, cost, category, packSize, packUnit, minStock, tareWeight,
    warehouseStock, warehouseGroupNote, hintWarehouse = false, counterStock, currentStock,
    hintPack = false, hintMinStock = false, hintTare = false,
    dailyContext,           // { today_refill, today_restock } | null — Đầu ngày/Lấy ra/Nhập mới
    siblingCounterStocks,   // [{ addressId, addressName, counterStock }] | null — tồn quầy các địa chỉ khác dùng chung kho
    countInAudit, onToggleAudit,
    canEdit, saving,
    onSaveName,         // (newDisplayName: string) => Promise
    onSaveWarehouse,    // (newWarehouse: number)  => Promise  (Kho sau)
    onSaveCounter,      // (newCounter: number)    => Promise  (Tồn quầy → ghi remaining ca mới nhất)
    onSaveUnit,         // (newUnit: string)       => Promise
    onSaveCost,         // (newCost: number)       => Promise
    onSaveMinStock,     // (newMin: number)        => Promise
    onSaveTareWeight,   // (newTare: number)       => Promise  (0 = xoá bì)
    onChangeCategory,   // (newCat: string)        => Promise (still controlled — single tap)
    onConfigurePack,    // ()                      => void   (opens modal)
    onDelete,           // ()                      => void   (xóa nguyên liệu)
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
    // Đầu ngày/Lấy ra/Nhập mới — cùng công thức với card ngoài /ingredients.
    const todayRefill = Number(dailyContext?.today_refill || 0)
    const todayRestock = Number(dailyContext?.today_restock || 0)
    const warehouseNow = warehouseStock ?? 0
    const warehouseStart = warehouseNow + todayRestock - todayRefill
    const fmtDaily = (n) => {
        if (n < 0) return `${Math.round(n * 10) / 10} ${unit}`
        return formatPackedQty(n, packSize, packUnit, unit, { compact: true })
    }
    return (
        <div className="flex flex-col gap-4">
            {/* Panel 1 — Kiểm kê: cùng bố cục với card ngoài /ingredients (đầu ngày → lấy ra
                → nhập mới → cuối ngày → tồn quầy từng địa chỉ → tổng cộng), nhưng Tồn kho cuối
                ngày + Tồn quầy của địa chỉ đang xem vẫn sửa được (nhập số tuyệt đối). */}
            <Panel
                title="Kiểm kê tồn kho / tồn quầy"
                action={onToggleAudit && (
                    <button
                        type="button"
                        role="checkbox"
                        aria-checked={countInAudit}
                        aria-label="Báo cáo tồn quầy"
                        title={countInAudit ? 'Đang báo cáo tồn quầy — bấm để tắt' : 'Đang TẮT báo cáo tồn quầy — bấm để bật'}
                        disabled={!canEdit || saving}
                        onClick={() => canEdit && onToggleAudit(!countInAudit)}
                        className={`w-5 h-5 flex items-center justify-center rounded-[6px] border transition-colors focus:outline-none shrink-0 ${
                            countInAudit ? 'bg-primary border-primary' : 'bg-surface-light border-border/60'
                        } ${canEdit ? 'cursor-pointer' : 'cursor-default opacity-60'}`}
                    >
                        {countInAudit && <Check size={13} strokeWidth={3} className="text-black" />}
                    </button>
                )}
            >
                {/* Bọc cả 2 nhóm trong 1 div duy nhất — section của Panel tự thêm divide-y cho
                    children trực tiếp, để 2 div nhóm làm children trực tiếp sẽ bị chèn thêm 1
                    viền tự động chồng lên viền group-break tự khai báo bên dưới. */}
                <div className="flex flex-col">
                    {/* Ranh giới giữa 2 nhóm = KHOẢNG CÁCH y hệt giữa 2 dòng thường (10px mỗi
                        bên, bù lại phần first:pt-0/last:pb-0 của Row), chỉ khác ở viền sáng hơn
                        (border-border vs border-border/40) — đủ để mắt tách nhóm mà không tạo
                        khoảng hở như 2 thẻ rời. */}
                    {/* Nhóm 1 — chuỗi kho hôm nay: đầu ngày − lấy ra + nhập mới = cuối ngày (1 phép tính). */}
                    <div className="flex flex-col divide-y divide-border/40 pb-2.5">
                        <Row label="Tồn kho đầu ngày">
                            <span className="text-[13px] font-bold text-text-secondary tabular-nums">{fmtDaily(warehouseStart)}</span>
                        </Row>
                        <Row label="Lấy ra">
                            <span className={`text-[13px] font-bold tabular-nums ${todayRestock > 0 ? 'text-warning' : 'text-text-secondary'}`}>
                                − {fmtDaily(todayRestock)}
                            </span>
                        </Row>
                        <Row label="Nhập mới">
                            <span className={`text-[13px] font-bold tabular-nums ${todayRefill > 0 ? 'text-success' : 'text-text-secondary'}`}>
                                + {fmtDaily(todayRefill)}
                            </span>
                        </Row>
                        <QtyRow
                            label="Tồn kho cuối ngày" value={warehouseStock} unit={unit}
                            hasPack={hasPack} packSize={packSize} packUnit={packUnit}
                            canEdit={canEdit} editable onSave={onSaveWarehouse}
                            groupNote={warehouseGroupNote} hint={hintWarehouse}
                        />
                    </div>

                    {/* Nhóm 2 — kho cuối ngày (trên) + quầy = tổng đang có thật ngay lúc này. */}
                    <div className="border-t border-border pt-2.5 flex flex-col divide-y divide-border/40">
                        <QtyRow
                            label={siblingCounterStocks?.length ? 'Tồn quầy hiện có · đây' : 'Tồn quầy hiện có'}
                            value={counterStock} unit={unit}
                            hasPack={hasPack} packSize={packSize} packUnit={packUnit}
                            canEdit={canEdit} editable onSave={onSaveCounter}
                            note={counterReal != null ? `− bì ${tareWeight} → ${counterReal} ${unit} thật` : null}
                        />
                        {siblingCounterStocks?.map(s => (
                            <QtyRow
                                key={s.addressId}
                                label={`Tồn quầy hiện có · ${s.addressName}`} value={s.counterStock} unit={unit}
                                hasPack={hasPack} packSize={packSize} packUnit={packUnit}
                                canEdit={false} editable={false}
                            />
                        ))}
                        <QtyRow
                            label="Tổng cộng" value={currentStock} unit={unit}
                            hasPack={hasPack} packSize={packSize} packUnit={packUnit}
                            canEdit={canEdit} editable={false}
                        />
                    </div>
                </div>
            </Panel>

            {/* Panel 2 — Thông tin: thuộc tính NVL/bao bì (không phải số tồn). */}
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
                {tareApplies && (tareWeight != null || canEdit) && (
                    <TareRow tareWeight={tareWeight} unit={unit} canEdit={canEdit} onSave={onSaveTareWeight} hint={hintTare} />
                )}
                <CostRow cost={cost} unit={unit} canEdit={canEdit} onSave={onSaveCost} />
            </Panel>

            {canEdit && onDelete && (
                <button
                    onClick={onDelete}
                    className="flex items-center justify-center gap-1.5 w-full text-[12px] font-bold text-danger/80 bg-danger/5 border border-danger/20 rounded-[12px] px-3 py-2.5 hover:bg-danger/10 hover:text-danger active:scale-[0.99] transition-all"
                >
                    <Trash2 size={14} /> Xóa nguyên liệu
                </button>
            )}
        </div>
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
                        className={`w-24 bg-surface-light border border-border/60 rounded-[8px] px-2 py-1 text-[14px] font-black text-text text-right tabular-nums focus:outline-none focus:border-primary/50 ${onboardingHintClass(hint)}`}
                    />
                    <span className="text-[12px] text-text-dim font-medium">{unit}</span>
                </div>
            ) : (
                <div className="flex flex-col items-end gap-0.5 leading-tight">
                    <button
                        onClick={tappable ? start : undefined}
                        className={`inline-flex items-baseline gap-1 text-[14px] font-black tabular-nums rounded-md px-2 -mx-2 py-1 -my-1 ${tappable ? 'text-primary cursor-pointer hover:brightness-110' : `${valueClass} cursor-default`} ${onboardingHintClass(hint)}`}
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
function PackRow({ hasPack, packSize, packUnit, unit, canEdit, onConfigure, hint = false }) {
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
                    className={`rounded-md px-2 -mx-2 py-1 -my-1 text-[13px] font-bold text-primary hover:underline ${onboardingHintClass(hint)}`}
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
        <Row label="Tồn kho tối thiểu">
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
                    className={`rounded-md px-2 -mx-2 py-1 -my-1 text-[13px] font-bold text-primary hover:underline ${onboardingHintClass(hint)}`}
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
            label="Khối lượng bì"
            info="Khối lượng hộp/chai rỗng đựng nguyên liệu tại quầy. Kiểm kê cuối ca cân cả bì — số cân giữ nguyên, bì chỉ được trừ khi dự báo còn dùng được bao lâu."
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
                    className={`rounded-md px-2 -mx-2 py-1 -my-1 text-[13px] font-bold text-primary hover:underline ${onboardingHintClass(hint)}`}
                >
                    +
                </button>
            )}
        </Row>
    )
}
