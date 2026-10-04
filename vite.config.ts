import { statfsSync } from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// WSL mounts the Windows drives over 9p, and inotify does not fire on them —
// not for edits made from WSL tools, and not for edits made by Windows
// editors. Vite watches for changes with chokidar's inotify backend by
// default, so on /mnt/c it sees nothing at all and the dev server never
// reloads. Polling is the one thing that reports changes there. Native
// filesystems keep inotify, which is much cheaper than stat-ing the tree.
// Set VITE_WATCH_POLL=1 (or 0) to override the detection.
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
      // Polling stats every watched file on each tick, and each of those stats
      // is a round trip over 9p. 300ms still feels immediate to edit against
      // without sweeping the tree constantly. Build output is left out since
      // nothing there feeds the module graph.
      interval: 300,
      ignored: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
    }
  : undefined

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { watch },
  test: {
    // The projection, anchor, camera and timeline layers are pure logic and run
    // in node. Individual test files opt into jsdom with a
    // `@vitest-environment jsdom` docblock where they need a DOM.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    // Needed so @testing-library/react registers its automatic cleanup between
    // tests; without it, renders accumulate and queries match stale trees.
    globals: true,
  },
})
