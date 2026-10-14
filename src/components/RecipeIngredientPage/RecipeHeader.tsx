import { CupSoda } from 'lucide-react'
import type { Row } from '../../types/domain'
import { capitalizeWords } from '../../utils'
import EditableEntityHeader from '../common/EditableEntityHeader'
import { ICON_BTN_BASE } from '../common/ModalShell'

interface Props {
    product: Row
    canEdit?: boolean
    onBack: () => void
    onSavePrice: (price: number) => void
    onSaveName: (name: string) => void
    countAsCup: boolean
    onToggleCountAsCup: () => void
    toggleDisabled?: boolean
}

export default function RecipeHeader({
    product, canEdit, onBack, onSavePrice, onSaveName,
    countAsCup, onToggleCountAsCup, toggleDisabled,
}: Props) {
    return (
        <EditableEntityHeader
            name={product.name}
            nameTransform={capitalizeWords}
            canEdit={canEdit}
            onBack={onBack}
            onSaveName={onSaveName}
            price={product.price}
            priceLabel="Giá bán:"
            onSavePrice={onSavePrice}
            action={canEdit && (
                // Bật = món này được cộng vào tổng số ly bán/ngày; tắt = không cộng (vd topping, đồ ăn).
                <button
                    onClick={onToggleCountAsCup}
                    disabled={toggleDisabled}
                    aria-pressed={countAsCup}
                    title={countAsCup ? 'Đang cộng vào tổng số ly bán/ngày — bấm để tắt' : 'Không cộng vào tổng số ly bán/ngày — bấm để bật'}
                    className={`${ICON_BTN_BASE} border active:scale-95 transition-all disabled:opacity-50 ${countAsCup ? 'bg-primary/15 border-primary/40 text-primary' : 'bg-surface-light border-border/60 text-text-dim'}`}
                >
                    <CupSoda size={20} strokeWidth={2.5} />
                </button>
            )}
        />
    )
}
