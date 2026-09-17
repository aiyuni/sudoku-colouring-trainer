import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'github-pages-404',
      closeBundle() {
        const index = resolve('dist/index.html')
        if (existsSync(index)) {
          copyFileSync(index, resolve('dist/404.html'))
        }
      },
    },
  ],
  // GitHub Actions sets VITE_BASE to /<repo>/ so assets load on github.io.
  base: process.env.VITE_BASE || '/',
  server: {
    port: 5173,
  },
})
