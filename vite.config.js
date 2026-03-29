import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: true,
    headers: {
      'X-Frame-Options': 'SAMEORIGIN',
    },
  },
})
