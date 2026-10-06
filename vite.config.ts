import { statfsSync } from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// WSL's 9p mounts never fire inotify, so Vite's default watch backend sees no
// changes there; polling is the only thing that reports them. VITE_WATCH_POLL overrides.
const V9FS_MAGIC = 0x01021997

function needsPolling(): boolean {
  const override = process.env.VITE_WATCH_POLL
  if (override === '1') return true
  if (override === '0') return false
  try {
    return statfsSync(process.cwd()).type === V9FS_MAGIC
  } catch {
    // statfs is not available everywhere; assume a normal filesystem.
    return false
  }
}

const watch = needsPolling()
  ? {
      usePolling: true,
      // 300ms: each poll stats every watched file over 9p, so this is a
      // compromise between immediacy and sweeping. dist feeds nothing.
      interval: 300,
      ignored: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
    }
  : undefined

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { watch },
  test: {
    // Pure-logic suites run in node; DOM-dependent files opt into jsdom with a
    // `@vitest-environment jsdom` docblock.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    // Needed so @testing-library/react registers its automatic cleanup between
    // tests; without it, renders accumulate and queries match stale trees.
    globals: true,
  },
})
