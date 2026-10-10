import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../hooks/useToast'
import Toast from '../components/POSPage/Toast'
import IngredientDetailHeader from '../components/IngredientManagementPage/IngredientDetailHeader'
import MoneyInput from '../components/common/MoneyInput'
import { formatVND, parseVNDInput, capitalizeWords } from '../utils'
import { FormDialog } from '../components/common/ModalShell'
import { insertTopping } from '../services/toppingService'

export default function ToppingsPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const { toppings, refreshProducts } = useProducts()
    const { addressId } = useAddress()
    const { isManager, isAdmin } = useAuth()
    const canEdit = isManager || isAdmin
    const { toast, showToast, showError } = useToast()

    const [showCreate, setShowCreate] = useState(false)
    const [name, setName] = useState('')
    const [price, setPrice] = useState('')
    const [unit, setUnit] = useState('')
    const [saving, setSaving] = useState(false)

    const canSubmit = !!name.trim() && parseVNDInput(price) >= 0 && !saving

    function resetForm() {
        setName(''); setPrice(''); setUnit(''); setShowCreate(false)
    }

    async function handleCreate() {
        if (!canSubmit) return
        setSaving(true)
        try {
            await insertTopping(name.trim(), parseVNDInput(price), addressId, unit.trim() || 'đv')
            await refreshProducts()
            resetForm()
            showToast('Đã tạo topping', 'success')
        } catch (err) {
            showError(err, 'Tạo topping')
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="flex flex-col h-full bg-bg">
            <Toast toast={toast} />

            <IngredientDetailHeader
                title="Topping"
                subtitle={`${toppings.length} loại`}
                onBack={() => navigate('/category/recipes', { state: location.state })}
                onAdd={canEdit ? () => setShowCreate(true) : undefined}
                addTitle="Tạo topping mới"
            />

            <main className="flex-1 overflow-y-auto px-4 py-4 pb-8 space-y-3">
                {toppings.length === 0 && (
                    <p className="text-text-secondary text-[13px] text-center py-8 bg-surface-light/50 rounded-[16px] border border-border/40">
                        Chưa có topping nào (ví dụ: Trân châu, Kem muối...)
                    </p>
                )}

                {toppings.map(t => (
                    <div
                        key={t.id}
                        onClick={() => navigate(`/category/toppings/${t.id}`)}
                        className="bg-surface border border-border/60 rounded-[16px] p-4 flex items-center justify-between gap-2 cursor-pointer transition-all shadow-sm hover:border-text/30 hover:shadow-md active:scale-[0.98]"
                    >
                        <h3 className="font-black text-[15px] text-text">{t.name}</h3>
                        <span className="text-[13px] font-bold text-primary shrink-0">+{formatVND(t.price)}</span>
                    </div>
                ))}

                {showCreate && (
                    <FormDialog title="Tạo topping mới" saving={saving} canSubmit={canSubmit} onClose={resetForm} onConfirm={handleCreate}>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                autoCapitalize="words"
                                placeholder="Tên topping"
                                value={name}
                                onChange={e => setName(capitalizeWords(e.target.value))}
                                className="flex-1 min-w-0 bg-surface-light border border-border/60 rounded-[12px] px-3 py-2.5 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-primary/40 transition-colors"
                            />
                            <MoneyInput
                                value={price}
                                onChange={setPrice}
                                onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
                                placeholder="Giá cộng thêm"
                                className="shrink-0 w-[140px]"
                            />
                        </div>
                        <input
                            type="text"
                            placeholder="Đơn vị tồn kho (VD: ml, phần...)"
                            value={unit}
                            onChange={e => setUnit(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
                            className="bg-surface-light border border-border/60 rounded-[12px] px-3 py-2.5 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-primary/40 transition-colors"
                        />
                    </FormDialog>
                )}
            </main>
        </div>
    )
}
