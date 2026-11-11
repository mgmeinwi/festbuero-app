/**
 * IPC `invoices.*`
 *
 * Zuständig: Bereich „Abschluss & Druck“.
 * `invoices.exportListExcel` registriert der Bereich „Liste & Auswertung“ selbst (nicht hier).
 */
import { finalizeInvoice, getInvoice, listInvoices, nextNumberPreview } from '../services/finalize'
import { ensureInvoicePdf } from '../services/filing'
import { exportInvoicePdf, exportInvoicesZip, openInvoicePdf } from '../services/invoice-export'
import { printInvoice, printInvoices } from '../services/printing'
import { stornoInvoice } from '../services/storno'
import { handle } from './handle'

/** Nur den Druckernamen aus Renderer-Optionen übernehmen. */
function printerOpts(opts: { printer?: string } | undefined): { printer?: string } {
  return typeof opts?.printer === 'string' && opts.printer.trim() !== '' ? { printer: opts.printer } : {}
}

export function register(): void {
  handle('invoices.nextNumberPreview', (festivalId) => nextNumberPreview(festivalId))
  handle('invoices.finalize', (draft, opts) => finalizeInvoice(draft, printerOpts(opts)))
  handle('invoices.list', (festivalId) => listInvoices(festivalId))
  handle('invoices.get', (id) => getInvoice(id))
  handle('invoices.ensurePdf', (id) => ensureInvoicePdf(id))
  handle('invoices.print', (id, opts) => printInvoice(id, printerOpts(opts)))
  handle('invoices.printMany', (ids, opts) => printInvoices(ids, printerOpts(opts)))
  handle('invoices.openPdf', (id) => openInvoicePdf(id))
  handle('invoices.exportPdf', (id) => exportInvoicePdf(id))
  handle('invoices.exportZip', (ids) => exportInvoicesZip(ids))
  handle('invoices.storno', (id, reason, opts) => stornoInvoice(id, reason, printerOpts(opts)))
}
