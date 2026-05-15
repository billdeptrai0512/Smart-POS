export default function HistoryFooter({ activeTab, onSelect }) {
    return (
        <div className="shrink-0 bg-surface border-t border-border/60 flex gap-1.5 px-3 py-2">
            <button
                onClick={() => onSelect('orders')}
                className={
                    activeTab === 'orders'
                        ? 'flex-1 flex flex-col items-center justify-center p-2 rounded-[10px] transition-all bg-primary/10 hover:bg-primary/20 border-t-2 border-primary/40'
                        : 'flex-1 flex flex-col items-center justify-center p-2 rounded-[10px] transition-all bg-primary/10 hover:bg-primary/20 border-t-2 border-transparent'
                }
            >
                <span className={`text-[12px] font-black uppercase ${activeTab === 'orders' ? 'text-primary' : 'text-text-secondary'}`}>Thu nhập</span>
            </button>

            <button
                onClick={() => onSelect('expense')}
                className={
                    activeTab === 'expense'
                        ? 'flex-1 flex flex-col items-center justify-center p-2 rounded-[10px] transition-all bg-danger/10 hover:bg-danger/20 border-t-2 border-danger/40'
                        : 'flex-1 flex flex-col items-center justify-center p-2 rounded-[10px] transition-all bg-danger/10 hover:bg-danger/20 border-t-2 border-transparent'
                }
            >
                <span className={`text-[12px] font-black uppercase ${activeTab === 'expense' ? 'text-danger' : 'text-text-secondary'}`}>Chi phí</span>
            </button>

            <button
                onClick={() => onSelect('report')}
                className={
                    activeTab === 'report'
                        ? 'flex-1 flex flex-col items-center justify-center p-2 rounded-[10px] bg-success/10 hover:bg-success/20 transition-all border-t-2 border-success/40'
                        : 'flex-1 flex flex-col items-center justify-center p-2 rounded-[10px] bg-success/10 hover:bg-success/20 transition-all border-t-2 border-transparent'
                }
            >
                <span className={`text-[12px] font-black uppercase ${activeTab === 'report' ? 'text-success' : 'text-text-secondary'}`}>Báo cáo</span>
            </button>
        </div>
    )
}
