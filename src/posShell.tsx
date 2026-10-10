import { Outlet } from 'react-router-dom'
import OnboardingGuide from './components/common/onboarding/OnboardingGuide'
import PrepPinBar from './components/common/PrepPinBar'

// Gom mọi thứ chỉ vùng POS cần (providers + khung onboarding) vào MỘT chunk để App.tsx lazy-load —
// /login, /signup, /forgot-password khỏi tải orderService/POSContext/ProductContext.
export { ProductProvider } from './contexts/ProductContext'
export { POSProvider } from './contexts/POSContext'

// Mounts the "Bắt đầu bán hàng" onboarding guide once for every page inside
// RequireAddress/ProductProvider, instead of each page wiring it in individually.
export function OnboardingLayout() {
  return (
    <div className="flex flex-col h-full">
      <OnboardingGuide />
      <PrepPinBar />
      <div className="flex-1 min-h-0">
        <Outlet />
      </div>
    </div>
  )
}
