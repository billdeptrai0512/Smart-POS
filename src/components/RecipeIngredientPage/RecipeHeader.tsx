import { Copy } from 'lucide-react'
import type { Row } from '../../types/domain'
import { capitalizeWords } from '../../utils'
import EditableEntityHeader from '../common/EditableEntityHeader'
import { onboardingHintClass } from '../../utils/onboardingHint'

interface Props {
    product: Row
    canEdit?: boolean
    onBack: () => void
    onSavePrice: (price: number) => void
    onSaveName: (name: string) => void
    onCopyFrom: () => void
    hintBack?: boolean
}

export default function RecipeHeader({
    product, canEdit, onBack, onSavePrice, onSaveName, onCopyFrom, hintBack,
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
            backClassName={onboardingHintClass(hintBack)}
            action={canEdit && (
                <button
                    onClick={onCopyFrom}
                    className="w-10 h-10 flex items-center justify-center rounded-[14px] border border-primary/20 text-primary hover:bg-primary/10 active:scale-95 transition-all shadow-sm focus:outline-none shrink-0"
                    title="Chép công thức từ món khác"
                >
                    <Copy size={20} strokeWidth={2.5} />
                </button>
            )}
        />
    )
}
