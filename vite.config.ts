import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    // The projection, anchor, camera and timeline layers are pure logic and run
    // in node. Individual test files opt into jsdom with a
    // `@vitest-environment jsdom` docblock where they need a DOM.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    // Needed so @testing-library/react registers its automatic cleanup between
    // tests; without it, renders accumulate and queries match stale trees.
    globals: true,
  },
})
