import { basename } from 'node:path'
import { defineConfig } from '@playwright/test'

/**
 * E2E-Tests für die gebaute Electron-App (`npm run test:e2e` baut vorher).
 * Parallel arbeitende Agents setzen `FESTBUERO_OUT_DIR=out/<bereich>` – dann landen Build und
 * Playwright-Artefakte in eigenen Ordnern (siehe docs/dev-notes.md).
 * Screenshots aus `screenshot()` liegen dauerhaft unter `test-results/screenshots/`.
 */
const slot = process.env.FESTBUERO_OUT_DIR ? basename(process.env.FESTBUERO_OUT_DIR) : null

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  outputDir: slot ? `test-results/playwright-${slot}` : 'test-results/playwright',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']]
})
