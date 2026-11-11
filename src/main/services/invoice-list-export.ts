/**
 * Excel-Export der Rechnungsliste (Bereich „Liste & Auswertung“, IPC `invoices.exportListExcel`).
 *
 * Ein Blatt „Rechnungen“ mit den Spalten der Liste. Mit `ids` werden nur diese Belege exportiert,
 * in der übergebenen Reihenfolge (= Sortierung der Liste); ohne `ids` alle Belege des Fests.
 */
import { todayIso } from '@shared/dates'
import { getDb, type Db } from '../db/connection'
import { loadEvaluationSource, signedPersons, type EvalInvoice, type EvaluationSource } from './evaluation'
import {
  askXlsxSavePath,
  centsToEuro,
  createWorkbook,
  isoToExcelDate,
  referenceLabel,
  saveWorkbook,
  statusLabel,
  toExcelDateTime,
  writeTable,
  type SheetColumn
} from './evaluation-export'
import type ExcelJS from 'exceljs'

/** Wählt die zu exportierenden Belege aus (Reihenfolge der `ids`, unbekannte IDs werden ignoriert). */
export function selectInvoices(invoices: EvalInvoice[], ids?: number[] | null): EvalInvoice[] {
  if (!ids) return invoices
  const byId = new Map(invoices.map((inv) => [inv.id, inv]))
  const seen = new Set<number>()
  const result: EvalInvoice[] = []
  for (const id of ids) {
    const inv = byId.get(id)
    if (inv && !seen.has(id)) {
      seen.add(id)
      result.push(inv)
    }
  }
  return result
}

export function buildInvoiceListWorkbook(
  source: EvaluationSource,
  ids?: number[] | null,
  now: Date = new Date()
): ExcelJS.Workbook {
  const invoices = selectInvoices(source.invoices, ids)
  const wb = createWorkbook(now)
  wb.title = `Rechnungsliste ${source.festival.name}`
  const ws = wb.addWorksheet('Rechnungen')
  const columns: SheetColumn<EvalInvoice>[] = [
    { header: 'Nummer', width: 13, value: (i) => i.number },
    { header: 'Datum', width: 12, kind: 'date', value: (i) => isoToExcelDate(i.invoiceDate) },
    { header: 'Kunde', width: 32, value: (i) => i.customerLabel },
    { header: 'Personen', width: 10, kind: 'int', value: (i) => i.persons },
    { header: 'Zahlart', width: 13, value: (i) => i.paymentLabel },
    { header: 'Betrag', width: 14, kind: 'euro', value: (i) => centsToEuro(i.totals.grossCents) },
    { header: 'Status', width: 14, value: (i) => statusLabel(i.type, i.status) },
    { header: 'Bezug', width: 24, value: (i) => referenceLabel(i) },
    { header: 'Gedruckt', width: 10, value: (i) => (i.printed ? 'ja' : 'nein') },
    { header: 'Gedruckt am', width: 17, kind: 'datetime', value: (i) => toExcelDateTime(i.printedAt) }
  ]
  writeTable(ws, columns, invoices, { sumColumns: [3, 5] })
  // Personen mit Storno-Gegenrechnung (persons ist beim Storno positiv)
  if (invoices.length > 0) {
    ws.getRow(invoices.length + 2).getCell(4).value = invoices.reduce((sum, inv) => sum + signedPersons(inv), 0)
  }
  return wb
}

export function invoiceListFileName(festivalName: string, filtered: boolean, now: Date = new Date()): string {
  return `Rechnungsliste ${festivalName}${filtered ? ' (Auswahl)' : ''} ${todayIso(now)}.xlsx`
}

/** Schreibt die Rechnungsliste ohne Dialog (Unit-Tests). */
export async function writeInvoiceListExcel(
  festivalId: number,
  filePath: string,
  ids?: number[] | null,
  db: Db = getDb(),
  now: Date = new Date()
): Promise<string> {
  const source = loadEvaluationSource(festivalId, db)
  return saveWorkbook(buildInvoiceListWorkbook(source, ids, now), filePath)
}

/** IPC `invoices.exportListExcel`: Speichern-Dialog → Datei schreiben; null bei Abbruch. */
export async function exportInvoiceListExcel(
  festivalId: number,
  ids?: number[] | null,
  db: Db = getDb()
): Promise<string | null> {
  if (ids !== undefined && ids !== null && (!Array.isArray(ids) || ids.some((id) => !Number.isInteger(id)))) {
    throw new Error('Ungültige Auswahl für den Excel-Export.')
  }
  const source = loadEvaluationSource(festivalId, db)
  const now = new Date()
  const selected = selectInvoices(source.invoices, ids)
  if (selected.length === 0) throw new Error('Es gibt keine Belege zum Exportieren.')
  const filePath = await askXlsxSavePath({
    title: 'Rechnungsliste nach Excel exportieren',
    fileName: invoiceListFileName(source.festival.name, Boolean(ids), now),
    festivalName: source.festival.name,
    db
  })
  if (!filePath) return null
  return saveWorkbook(buildInvoiceListWorkbook(source, ids, now), filePath)
}
