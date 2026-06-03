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

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', '**/.claude/worktrees/**', '**/dist/**'],
  },
  define: {
    '__APP_UPDATE_LOG__': JSON.stringify(getLatestCommitMessage()),
  },
  build: {
    rollupOptions: {
      output: {
        // Split stable vendor code into named chunks so they stay cache-valid
        // across the frequent app deploys (only app code hash changes).
        // Vite 8 / rolldown requires the function form of manualChunks.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('@supabase')) return 'vendor-supabase'
          if (id.includes('recharts') || id.includes('/d3-') || id.includes('victory-vendor')) return 'vendor-charts'
          if (id.includes('react-router') || id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) return 'vendor-react'
        },
      },
    },
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
    allowedHosts: ["friends-bloggers-share-colors.trycloudflare.com"]
  }
})
