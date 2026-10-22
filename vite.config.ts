import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: './',
  server: {
    host: '0.0.0.0',
    port: 8000,
    strictPort: false,
    allowedHosts: true,
    headers: {
      'Cache-Control': 'no-store'
    },
    hmr: {
      protocol: 'wss',
      clientPort: 443
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 8000,
    allowedHosts: true
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts']
  }
})
