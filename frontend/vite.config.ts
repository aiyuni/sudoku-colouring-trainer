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
  build: {
    rollupOptions: {
      // Two pages from one build: the Classic solver at the site root, and
      // the Variant solver (Killer, Jigsaw) at /variants/ - the same app in
      // its variant mode (src/variants/main.tsx). The dev server serves both
      // too: localhost:5173/ and localhost:5173/variants/.
      input: {
        main: resolve('index.html'),
        variants: resolve('variants/index.html'),
      },
    },
  },
  server: {
    port: 5173,
  },
})
