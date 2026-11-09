import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const target = process.env.MIYIN_SERVER || 'http://localhost:3000'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: { input: { player: 'index.html', admin: 'admin/index.html' } },
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
})
