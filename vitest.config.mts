import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = fileURLToPath(new URL('.', import.meta.url))

/**
 * Unit-Tests laufen über Electrons Node (`ELECTRON_RUN_AS_NODE=1`, siehe `npm test`),
 * damit better-sqlite3 mit derselben ABI wie in der App geladen wird.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(root, 'src/shared'),
      '@': resolve(root, 'src/renderer/src')
    }
  },
  define: { __APP_VERSION__: JSON.stringify('0.0.0-test') },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'out/**', 'tests/e2e/**'],
    pool: 'forks',
    testTimeout: 15000
  }
})
