import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  build: {
    outDir: "backend/dist",
    emptyOutDir: true,
  },

  server: {
    host: true,
    strictPort: true,
    port: 3000,
    proxy: {
      "/api": {
        target: "https://creditnow-prod-266321031136.us-central1.run.app",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});