/**
 * IPC `app.*`
 *
 * Implementiert (Bereich „Basis“): getInfo, getSettings, updateSettings, pickDirectory, openPath,
 * showItemInFolder, updateMenuState, showAppMenu.
 * Offen – zuständig Bereich „Setup & Auslieferung“: createBackup, createSampleFestival.
 */
import { app, dialog } from 'electron'
import type { AppInfo } from '@shared/types'
import { changeSettings } from '../app-state'
import { getDbPath, getUserDataDir, isPrintDryRun } from '../env'
import { popupAppMenu, setMenuState } from '../menu'
import { getSettings } from '../services/settings'
import { openPath, showItemInFolder } from '../services/shell'
import { getMainWindow } from '../window'
import { handle } from './handle'

export function getAppInfo(): AppInfo {
  const platform = process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux'
  return {
    version: app.isPackaged ? app.getVersion() : __APP_VERSION__,
    platform,
    userDataDir: getUserDataDir(),
    dbPath: getDbPath(),
    isPackaged: app.isPackaged,
    printDryRun: isPrintDryRun()
  }
}

export function register(): void {
  handle('app.getInfo', () => getAppInfo())

  handle('app.getSettings', () => getSettings())

  // Theme, Fensterfarben, Menü und Renderer-Benachrichtigung zentral in changeSettings()
  handle('app.updateSettings', (patch) => changeSettings(patch))

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

  // app.createBackup, app.createSampleFestival → Bereich „Setup & Auslieferung“
}
