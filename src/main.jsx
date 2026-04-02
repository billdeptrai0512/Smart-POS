import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import App from './App.jsx'
import PWAUpdatePrompt from './components/PWAUpdatePrompt.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <PWAUpdatePrompt />
    <Analytics />
  </StrictMode>,
)
