/**
 * Electron-Hauptskript für `npm run icon` (siehe render-icon.mjs): rendert build/icon.svg offscreen
 * und schreibt build/icon.png (1024 × 1024, transparent).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const svgPath = join(root, 'build', 'icon.svg')
const pngPath = join(root, 'build', 'icon.png')
const SIZE = 1024

// eigenes, temporäres Datenverzeichnis (nicht ~/Library/Application Support/Electron)
const userData = mkdtempSync(join(tmpdir(), 'festbuero-icon-'))
app.setPath('userData', userData)
app.disableHardwareAcceleration()
if (process.platform === 'darwin') app.dock?.hide()
app.on('window-all-closed', () => {
  // nichts tun – Beenden steuert das Skript selbst
})
// erst ganz am Ende aufräumen (Chromium schreibt beim Beenden noch in das Datenverzeichnis)
process.on('exit', () => rmSync(userData, { recursive: true, force: true }))

async function render() {
  const svg = readFileSync(svgPath, 'utf8')
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
    svg { display: block; width: ${SIZE}px; height: ${SIZE}px; }
  </style></head><body>${svg}</body></html>`

  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true }
  })
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  // ein paar Frames abwarten, bis Filter/Schatten gezeichnet sind
  await new Promise((r) => setTimeout(r, 500))
  let image = await win.webContents.capturePage()
  const { width, height } = image.getSize()
  if (width !== SIZE || height !== SIZE) image = image.resize({ width: SIZE, height: SIZE, quality: 'best' })
  writeFileSync(pngPath, image.toPNG())
  console.log(`[icon] ${pngPath} geschrieben (${width}×${height} → ${SIZE}×${SIZE})`)
  win.destroy()
}

// bewusst ohne Top-Level-await: das würde im ESM-Einstieg das „ready“-Ereignis blockieren
app
  .whenReady()
  .then(render)
  .catch((err) => {
    console.error('[icon] Fehler:', err)
    process.exitCode = 1
  })
  .finally(() => app.quit())
