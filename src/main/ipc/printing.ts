/**
 * IPC `printing.*`
 *
 * Zuständig: Bereich „Abschluss & Druck“ (Basisversion von „Basis“).
 * Startet außerdem die Überwachung des Druckerstatus (alle 30 s und bei Fensterfokus,
 * Änderungen → Event `printing.statusChanged`).
 */
import { getPrinterStatus, listPrinters, printTestPage, startPrinterStatusMonitor } from '../services/printing'
import { handle } from './handle'

export function register(): void {
  handle('printing.listPrinters', () => listPrinters())
  handle('printing.getStatus', () => getPrinterStatus())
  handle('printing.printTestPage', (festivalId, opts) =>
    printTestPage(festivalId, typeof opts?.printer === 'string' && opts.printer.trim() !== '' ? { printer: opts.printer } : {})
  )
  startPrinterStatusMonitor()
}
