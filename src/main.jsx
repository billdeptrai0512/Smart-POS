import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import App from './App.jsx'
import PWAUpdatePrompt from './components/PWAUpdatePrompt.jsx'
import PWAInstallPrompt from './components/PWAInstallPrompt.jsx'

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
