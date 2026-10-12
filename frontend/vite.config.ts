import basicSsl from '@vitejs/plugin-basic-ssl'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// The API running in Docker. The browser never calls it directly: this dev
// server forwards /api and /ws to it, so the page and the API share one origin
// (no CORS, simple cookies). See docs/phase-11-web-design.md, section 5.2.
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:3001'

export default defineConfig(({ mode }) => ({
  // `npm run dev:https`: self-signed HTTPS, reachable from a phone on the same
  // Wi-Fi. Browsers only open the camera (QR scanner) on HTTPS or localhost.
  plugins: [react(), tailwindcss(), ...(mode === 'https' ? [basicSsl()] : [])],
  server: {
    host: mode === 'https' ? true : 'localhost',
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/ws': { target: apiTarget, ws: true, changeOrigin: true },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
}))
