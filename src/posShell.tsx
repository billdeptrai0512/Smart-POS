import { Link, Outlet, useLocation } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from './contexts/AuthContext'
import { useProducts } from './contexts/ProductContext'
import { recipeBackUrl } from './utils/recipeBackUrl'
import OnboardingGuide from './components/common/onboarding/OnboardingGuide'
import SubscriptionGuard from './components/common/SubscriptionGuard'
import TopNav from './components/POSPage/TopNav'
import { NAV_ICON_BTN } from './constants/navStyles'

// Gom mọi thứ chỉ vùng POS cần (providers + khung onboarding) vào MỘT chunk để App.tsx lazy-load —
// /login, /signup, /forgot-password khỏi tải orderService/POSContext/ProductContext.
export { ProductProvider } from './contexts/ProductContext'
export { POSProvider } from './contexts/POSContext'

// Mounts the "Bắt đầu bán hàng" onboarding guide once for every page inside
// RequireAddress/ProductProvider, instead of each page wiring it in individually.
export function OnboardingLayout() {
  // /pos tự đặt guide trong Header (dưới thẻ Địa chỉ + Nhật ký, cạnh "Chuẩn bị hôm nay").
  const { pathname, state } = useLocation()
  const { isGuest } = useAuth()
  const onPos = pathname === '/pos'
  const { products, batchProducts, toppings } = useProducts()
  const recipeId = pathname.match(/^\/category\/(?:recipes|toppings)\/([^/]+)$/)?.[1]
  const back = pathname.startsWith('/history') ? (isGuest ? null : { to: '/pos', state: undefined })
    : /^\/inventory\/stocking\/[^/]+$/.test(pathname) ? { to: state?.backTo || '/inventory/stocking', state: state?.backTo ? undefined : state }
    : recipeId ? { to: recipeBackUrl(recipeId, products, batchProducts, toppings), state }
    : pathname === '/category/discounts' ? { to: '/category/overall', state }
    : null
  // Hàng TopNav phải rộng bằng khung của trang bên dưới (mỗi trang tự đặt max-w-lg + trần ở lg): trang chi tiết 4xl, Tổng hợp tồn kho 6xl, còn lại full.
  const lgMax = pathname.split('/').length > 3 ? 'lg:max-w-4xl' : pathname === '/inventory/summary' ? 'lg:max-w-6xl' : 'lg:max-w-none'
  return (
    <div className="flex flex-col h-full">
      <SubscriptionGuard />
      {/* /pos có TopNav riêng trong Header; mọi trang khác dùng chung 1 hàng này (địa chỉ · việc cần làm · menu). */}
      {!onPos && (
        <div className="shrink-0">
          {/* nền surface nằm trên khung đã giới hạn (cùng khung header trang) — để ngoài thì dải nền chạy full màn, lệch với header */}
          <div className={`max-w-lg ${lgMax} mx-auto px-4 lg:px-8 pt-3 bg-surface`}>
            <div className="lg:max-w-[1280px] lg:mx-auto flex items-center gap-2">
              {/* Nút ← bên trái ô địa chỉ: Nhật ký → POS (khách dùng thử đã có ← → của guide ở header trang); chi tiết nguyên liệu → Lưu trữ (hoặc backTo của nơi đã đến). */}
              {back && (
                <Link to={back.to} state={back.state} aria-label="Trở về" className={NAV_ICON_BTN}>
                  <ArrowLeft size={19} />
                </Link>
              )}
              <TopNav />
            </div>
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
