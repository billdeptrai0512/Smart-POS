import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { Capacitor } from '@capacitor/core'
import App from './App'
import PWAUpdatePrompt from './components/common/PWAUpdatePrompt'
import PWAInstallPrompt from './components/common/PWAInstallPrompt'
import { reloadForNewVersion } from './utils/staleChunk'

// Vite bắn event này khi import() chunk lỗi (chunk cũ đã bị deploy mới xoá) — tải lại bản mới
// thay vì để ErrorBoundary hiện màn lỗi. preventDefault để không ném lỗi nữa nếu đang reload.
window.addEventListener('vite:preloadError', (e) => {
  if (reloadForNewVersion()) e.preventDefault()
})

// App native (Capacitor) không cần service worker/banner cài PWA/Analytics web —
// 3 thứ này chỉ có ý nghĩa khi chạy trong trình duyệt.
const isNative = Capacitor.isNativePlatform()

// Preload sớm 2 chunk chỉ dùng lúc in bill native (html2canvas + plugin ESC/POS,
// xem escposBitmap.ts) — nếu đợi tới lúc bấm "In bill" mới import lần đầu thì lần
// in ĐẦU TIÊN của phiên phải cộng thêm thời gian tải+parse chunk vào độ trễ in
// thật. Không await, không chặn render — chạy nền lúc mở app, sẵn trong cache
// module của trình duyệt trước khi người dùng kịp bấm.
if (isNative) {
  import('html2canvas')
  import('@albgen/capacitor-escpos-plugin')
}

// DSN không phải secret (nằm trong bundle client). Chỉ bật ở production để dev/tunnel
// không bắn lỗi giả lên dashboard. tracesSampleRate=0 → chỉ theo dõi lỗi, không tốn
// hạn ngạch performance. release = commit mới nhất (đã có trong vite.config.js).
// Dynamic import: @sentry/react không nhỏ, và trước đây import tĩnh khiến nó luôn
// nằm trong bundle đầu tiên (kể cả /pos, trang load đầu khi mở app trên điện thoại).
// Không await — không cần chặn render để chờ monitoring SDK tải xong.
if (import.meta.env.PROD) {
  import('@sentry/react').then((Sentry) => {
    Sentry.init({
      dsn: 'https://53998493c765f2153e300936a8e7b9ef@o4511676122988544.ingest.us.sentry.io/4511676137865216',
      tracesSampleRate: 0,
      release: __APP_UPDATE_LOG__,
      // ponytail: chặn noise không phải lỗi app — script Zalo in-app browser tiêm vào trang,
      // và cơ chế tự phục hồi lock đa-tab của Supabase auth (không ảnh hưởng đăng nhập),
      // và script iabjs:// của in-app browser Facebook/Instagram (postMessage sang Java)
      ignoreErrors: [
        'isReCreate is not defined',
        'zaloJSV2 is not defined',
        'Lock was stolen by another request',
        'Java exception was raised during method invocation',
      ],
      denyUrls: [/^iabjs:\/\//],
    })
  })
}

// Router dữ liệu chỉ để có View Transitions (crossfade trang cũ → mới, CSS ở index.css).
// Một route splat render nguyên <App /> nên <Routes> trong App.tsx giữ nguyên.
const router = createBrowserRouter([{
  path: '*',
  element: (
    <>
      <App />
      {/* Trong Router vì banner chỉ được phép hiện ở /login (xem PWAInstallPrompt) —
          nhưng vẫn mount toàn cục để không bỏ lỡ event beforeinstallprompt, thứ chỉ
          bắn 1 lần ngay sau khi tải trang. */}
      {!isNative && <PWAInstallPrompt />}
    </>
  ),
}])

// ponytail: bật viewTransition tại MỘT điểm thay vì sửa ~50 lời gọi navigate(). Phải vá ở đây vì
// trong <Routes> lồng, useNavigate/<Link> đi qua navigator.push — thứ làm rơi option viewTransition.
// Nút lùi/tiến của trình duyệt tự crossfade theo (router nhớ cặp trang đã chuyển cảnh).
// Chỉ khi đổi pathname (đổi query như ?date= thì không), và không khi đang có chuyển cảnh —
// tức là lần chuyển hướng của TabGuard/<Navigate> ngay sau đó, tránh chuyển cảnh kép.
const baseNavigate = router.navigate
router.navigate = ((to: Parameters<typeof baseNavigate>[0], opts?: object) => {
  const path = typeof to === 'string' ? to.split(/[?#]/)[0] : to && typeof to === 'object' ? to.pathname : undefined
  let busy = false
  try { busy = document.documentElement.matches(':active-view-transition') } catch { /* trình duyệt cũ không có selector này */ }
  const viewTransition = !!path && path !== router.state.location.pathname && !busy
  return baseNavigate(to as string, { viewTransition, ...opts })
}) as typeof baseNavigate

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
    {/* Not rendered at all (not just hidden) khi native — useRegisterSW bên trong
        PWAUpdatePrompt tự đăng ký service worker ngay lúc component được gọi, nên
        early-return bên trong nó vẫn không tránh được side effect này. */}
    {!isNative && <PWAUpdatePrompt />}
    {!isNative && <Analytics />}
  </StrictMode>,
)
