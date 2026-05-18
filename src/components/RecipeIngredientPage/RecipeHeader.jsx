import { ArrowLeft, Trash2 } from 'lucide-react'
import { formatVND } from '../../utils'
import InlineEditor from './InlineEditor'
import MenuTabsBar from '../common/MenuTabsBar'

export default function RecipeHeader({
    product, canEdit, onBack, onSavePrice, onDeleteFromMenu, onTabSelect,
}) {
    return (
        <header className="shrink-0 pt-6 pb-3 bg-surface border-b border-border/60 shadow-sm relative z-20 flex flex-col px-4 gap-3">
            <div className="flex items-center gap-3">
                <button
                    onClick={onBack}
                    className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none shrink-0"
                    title="Trở về"
                >
                    <ArrowLeft size={20} strokeWidth={2.5} />
                </button>

                <div className="flex flex-row gap-2 flex-1 min-w-0">
                    <div className="flex-1 bg-primary/5 border border-primary/10 shadow-sm rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center min-w-0">
                        <span className="text-[13px] font-black text-primary uppercase line-clamp-1 break-words w-full px-2" title={product.name}>{product.name}</span>
                        <div className="flex items-center justify-center gap-1.5 text-[12px] font-bold text-text-secondary leading-none mt-1 w-full">
                            <span>Giá bán:</span>
                            <InlineEditor
                                value={product.price}
                                canEdit={canEdit}
                                onSave={onSavePrice}
                                type="number"
                                renderDisplay={(v) => <span className="text-success font-bold">{formatVND(v)}</span>}
                                inputWidthClassName="w-[72px]"
                            />
                        </div>
                    </div>
                </div>

                {canEdit && (
                    <button
                        onClick={onDeleteFromMenu}
                        className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-danger/5 border border-danger/20 text-danger/70 hover:text-danger hover:bg-danger/10 transition-colors shadow-sm focus:outline-none shrink-0"
                        title="Xóa món khỏi menu"
                    >
                        <Trash2 size={20} strokeWidth={2.5} />
                    </button>
                )}
            </div>

            {onTabSelect && <MenuTabsBar activeTab="recipes" onSelect={onTabSelect} />}
        </header>
    )
}
