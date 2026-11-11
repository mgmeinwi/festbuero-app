/**
 * IPC `printing.*`
 *
 * Einfache Version (Bereich „Basis“): listPrinters, getStatus.
 * Zuständig danach: Bereich „Abschluss & Druck“ (ergänzt printTestPage, Dry-Run usw.).
 */
import { getPrinterStatus, listPrinters } from '../services/printing'
import { handle } from './handle'

export function register(): void {
  handle('printing.listPrinters', () => listPrinters())
  handle('printing.getStatus', () => getPrinterStatus())
  // printing.printTestPage → Bereich „Abschluss & Druck“
}
