import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// '/' for a root host (Cloudflare Pages); '/hsk-trainer/' for GitHub Pages (set by the deploy workflow).
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      // 'prompt' so an update never reloads mid-review; main.tsx applies it from the Today screen.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'HSK Trainer',
        short_name: 'HSK',
        description: 'Daily 15-minute Mandarin session',
        lang: 'en',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        background_color: '#111317',
        theme_color: '#111317',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell only. Audio (~1,640 files) is downloaded by the app into its own cache
        // (src/audio/offline.ts): an all-or-nothing SW install of that size kept failing.
        globPatterns: ['**/*.{js,css,html,webmanifest,png,svg}'],
        globIgnores: ['audio/**'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    environment: 'node',
    setupFiles: ['fake-indexeddb/auto'],
  },
});
