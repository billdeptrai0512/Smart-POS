import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import App from './App.jsx'
import PWAUpdatePrompt from './components/common/PWAUpdatePrompt.jsx'
import PWAInstallPrompt from './components/common/PWAInstallPrompt.jsx'

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
