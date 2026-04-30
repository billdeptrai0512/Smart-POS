import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'child_process'

const getLatestCommitMessage = () => {
  try {
    return execSync('git log -1 --pretty=%B').toString().trim()
  } catch {
    return 'Bản cập nhật mới giúp cải thiện hiệu suất và trải nghiệm ứng dụng.'
  }
}

// Allow extra dev hosts (e.g. cloudflare tunnel) via VITE_DEV_ALLOWED_HOSTS=host1,host2
const devAllowedHosts = (process.env.VITE_DEV_ALLOWED_HOSTS || '')
  .split(',')
  .map(h => h.trim())
  .filter(Boolean)

export default defineConfig({
  test: {
    environment: 'node',
  },
  define: {
    '__APP_UPDATE_LOG__': JSON.stringify(getLatestCommitMessage()),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'Smart POS - Kôphin Coffee',
        short_name: 'Smart POS',
        description: 'Cà phê ngon mang đi buổi sáng',
        theme_color: '#3E2723',
        background_color: '#3E2723',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Don't cache Auth/Storage/Realtime endpoints — they are stateful and
        // serving stale tokens or websocket frames is worse than failing fast.
        navigateFallbackDenylist: [/^\/api\//, /^\/auth\//],
        runtimeCaching: [
          {
            // Read-heavy REST queries — short TTL so price/recipe updates show up quickly.
            urlPattern: ({ url }) => url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/rest/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-rest-cache',
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 10 * 60 // 10 minutes
              },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      }
    })
  ],
  server: {
    allowedHosts: devAllowedHosts
  }
})
