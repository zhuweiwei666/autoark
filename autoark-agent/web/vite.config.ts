import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/agent/',
  server: { proxy: { '/agent/api': { target: 'http://localhost:3002', rewrite: (p) => p.replace(/^\/agent/, '') } } },
})
