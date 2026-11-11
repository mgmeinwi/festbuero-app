import { basename } from 'node:path'
import { defineConfig } from '@playwright/test'

/**
 * Generator für die README-Screenshots (`npm run docs:screenshots`, baut vorher nach `out/docs`).
 * Eigener Testordner `tests/docs`, damit der Generator NICHT bei `npm run test:e2e` mitläuft.
 * Die Bilder landen in `docs/screenshots/` (siehe tests/docs/readme-screenshots.spec.ts).
 */
const slot = process.env.FESTBUERO_OUT_DIR ? basename(process.env.FESTBUERO_OUT_DIR) : 'docs'

export default defineConfig({
  testDir: './tests/docs',
  testMatch: '**/*.spec.ts',
  outputDir: `test-results/playwright-${slot}`,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']]
})
