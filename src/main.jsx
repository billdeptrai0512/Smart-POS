import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import * as Sentry from '@sentry/react'
import App from './App.jsx'
import PWAUpdatePrompt from './components/common/PWAUpdatePrompt.jsx'
import PWAInstallPrompt from './components/common/PWAInstallPrompt.jsx'

// DSN không phải secret (nằm trong bundle client). Chỉ bật ở production để dev/tunnel
// không bắn lỗi giả lên dashboard. tracesSampleRate=0 → chỉ theo dõi lỗi, không tốn
// hạn ngạch performance. release = commit mới nhất (đã có trong vite.config.js).
if (import.meta.env.PROD) {
  Sentry.init({
    dsn: 'https://53998493c765f2153e300936a8e7b9ef@o4511676122988544.ingest.us.sentry.io/4511676137865216',
    tracesSampleRate: 0,
    release: __APP_UPDATE_LOG__,
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
    <PWAUpdatePrompt />
    <PWAInstallPrompt />
    <Analytics />
  </StrictMode>,
)
