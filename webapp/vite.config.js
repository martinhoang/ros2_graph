import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname),
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:5000',
        ws: true,
        changeOrigin: true,
      }
    },
    fs: {
      // Allow serving files from anywhere (needed for symlinks)
      strict: false,
      allow: ['/']
    }
  },
  resolve: {
    // Preserve symlinks to allow proper resolution
    preserveSymlinks: false
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          regl: ['regl'],
          deckgl: ['@deck.gl/core', '@deck.gl/layers'],
        }
      }
    }
  }
})
