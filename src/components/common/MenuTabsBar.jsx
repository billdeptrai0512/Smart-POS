import { onboardingHintClass } from '../../utils/onboardingHint'
import { MENU_TABS } from '../../constants/menuTabs'

// Shared tab bar for the Menu/Ingredients dashboard. Two tabs span
// /recipes (Công thức) and /ingredients (Nguyên liệu, gồm cả bao bì).
// The parent owns active selection: 'recipes' on Recipe pages, 'main' on the Ingredients page.

// hintTab: key của tab đang được onboarding phase 6 "Cài đặt nguyên liệu" gợi ý bấm tiếp — xem
// RecipeMenuPage.jsx/IngredientManagementPage.jsx (hintIngredientsTab) + onboarding/steps.js.
export default function MenuTabsBar({ activeTab, onSelect, hintTab }) {
    return (
        <div className="bg-surface-light border border-border/50 rounded-[14px] flex p-1 gap-1 shadow-sm">
            {MENU_TABS.map(tab => {
                const active = activeTab === tab.key
                const hintClass = onboardingHintClass(hintTab === tab.key)
                return (
                    <button
                        key={tab.key}
                        onClick={() => onSelect?.(tab.key)}
                        className={`flex-1 flex items-center justify-center py-2 rounded-[10px] transition-all duration-200 ${active ? 'bg-primary shadow-sm' : 'hover:bg-border/30'} ${hintClass}`}
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
