import { Outlet, useLocation } from 'react-router-dom'
import OnboardingGuide from './components/common/onboarding/OnboardingGuide'

// Gom mọi thứ chỉ vùng POS cần (providers + khung onboarding) vào MỘT chunk để App.tsx lazy-load —
// /login, /signup, /forgot-password khỏi tải orderService/POSContext/ProductContext.
export { ProductProvider } from './contexts/ProductContext'
export { POSProvider } from './contexts/POSContext'

// Mounts the "Bắt đầu bán hàng" onboarding guide once for every page inside
// RequireAddress/ProductProvider, instead of each page wiring it in individually.
export function OnboardingLayout() {
  // /pos tự đặt guide trong Header (dưới thẻ Địa chỉ + Nhật ký, cạnh "Chuẩn bị hôm nay").
  const onPos = useLocation().pathname === '/pos'
  return (
    <div className="flex flex-col h-full">
      {!onPos && <OnboardingGuide />}
      <div className="flex-1 min-h-0">
        <Outlet />
      </div>
    </div>
  )
}
