/**
 * Main-Prozess: App-Start, Fenster (integrierte Titelleiste), Menü, Datenbank, IPC.
 */
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app, BrowserWindow, dialog, nativeTheme, screen, shell } from 'electron'
import { applyWindowTheme, getWindowColors, TITLEBAR_HEIGHT } from './app-state'
import { closeDatabase, initDatabase } from './db/connection'
import { getDbPath, getUserDataDir, isE2E } from './env'
import { registerAllIpc } from './ipc'
import { runShutdownHooks } from './lifecycle'
import { handleShortcutInput, initMenu, refreshPrinters, scheduleMenuRebuild } from './menu'
import { getSettings } from './services/settings'
import { emitToRenderer, getMainWindow, setMainWindow } from './window'

/* ------------------------------------------------------------------ */
/* App-Datenverzeichnis – MUSS vor app.whenReady() gesetzt werden      */
/* ------------------------------------------------------------------ */

app.setName('Festbüro')
if (process.env.FESTBUERO_USER_DATA) {
  app.setPath('userData', resolve(process.env.FESTBUERO_USER_DATA))
} else if (!app.isPackaged) {
  // Sicherheitsnetz: In Entwicklung nie in das echte App-Datenverzeichnis schreiben.
  const fallback = resolve(process.cwd(), '.devdata', 'default')
  console.warn(`[festbuero] FESTBUERO_USER_DATA nicht gesetzt – verwende ${fallback}`)
  app.setPath('userData', fallback)
}
if (process.platform === 'win32') app.setAppUserModelId('de.festbuero.app')

/* ------------------------------------------------------------------ */
/* Single Instance                                                     */
/* ------------------------------------------------------------------ */

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  // Zweite Instanz: sauber beenden (kein app.exit), die erste Instanz holt ihr Fenster nach vorne.
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = getMainWindow()
    if (win && !isE2E()) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
  void app.whenReady().then(onReady)
}

/* ------------------------------------------------------------------ */
/* Fenster                                                             */
/* ------------------------------------------------------------------ */

const isMac = process.platform === 'darwin'

/** Mindestgröße: auch im Splitscreen (halber Laptop-Bildschirm) bedienbar. */
export const MIN_WINDOW_SIZE = { width: 600, height: 560 } as const
const PREFERRED_WINDOW_SIZE = { width: 1440, height: 900 } as const
/** macOS-Ampel vertikal mittig in der 48 px hohen Kopfleiste (Knöpfe ≈ 14 px hoch). */
const TRAFFIC_LIGHT_POSITION = { x: 18, y: Math.round((TITLEBAR_HEIGHT - 14) / 2) } as const

/** Startgröße: höchstens 1440×900 und nie größer als der Arbeitsbereich des Bildschirms. */
function initialWindowSize(): { width: number; height: number } {
  const { workAreaSize } = screen.getPrimaryDisplay()
  return {
    width: Math.max(MIN_WINDOW_SIZE.width, Math.min(PREFERRED_WINDOW_SIZE.width, workAreaSize.width)),
    height: Math.max(MIN_WINDOW_SIZE.height, Math.min(PREFERRED_WINDOW_SIZE.height, workAreaSize.height))
  }
}

function isAppUrl(url: string): boolean {
  if (process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL)) return true
  return url.startsWith('file://')
}

function sendWindowState(win: BrowserWindow): void {
  if (!win.isDestroyed()) emitToRenderer('window.state', { fullscreen: win.isFullScreen() })
}

function createMainWindow(): BrowserWindow {
  const { width, height } = initialWindowSize()
  const colors = getWindowColors()
  const win = new BrowserWindow({
    width,
    height,
    minWidth: MIN_WINDOW_SIZE.width,
    minHeight: MIN_WINDOW_SIZE.height,
    center: true,
    title: 'Festbüro',
    show: false,
    // Titelleiste in die App-Kopfleiste integriert (macOS: Ampel, Windows/Linux: native Knöpfe als Overlay)
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: TRAFFIC_LIGHT_POSITION }
      : { titleBarOverlay: { color: colors.background, symbolColor: colors.symbol, height: TITLEBAR_HEIGHT } }),
    backgroundColor: colors.background,
    autoHideMenuBar: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      // E2E: keine Drosselung, wenn das Testfenster verdeckt ist (parallele Testläufe)
      backgroundThrottling: !isE2E()
    }
  })
  setMainWindow(win)
  // Windows/Linux: keine klassische Menüleiste – Menü über den Button in der Kopfleiste
  if (!isMac) win.setMenuBarVisibility(false)

  // In E2E-Tests dem Nutzer nicht den Fokus stehlen
  win.once('ready-to-show', () => (isE2E() ? win.showInactive() : win.show()))
  win.on('closed', () => setMainWindow(null))
  win.on('enter-full-screen', () => sendWindowState(win))
  win.on('leave-full-screen', () => sendWindowState(win))
  win.webContents.on('did-finish-load', () => {
    sendWindowState(win)
    void refreshPrinters()
  })

  // Windows/Linux: Menü-Tastenkürzel auch ohne sichtbare Menüleiste (genau einmal)
  win.webContents.on('before-input-event', (event, input) => {
    if (handleShortcutInput(input)) event.preventDefault()
  })

  // Externe Links im Standardbrowser öffnen, keine neuen App-Fenster
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return
    event.preventDefault()
    if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url)
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

function onReady(): void {
  try {
    mkdirSync(getUserDataDir(), { recursive: true })
    initDatabase(getDbPath())
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[festbuero] Datenbank konnte nicht geöffnet werden:', err)
    if (!isE2E()) {
      dialog.showErrorBox('Festbüro – Datenbankfehler', `Die Datenbank konnte nicht geöffnet werden.\n\n${message}`)
    }
    // regulär beenden (kein app.exit – siehe lifecycle.ts)
    app.quit()
    return
  }

  try {
    nativeTheme.themeSource = getSettings().theme
  } catch {
    nativeTheme.themeSource = 'system'
  }
  // Systemwechsel hell/dunkel (bei Theme „System“): Fensterfarben + Menü anpassen
  nativeTheme.on('updated', () => {
    applyWindowTheme()
    scheduleMenuRebuild()
  })

  registerAllIpc()
  initMenu()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
}

app.on('window-all-closed', () => {
  app.quit()
})

// Aufräumen: zuerst Hooks (Timer, Kindprozesse), dann genau einmal die Datenbank schließen.
app.on('before-quit', () => {
  runShutdownHooks()
})

app.on('will-quit', () => {
  runShutdownHooks()
  closeDatabase()
})
