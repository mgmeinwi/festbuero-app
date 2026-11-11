/**
 * Rendert das App-Icon `build/icon.svg` in `build/icon.png` (1024 × 1024, transparent).
 * electron-builder leitet daraus `.icns` (macOS) und `.ico` (Windows) ab.
 *
 *   npm run icon      (= node scripts/render-icon.mjs)
 *
 * Startet `render-icon.electron.mjs` mit Electron (ohne ELECTRON_RUN_AS_NODE), damit das SVG exakt
 * wie in Chromium gerendert wird: Offscreen-Fenster, kein Dock-Symbol, kein Fokuswechsel.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const electronBinary = createRequire(import.meta.url)('electron')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const script = join(dirname(fileURLToPath(import.meta.url)), 'render-icon.electron.mjs')
const result = spawnSync(electronBinary, [script], { stdio: 'inherit', env, timeout: 60_000, killSignal: 'SIGTERM' })
if (result.error) console.error('[icon] Fehler:', result.error.message)
process.exit(result.status ?? 1)
