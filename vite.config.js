import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Ensure React is always resolved to the single copy in this repo (avoid invalid hook call)
    dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
  },
  optimizeDeps: {
    include: ['sdk-4mica'],
    dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
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
