/**
 * IPC `app.*`
 *
 * Bereich „Basis“: getInfo, getSettings, updateSettings, pickDirectory, openPath, showItemInFolder,
 * updateMenuState, showAppMenu.
 * Bereich „Setup & Auslieferung“: getDefaultDocumentsDir, createBackup, createSampleFestival;
 * `updateSettings` legt einen neu gesetzten Dokumentenordner bei Bedarf an.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { app, dialog } from 'electron'
import type { AppInfo } from '@shared/types'
import { changeSettings } from '../app-state'
import { getDb } from '../db/connection'
import { getDbPath, getLogosDir, getUserDataDir, isDocsScreenshots, isPrintDryRun } from '../env'
import { popupAppMenu, setMenuState } from '../menu'
import { createBackup, ensureDocumentsDir, resolveDefaultDocumentsDir } from '../services/backup'
import { createSampleFestival, SAMPLE_LOGO_FILE_NAME } from '../services/sample-data'
import { getSettings } from '../services/settings'
import { openPath, showItemInFolder } from '../services/shell'
import { getMainWindow } from '../window'
import { handle } from './handle'

function appVersion(): string {
  return app.isPackaged ? app.getVersion() : __APP_VERSION__
}

export function getAppInfo(): AppInfo {
  const platform = process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux'
  return {
    version: appVersion(),
    platform,
    userDataDir: getUserDataDir(),
    dbPath: getDbPath(),
    isPackaged: app.isPackaged,
    printDryRun: isPrintDryRun(),
    // nur für die README-Screenshots (tests/docs/), sonst nicht gesetzt
    ...(isDocsScreenshots() ? { docsScreenshots: true } : {})
  }
}

/** Vorschlag `<Dokumente>/Festbüro`; in Entwicklung/Tests unter dem isolierten Datenverzeichnis. */
export function getDefaultDocumentsDir(): string {
  let documentsPath: string
  try {
    documentsPath = app.getPath('documents')
  } catch {
    documentsPath = join(homedir(), 'Documents')
  }
  return resolveDefaultDocumentsDir({
    documentsPath,
    userDataDir: getUserDataDir(),
    isolated: !app.isPackaged || !!process.env.FESTBUERO_USER_DATA
  })
}

/**
 * Datei aus `resources/sample/`: paketiert unter `<resources>/sample/` (extraResources),
 * in Entwicklung/Tests im Projektordner.
 */
export function findSampleResource(fileName: string): string | null {
  const candidates = [
    app.isPackaged ? join(process.resourcesPath, 'sample', fileName) : null,
    join(app.getAppPath(), 'resources', 'sample', fileName),
    resolve(__dirname, '../../resources/sample', fileName),
    resolve(__dirname, '../../../resources/sample', fileName),
    resolve(process.cwd(), 'resources', 'sample', fileName)
  ]
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return null
}

export function register(): void {
  handle('app.getInfo', () => getAppInfo())

  handle('app.getSettings', () => getSettings())

  // Theme, Fensterfarben, Menü und Renderer-Benachrichtigung zentral in changeSettings().
  // Ein neu gesetzter Dokumentenordner wird bei Bedarf angelegt (Ersteinrichtung: Vorschlag übernehmen).
  handle('app.updateSettings', (patch) => {
    if (patch && typeof patch.documentsDir === 'string') {
      return changeSettings({ ...patch, documentsDir: ensureDocumentsDir(patch.documentsDir) })
    }
    return changeSettings(patch)
  })

  handle('app.pickDirectory', async (opts) => {
    const win = getMainWindow()
    const options: Electron.OpenDialogOptions = {
      title: opts?.title ?? 'Ordner wählen',
      buttonLabel: 'Auswählen',
      properties: ['openDirectory', 'createDirectory', 'promptToCreate']
    }
    if (opts?.defaultPath) options.defaultPath = opts.defaultPath
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0] ?? null
  })

  handle('app.openPath', (path) => openPath(path))

  handle('app.showItemInFolder', (path) => showItemInFolder(path))

  handle('app.updateMenuState', (state) => setMenuState(state))

  handle('app.showAppMenu', (pos) => popupAppMenu(pos))

  handle('app.getDefaultDocumentsDir', () => getDefaultDocumentsDir())

  handle('app.createBackup', () =>
    createBackup({
      db: getDb(),
      documentsDir: getSettings().documentsDir,
      logosDir: getLogosDir(),
      appVersion: appVersion()
    })
  )

  // Das Menü (Fest-Liste) baut sich nach diesem Kanal automatisch neu auf (menu.ts).
  handle('app.createSampleFestival', () =>
    createSampleFestival({ logosDir: getLogosDir(), logoSource: findSampleResource(SAMPLE_LOGO_FILE_NAME) })
  )
}
