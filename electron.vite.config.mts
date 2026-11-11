import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const root = fileURLToPath(new URL('.', import.meta.url))
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }

/**
 * Ausgabeordner. Standard `out/`. Parallel arbeitende Agents setzen
 * `FESTBUERO_OUT_DIR=out/<bereich>`, damit sich Builds nicht gegenseitig überschreiben
 * (siehe docs/dev-notes.md). Der Main-Prozess lädt Preload/Renderer relativ zu sich selbst.
 */
const outDir = resolve(root, process.env.FESTBUERO_OUT_DIR || 'out')
if (process.env.FESTBUERO_OUT_DIR && !process.env.ELECTRON_ENTRY) {
  // `electron-vite dev` startet sonst package.json#main (out/main/index.js)
  process.env.ELECTRON_ENTRY = resolve(outDir, 'main/index.js')
}

// Manche Umgebungen (z. B. Editor-Terminals) vererben ELECTRON_RUN_AS_NODE=1 – dann würde
// `electron-vite dev/preview` Electron als reines Node starten. Nur Unit-Tests brauchen diese Variable.
delete process.env.ELECTRON_RUN_AS_NODE

const sharedAlias = { '@shared': resolve(root, 'src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: sharedAlias },
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    build: { outDir: resolve(outDir, 'main') }
  },
  preload: {
    resolve: { alias: sharedAlias },
    build: { outDir: resolve(outDir, 'preload') }
  },
  renderer: {
    root: resolve(root, 'src/renderer'),
    resolve: {
      alias: { ...sharedAlias, '@': resolve(root, 'src/renderer/src') }
    },
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    plugins: [react(), tailwindcss()],
    build: {
      outDir: resolve(outDir, 'renderer'),
      rolldownOptions: { input: resolve(root, 'src/renderer/index.html') }
    }
  }
})
