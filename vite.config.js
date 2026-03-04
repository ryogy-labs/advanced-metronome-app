import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    headers: {
      'X-Frame-Options': 'SAMEORIGIN',
    },
  },
})
