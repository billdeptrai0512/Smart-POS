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
      includeAssets: ['favicon.png', 'icons/*.png'],
      manifest: {
        name: 'KOPOS',
        short_name: 'KOPOS',
        description: 'Vận hành quán nhỏ dễ dàng hơn',
        theme_color: '#00324B',
        background_color: '#00324B',
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
        // iOS splash screens load via <link> tags, not the SW — keep them out of precache.
        globIgnores: ['**/splash/*'],
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
              // 3s (was 5s): on a flaky cafe connection a stuck read falls back to
              // cache faster. The UI no longer waits on these anyway (auth/address/
              // products all hydrate from localStorage first), so this only trims
              // how long background refetches can hang.
              networkTimeoutSeconds: 3,
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
    // Leading dot = allow this domain and ALL subdomains, so each new Cloudflare
    // quick-tunnel (random subdomain) works without editing this every time.
    allowedHosts: [".trycloudflare.com"]
  }
})
