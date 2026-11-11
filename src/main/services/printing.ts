/**
 * Drucker: Liste und Status.
 *
 * Einfache Version des Bereichs „Basis“. Der Bereich „Abschluss & Druck“ übernimmt diese Datei und
 * ergänzt den eigentlichen Druck (lp / SumatraPDF, Dry-Run, Testseite).
 * WICHTIG: Niemals echte Druckaufträge in Entwicklung/Tests senden (siehe `isPrintDryRun()` in env.ts).
 */
import type { PrinterInfo, PrinterStatus } from '@shared/types'
import { requireMainWindow } from '../window'
import { getSettings } from './settings'

function isDefaultPrinter(options: Record<string, unknown> | undefined): boolean {
  if (!options) return false
  for (const key of ['is-default', 'printer-is-default', 'isDefault']) {
    const value = options[key]
    if (value === true || value === 'true' || value === '1') return true
  }
  return false
}

/** Installierte Drucker über `webContents.getPrintersAsync()` des Hauptfensters. */
export async function listPrinters(): Promise<PrinterInfo[]> {
  const win = requireMainWindow()
  const printers = await win.webContents.getPrintersAsync()
  return printers
    .map((p) => ({
      name: p.name,
      displayName: p.displayName || p.name,
      isDefault: isDefaultPrinter(p.options as Record<string, unknown> | undefined)
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'de'))
}

/** Ist der gespeicherte Standarddrucker verfügbar? */
export async function getPrinterStatus(): Promise<PrinterStatus> {
  const printer = getSettings().defaultPrinter
  if (!printer) return { printer: null, available: false }
  const printers = await listPrinters()
  return { printer, available: printers.some((p) => p.name === printer) }
}
