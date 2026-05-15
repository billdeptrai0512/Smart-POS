export default function ShiftClosingFooter({ activeTab, onSelect }) {
    return (
        <div className="shrink-0 bg-surface border-t border-border/60 flex gap-1.5 px-3 py-2">
            <button
                onClick={() => onSelect('inventory')}
                className={
                    activeTab === 'inventory'
                        ? 'flex-1 flex flex-col items-center justify-center p-2 rounded-[10px] transition-all bg-primary/10 hover:bg-primary/20 border-t-2 border-primary/40'
                        : 'flex-1 flex flex-col items-center justify-center p-2 rounded-[10px] transition-all bg-primary/10 hover:bg-primary/20 border-t-2 border-transparent'
                }
            >
                <span className={`text-[12px] font-black uppercase ${activeTab === 'inventory' ? 'text-primary' : 'text-text-secondary'}`}>Tồn kho</span>
            </button>

            <button
                onClick={() => onSelect('revenue')}
                className={
                    activeTab === 'revenue'
                        ? 'flex-1 flex flex-col items-center justify-center p-2 rounded-[10px] transition-all bg-success/10 hover:bg-success/20 border-t-2 border-success/40'
                        : 'flex-1 flex flex-col items-center justify-center p-2 rounded-[10px] transition-all bg-success/10 hover:bg-success/20 border-t-2 border-transparent'
                }
            >
                <span className={`text-[12px] font-black uppercase ${activeTab === 'revenue' ? 'text-success' : 'text-text-secondary'}`}>Thực thu</span>
            </button>

            <button
                onClick={() => onSelect('note')}
                className={
                    activeTab === 'note'
                        ? 'flex-1 flex flex-col items-center justify-center p-2 rounded-[10px] transition-all bg-warning/10 hover:bg-warning/20 border-t-2 border-warning/40'
                        : 'flex-1 flex flex-col items-center justify-center p-2 rounded-[10px] transition-all bg-warning/10 hover:bg-warning/20 border-t-2 border-transparent'
                }
            >
                <span className={`text-[12px] font-black uppercase ${activeTab === 'note' ? 'text-warning' : 'text-text-secondary'}`}>Ghi chú</span>
            </button>
        </div>
    )
}
