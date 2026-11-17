import { Outlet, useLocation } from 'react-router-dom'
import OnboardingGuide from './components/common/onboarding/OnboardingGuide'
import SubscriptionGuard from './components/common/SubscriptionGuard'
import TopNav from './components/POSPage/TopNav'

// Gom mọi thứ chỉ vùng POS cần (providers + khung onboarding) vào MỘT chunk để App.tsx lazy-load —
// /login, /signup, /forgot-password khỏi tải orderService/POSContext/ProductContext.
export { ProductProvider } from './contexts/ProductContext'
export { POSProvider } from './contexts/POSContext'

// Mounts the "Bắt đầu bán hàng" onboarding guide once for every page inside
// RequireAddress/ProductProvider, instead of each page wiring it in individually.
export function OnboardingLayout() {
  // /pos tự đặt guide trong Header (dưới thẻ Địa chỉ + Nhật ký, cạnh "Chuẩn bị hôm nay").
  const { pathname } = useLocation()
  const onPos = pathname === '/pos'
  // Hàng TopNav phải rộng bằng khung của trang bên dưới (mỗi trang tự đặt max-w-lg + trần ở lg): trang chi tiết 4xl, Tổng hợp tồn kho 6xl, còn lại full.
  const lgMax = pathname.split('/').length > 3 ? 'lg:max-w-4xl' : pathname === '/inventory/summary' ? 'lg:max-w-6xl' : 'lg:max-w-none'
  return (
    <div className="flex flex-col h-full">
      <SubscriptionGuard />
      {/* /pos có TopNav riêng trong Header; mọi trang khác dùng chung 1 hàng này (địa chỉ · việc cần làm · menu). */}
      {!onPos && (
        <div className="shrink-0 bg-surface pt-3">
          <div className={`max-w-lg ${lgMax} mx-auto px-4 lg:px-8`}>
            <div className="lg:max-w-[1280px] lg:mx-auto flex items-center gap-2"><TopNav /></div>
          </div>
        </div>
      )}
      {!onPos && <OnboardingGuide />}
      <div className="flex-1 min-h-0">
        <Outlet />
      </div>
    </div>
  )
}
