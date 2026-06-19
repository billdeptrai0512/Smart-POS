import { ArrowLeft, Copy } from 'lucide-react'
import { formatVND } from '../../utils'
import InlineEditor from './InlineEditor'
import MenuTabsBar from '../common/MenuTabsBar'

export default function RecipeHeader({
    product, canEdit, onBack, onSavePrice, onSaveName, onCopyFrom, onTabSelect,
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
                        <InlineEditor
                            value={product.name}
                            canEdit={canEdit}
                            onSave={onSaveName}
                            type="text"
                            inputWidthClassName="w-full"
                            displayClassName="text-[13px] font-black text-primary uppercase line-clamp-1 break-words w-full px-2"
                            inputClassName="!text-center uppercase"
                            renderDisplay={(v) => <span title={v}>{v}</span>}
                        />
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
                        onClick={onCopyFrom}
                        className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 active:scale-95 transition-all shadow-sm focus:outline-none shrink-0"
                        title="Chép công thức từ món khác"
                    >
                        <Copy size={20} strokeWidth={2.5} />
                    </button>
                )}
            </div>

            {onTabSelect && <MenuTabsBar activeTab="recipes" onSelect={onTabSelect} />}
        </header>
    )
}
