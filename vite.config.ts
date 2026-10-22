import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: './',
  server: {
    host: '0.0.0.0',
    port: 8000,
    allowedHosts: true
  },
  preview: {
    host: '0.0.0.0',
    port: 8000
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts']
  }
})
