/**
 * IPC `templates.*` – Rechnungsvorlage. Zuständig: Bereich „Vorlage“.
 * Fachlogik in `services/templates.ts`; der Dateidialog für das Logo liegt hier.
 */
import { dialog, type OpenDialogOptions } from 'electron'
import * as service from '../services/templates'
import { getMainWindow } from '../window'
import { handle } from './handle'

/** Dateiauswahl für das Logo (PNG, JPG, SVG, WebP); null bei Abbruch. */
async function pickLogo(): Promise<string | null> {
  const options: OpenDialogOptions = {
    title: 'Logo auswählen',
    buttonLabel: 'Logo übernehmen',
    properties: ['openFile'],
    filters: [{ name: 'Bilder (PNG, JPG, SVG, WebP)', extensions: service.LOGO_EXTENSIONS }]
  }
  const win = getMainWindow()
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0] ?? null
}

export function register(): void {
  handle('templates.get', (festivalId) => service.getTemplate(festivalId))
  handle('templates.update', (festivalId, config) => service.updateTemplate(festivalId, config))
  handle('templates.pickLogo', () => pickLogo())
  handle('templates.setLogo', (festivalId, sourcePath) => service.setLogo(festivalId, sourcePath))
  handle('templates.getLogoDataUrl', (logoFile) => service.getLogoDataUrl(logoFile))
  handle('templates.resetToDefault', (festivalId) => service.resetTemplate(festivalId))
}
