import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { AddressProvider, useAddress } from './contexts/AddressContext'
import { ProductProvider } from './contexts/ProductContext'
import { POSProvider } from './contexts/POSContext'
import ErrorBoundary from './components/common/ErrorBoundary'
import './index.css'

// Pages — lazy-loaded for route-level code splitting
const LoginPage = lazy(() => import('./pages/LoginPage'))
const SignUpPage = lazy(() => import('./pages/SignUpPage'))
const StaffInvitePage = lazy(() => import('./pages/StaffInvitePage'))
const AddressSelectPage = lazy(() => import('./pages/AddressSelectPage'))
const POSPage = lazy(() => import('./pages/POSPage'))
const HistoryPage = lazy(() => import('./pages/HistoryPage'))
const RecipeMenuPage = lazy(() => import('./pages/RecipeMenuPage'))
const RecipeIngredientPage = lazy(() => import('./pages/RecipeIngredientPage'))
const DailyReportPage = lazy(() => import('./pages/DailyReportPage'))
const RangeReportPage = lazy(() => import('./pages/RangeReportPage'))
const ExpensePage = lazy(() => import('./pages/ExpensePage'))
const ShiftClosingPage = lazy(() => import('./pages/ShiftClosingPage'))
const IngredientManagementPage = lazy(() => import('./pages/IngredientManagementPage'))

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

// Protected route: redirects to /login if not authenticated
function ProtectedRoute() {
  const { user, loading } = useAuth()
  if (loading) return <PageLoading />
  if (!user) return <Navigate to="/login" replace />
  return <Outlet />
}

// Requires a selected address before entering POS pages
function RequireAddress() {
  const { selectedAddress, loading } = useAddress()
  if (loading) return <PageLoading />
  if (!selectedAddress) return <Navigate to="/addresses" replace />
  return <Outlet />
}

// Manager-only route guard
function ManagerOnly() {
  const { isManager, isAdmin, loading } = useAuth()
  if (loading) return <PageLoading />
  if (!isManager && !isAdmin) return <Navigate to="/pos" replace />
  return <Outlet />
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignUpPage />} />
            <Route path="/signup/:token" element={<StaffInvitePage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<AddressProvider />}>
                <Route path="/addresses" element={<AddressSelectPage />} />
                <Route element={<RequireAddress />}>
                  <Route element={<ProductProvider />}>
                    <Route element={<POSProvider />}>
                      <Route path="/pos" element={<POSPage />} />
                      <Route path="/history" element={<HistoryPage />} />
                      <Route path="/shift-closing" element={<ShiftClosingPage />} />
                      <Route path="/daily-report" element={<DailyReportPage />} />
                      <Route path="/range-report" element={<RangeReportPage />} />
                      <Route path="/expenses" element={<ExpensePage />} />
                      {/* Feature-level permission routes (anyone can view, managers can edit) */}
                      <Route path="/recipes" element={<RecipeMenuPage />} />
                      <Route path="/recipes/:productId" element={<RecipeIngredientPage />} />
                      <Route path="/ingredients" element={<IngredientManagementPage />} />
                    </Route>
                  </Route>
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/pos" />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </ErrorBoundary>
  )
}
