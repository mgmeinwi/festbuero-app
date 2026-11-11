/**
 * IPC `invoices.*`
 *
 * Zuständig: Bereich „Abschluss & Druck“.
 * Noch nicht implementiert: nextNumberPreview, finalize, list, get, ensurePdf, print, printMany, openPdf, exportPdf, exportZip, storno, exportListExcel.
 * Nicht registrierte Kanäle erzeugen im Renderer die Meldung „Funktion noch nicht verfügbar: …“.
 *
 * Muster:
 *   import { handle } from './handle'
 *   handle('invoices.list', (...args) => service.list(...args))
 */

export function register(): void {
  // Handler werden vom Bereich „Abschluss & Druck“ ergänzt.
}
