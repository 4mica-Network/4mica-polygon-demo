import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Keep symlinked deps (sdk-4mica) under node_modules path so Vite prebundles them
    preserveSymlinks: true,
  },
  optimizeDeps: {
    include: ['sdk-4mica'],
  },
  build: {
    commonjsOptions: {
      include: [/sdk-4mica/, /node_modules/],
    },
  },
  server: {
    port: 8000,
  },
})
