/**
 * IPC `clubs.*` – Vereinsstamm, Excel-Import, Anmelde-Vorlage.
 * Zuständig: Bereich „Vereine“.
 */
import { dialog } from 'electron'
import { commitImport, previewImport } from '../services/club-import'
import { exportTemplate } from '../services/club-template-export'
import { createClub, deleteClub, listClubs, updateClub } from '../services/clubs'
import { getSettings } from '../services/settings'
import { getMainWindow } from '../window'
import { handle } from './handle'

async function pickImportFile(): Promise<string | null> {
  const win = getMainWindow()
  const options: Electron.OpenDialogOptions = {
    title: 'Vereinsliste importieren',
    buttonLabel: 'Importieren',
    properties: ['openFile'],
    filters: [
      { name: 'Excel-Arbeitsmappe', extensions: ['xlsx', 'xlsm'] },
      { name: 'Alle Dateien', extensions: ['*'] }
    ]
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0] ?? null
}

async function chooseSavePath({ defaultPath }: { defaultPath: string }): Promise<string | null> {
  const win = getMainWindow()
  const options: Electron.SaveDialogOptions = {
    title: 'Anmelde-Vorlage speichern',
    buttonLabel: 'Speichern',
    defaultPath,
    filters: [{ name: 'Excel-Arbeitsmappe', extensions: ['xlsx'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation']
  }
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null
  return result.filePath
}

export function register(): void {
  handle('clubs.list', (festivalId) => listClubs(festivalId))
  handle('clubs.create', (festivalId, input) => createClub(festivalId, input))
  handle('clubs.update', (id, patch) => updateClub(id, patch))
  handle('clubs.delete', (id) => deleteClub(id))
  handle('clubs.pickImportFile', () => pickImportFile())
  handle('clubs.previewImport', (festivalId, filePath) => previewImport(festivalId, filePath))
  handle('clubs.commitImport', (festivalId, filePath) => commitImport(festivalId, filePath))
  handle('clubs.exportTemplate', (festivalId, opts) => {
    let defaultDir: string | null = null
    try {
      defaultDir = getSettings().documentsDir
    } catch {
      defaultDir = null
    }
    return exportTemplate(festivalId, opts, { chooseSavePath, defaultDir })
  })
}
