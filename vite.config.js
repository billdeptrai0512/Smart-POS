import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'child_process'

const getLatestCommitMessage = () => {
  try {
    return execSync('git log -1 --pretty=%B').toString().trim()
  } catch (e) {
    return 'Bản cập nhật mới giúp cải thiện hiệu suất và trải nghiệm ứng dụng.'
  }
}

export default defineConfig({
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
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 // 1 hour
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
  server: {
    allowedHosts: [
      'saver-listings-actual-passing.trycloudflare.com'
    ]
  }
})
