import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    // The projection and anchor layers are pure string logic — no DOM needed,
    // which keeps the suite fast enough to run on every save.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
