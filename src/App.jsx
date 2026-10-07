import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate, Outlet, useSearchParams, useLocation, useParams } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { AddressProvider, useAddress } from './contexts/AddressContext'
import { AddressStatsProvider } from './contexts/AddressStatsContext'
import { ConfirmProvider } from './contexts/ConfirmContext'
import ErrorBoundary from './components/common/ErrorBoundary'
import './index.css'

// Vùng POS (providers + khung onboarding) nằm trong 1 chunk lazy — xem posShell.jsx. 3 lazy dùng
// chung 1 import() nên chỉ 1 request; ProtectedRoute gọi loadPosShell sớm để chunk về trong lúc
// còn auth/chọn địa chỉ, không thành thêm 1 round-trip trước khi /pos render.
const loadPosShell = () => import('./posShell')
const lazyShell = (name) => lazy(() => loadPosShell().then(m => ({ default: m[name] })))
const ProductProvider = lazyShell('ProductProvider')
const POSProvider = lazyShell('POSProvider')
const OnboardingLayout = lazyShell('OnboardingLayout')

// Pages — lazy-loaded for route-level code splitting
const LoginPage = lazy(() => import('./pages/LoginPage'))
const SignUpPage = lazy(() => import('./pages/SignUpPage'))
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'))

const AddressSelectPage = lazy(() => import('./pages/AddressSelectPage'))
const SubscriptionPage = lazy(() => import('./pages/SubscriptionPage'))
const AdminReconciliationPage = lazy(() => import('./pages/AdminReconciliationPage'))
const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage'))
const POSPage = lazy(() => import('./pages/POSPage'))
const HistoryPage = lazy(() => import('./pages/HistoryPage'))
const RecipeMenuPage = lazy(() => import('./pages/RecipeMenuPage'))
const RecipeIngredientPage = lazy(() => import('./pages/RecipeIngredientPage'))
const DailyReportPage = lazy(() => import('./pages/DailyReportPage'))
const IngredientManagementPage = lazy(() => import('./pages/IngredientManagementPage'))
const IngredientDetailPage = lazy(() => import('./pages/IngredientDetailPage'))
const ToppingsPage = lazy(() => import('./pages/ToppingsPage'))
const ToppingDetailPage = lazy(() => import('./pages/ToppingDetailPage'))
const DiscountProgramsPage = lazy(() => import('./pages/DiscountProgramsPage'))
const DiscountProgramDetailPage = lazy(() => import('./pages/DiscountProgramDetailPage'))

function PageLoading() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-bg px-6 gap-4">
      <div className="w-full max-w-sm space-y-3">
        <div className="animate-pulse bg-surface-light rounded-[16px] h-14 w-full" />
        <div className="animate-pulse bg-surface-light rounded-[16px] h-14 w-full" />
        <div className="animate-pulse bg-surface-light rounded-[16px] h-10 w-3/4 mx-auto" />
      </div>
    </div>
  )
}

// Legacy /range-report entry — folded into /report's range mode. Preserve
// the requested range (and any nav state) by seeding scope on the redirect.
function RangeReportRedirect() {
  const [params] = useSearchParams()
  const { state } = useLocation()
  const scope = params.get('range') === 'month' ? 'month' : 'week'
  return <Navigate to="/report/cashflow" replace state={{ ...state, scope }} />
}

// Trang có tab trên URL (/base/:tab?): thiếu tab hoặc tab lạ → về tab đầu (tabs[0]).
function TabGuard({ base, tabs, children }) {
  const { tab } = useParams()
  const { search, state } = useLocation()
  return tabs.includes(tab) ? children : <Navigate to={{ pathname: `${base}/${tabs[0]}`, search }} replace state={state} />
}

// Capture a ?clone=CODE share link the moment the app loads (before any auth
// redirect can drop it). Stash in sessionStorage so it survives login/signup;
// AddressSelectPage picks it up and pre-fills "Tạo địa chỉ". Then strip the
// param so a refresh doesn't re-trigger.
function CloneCapture() {
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    const code = params.get('clone')
    if (!code) return
    sessionStorage.setItem('pending_clone_code', code.trim().toUpperCase())
    const next = new URLSearchParams(params)
    next.delete('clone')
    setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

// Protected route: allows both authenticated users and active guest sessions
function ProtectedRoute() {
  const { user, isGuest, loading } = useAuth()
  // Chỉ preload khi đã đăng nhập — khách chưa login bị đẩy sang /login không phải tải chunk POS.
  useEffect(() => { if (user || isGuest) loadPosShell() }, [user, isGuest])
  if (loading) return <PageLoading />
  if (!user && !isGuest) return <Navigate to="/login" replace />
  return <Outlet />
}

// Requires a selected address before entering POS pages
function RequireAddress() {
  const { selectedAddress, loading } = useAddress()
  if (loading) return <PageLoading />
  if (!selectedAddress) return <Navigate to="/addresses" replace />
  return <Outlet />
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ConfirmProvider>
        <Suspense fallback={<PageLoading />}>
          <CloneCapture />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignUpPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />

            <Route element={<ProtectedRoute />}>
              <Route element={<AddressProvider />}>
                <Route element={<AddressStatsProvider />}>
                  <Route path="/addresses" element={<AddressSelectPage />} />
                  <Route path="/subscription" element={<SubscriptionPage />} />
                  <Route path="/admin/reconciliation" element={<AdminReconciliationPage />} />
                  <Route path="/admin/dashboard" element={<AdminDashboardPage />} />
                  <Route element={<RequireAddress />}>
                    <Route element={<ProductProvider />}>
                      <Route element={<POSProvider />}>
                        <Route element={<OnboardingLayout />}>
                          <Route path="/pos" element={<POSPage />} />
                          {/* Nhật ký · Báo cáo · Tồn kho · Danh mục: 4 điểm dừng của mũi tên ‹ › (utils/menuSequence.js), mỗi trang 2 tab trên URL */}
                          <Route path="/history/:tab?" element={<TabGuard base="/history" tabs={['sales', 'expense']}><HistoryPage /></TabGuard>} />
                          <Route path="/report/:tab?" element={<TabGuard base="/report" tabs={['cashflow', 'revenue']}><DailyReportPage /></TabGuard>} />
                          {/* Feature-level permission routes (anyone can view, managers can edit) */}
                          <Route path="/inventory/:tab?" element={<TabGuard base="/inventory" tabs={['management', 'stocking']}><IngredientManagementPage /></TabGuard>} />
                          <Route path="/inventory/stocking/:ingredientKey" element={<IngredientDetailPage />} />
                          <Route path="/category/:tab?" element={<TabGuard base="/category" tabs={['overall', 'recipes']}><RecipeMenuPage /></TabGuard>} />
                          <Route path="/category/recipes/:productId" element={<RecipeIngredientPage />} />
                          <Route path="/category/toppings" element={<ToppingsPage />} />
                          <Route path="/category/toppings/:toppingId" element={<ToppingDetailPage />} />
                          <Route path="/category/discounts" element={<DiscountProgramsPage />} />
                          <Route path="/category/discounts/:id" element={<DiscountProgramDetailPage />} />

                          {/* Đường dẫn cũ còn dùng nội bộ */}
                          <Route path="/shift-closing" element={<Navigate to="/inventory/management" replace />} />
                          <Route path="/range-report" element={<RangeReportRedirect />} />
                          <Route path="/expenses" element={<Navigate to="/history/expense" replace />} />
                        </Route>
                      </Route>
                    </Route>
                  </Route>
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/pos" />} />
          </Routes>
        </Suspense>
        </ConfirmProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}
