import { onboardingHintClass } from '../../utils/onboardingHint'

// Tab bar dùng chung cho /inventory (Kiểm kê | Tồn lưu trữ) và /category (Bao quát | Danh mục) —
// danh sách tab nằm ở constants/menuTabs.ts, tab đang chọn nằm trên URL. hintTab: tab onboarding gợi ý bấm.
export interface MenuTab { key: string; label: string }

interface Props { tabs: MenuTab[]; activeTab: string | undefined; onSelect?: (key: string) => void; hintTab?: string | null }

export default function MenuTabsBar({ tabs, activeTab, onSelect, hintTab }: Props) {
    return (
        <div className="bg-surface-light border border-border/50 rounded-[14px] flex p-1 gap-1 shadow-sm">
            {tabs.map(tab => {
                const active = activeTab === tab.key
                return (
                    <button
                        key={tab.key}
                        onClick={() => onSelect?.(tab.key)}
                        className={`flex-1 flex items-center justify-center py-2 rounded-[10px] transition-all duration-200 ${active ? 'bg-primary shadow-sm' : 'hover:bg-border/30'} ${onboardingHintClass(hintTab === tab.key)}`}
                    >
                        <span className={`text-[11px] font-black uppercase tracking-wider transition-colors ${active ? 'text-bg' : 'text-text-secondary'}`}>
                            {tab.label}
                        </span>
                    </button>
                )
            })}
        </div>
    )
}
