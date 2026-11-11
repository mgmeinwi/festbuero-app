/**
 * Excel-Export der Auswertung (Bereich „Liste & Auswertung“).
 *
 * Blätter laut Spezifikation: Übersicht, Rechnungen, Positionen, Produkte, Steuer, Zahlarten, Vereine.
 * Beträge sind echte Zahlen (Euro = Cent / 100) mit Währungsformat, Daten echte Excel-Daten
 * (TT.MM.JJJJ). Kopfzeilen fett und fixiert, Autofilter, passende Spaltenbreiten.
 *
 * `writeEvaluationExcel()` schreibt ohne Dialog (Unit-Tests), `exportEvaluationExcel()` fragt vorher
 * mit dem Speichern-Dialog nach dem Ziel.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import ExcelJS from 'exceljs'
import { todayIso } from '@shared/dates'
import { sanitizeFileName, sanitizeFolderName } from '@shared/filename'
import type { InvoiceStatus, InvoiceType } from '@shared/types'
import { getDb, type Db } from '../db/connection'
import {
  buildClubReport,
  computeEvaluation,
  loadEvaluationSource,
  openTransfers,
  summarizePayments,
  type EvalInvoice,
  type EvaluationSource
} from './evaluation'

/* ------------------------------------------------------------------ */
/* Gemeinsame Excel-Helfer (auch für den Export der Rechnungsliste)    */
/* ------------------------------------------------------------------ */

export const EURO_FORMAT = '#,##0.00 "€"'
export const DATE_FORMAT = 'dd.mm.yyyy'
export const DATETIME_FORMAT = 'dd.mm.yyyy hh:mm'
export const INT_FORMAT = '#,##0'
export const PERCENT_FORMAT = '0" %"'

export type ColumnKind = 'text' | 'euro' | 'date' | 'datetime' | 'int' | 'percent'

export interface SheetColumn<R> {
  header: string
  width: number
  kind?: ColumnKind
  value: (row: R) => string | number | Date | null | undefined
}

/** Cent → Euro als Zahl (für Excel). */
export function centsToEuro(cents: number | null | undefined): number | null {
  if (cents === null || cents === undefined) return null
  const euro = cents / 100
  return euro === 0 ? 0 : euro
}

/** ISO-Datum `YYYY-MM-DD` → Excel-Datum (UTC-Mitternacht, damit kein Zeitzonenversatz entsteht). */
export function isoToExcelDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!m) return null
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
}

/** Zeitpunkt → Excel-Datum mit Uhrzeit in lokaler Zeit (Excel kennt keine Zeitzonen). */
export function toExcelDateTime(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return null
  return new Date(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds())
  )
}

const NUM_FORMATS: Partial<Record<ColumnKind, string>> = {
  euro: EURO_FORMAT,
  date: DATE_FORMAT,
  datetime: DATETIME_FORMAT,
  int: INT_FORMAT,
  percent: PERCENT_FORMAT
}

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EDF3' } }
const THIN_BORDER: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FF9AA6B2' } }

/** Formatiert eine Kopfzeile: fett, hinterlegt, unten Linie. */
export function styleHeaderRow(row: ExcelJS.Row): void {
  row.font = { bold: true }
  row.alignment = { vertical: 'middle' }
  row.height = 20
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL
    cell.border = { bottom: THIN_BORDER }
  })
}

function applyFormats<R>(row: ExcelJS.Row, columns: SheetColumn<R>[]): void {
  columns.forEach((col, idx) => {
    const fmt = col.kind ? NUM_FORMATS[col.kind] : undefined
    const cell = row.getCell(idx + 1)
    if (fmt) cell.numFmt = fmt
    if (col.kind && col.kind !== 'text') cell.alignment = { horizontal: 'right' }
  })
}

function cellValue(value: string | number | Date | null | undefined): ExcelJS.CellValue {
  if (value === undefined || value === null) return null
  return value
}

export interface TableOptions<R> {
  /** Zeile unter der Tabelle (z. B. Summe), fett, nicht im Autofilter */
  totalRow?: Partial<Record<number, string | number | null>> & { label?: string }
  /** erste Zeile der Tabelle (Standard 1) */
  startRow?: number
  /** Kopfzeile fixieren (Standard true; nur wenn die Tabelle in Zeile 1 beginnt) */
  freeze?: boolean
  /** Spalten mit Summe in der Summenzeile (Index ab 0) */
  sumColumns?: number[]
  rowsForSum?: R[]
}

/**
 * Schreibt eine Tabelle (Kopfzeile + Zeilen) in ein Blatt. Liefert die Nummer der letzten
 * belegten Zeile.
 */
export function writeTable<R>(
  ws: ExcelJS.Worksheet,
  columns: SheetColumn<R>[],
  rows: R[],
  opts: TableOptions<R> = {}
): number {
  const start = opts.startRow ?? 1
  columns.forEach((col, idx) => {
    const column = ws.getColumn(idx + 1)
    column.width = Math.max(column.width ?? 0, col.width)
  })
  const header = ws.getRow(start)
  header.values = columns.map((c) => c.header)
  styleHeaderRow(header)

  rows.forEach((r, i) => {
    const row = ws.getRow(start + 1 + i)
    row.values = columns.map((c) => cellValue(c.value(r)))
    applyFormats(row, columns)
  })
  const lastDataRow = start + rows.length
  ws.autoFilter = {
    from: { row: start, column: 1 },
    to: { row: Math.max(lastDataRow, start), column: columns.length }
  }
  if ((opts.freeze ?? true) && start === 1) {
    ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 0, topLeftCell: 'A2', activeCell: 'A2' }]
  }

  let last = lastDataRow
  if (opts.sumColumns && opts.sumColumns.length > 0) {
    const totalRow = ws.getRow(lastDataRow + 1)
    const values: ExcelJS.CellValue[] = columns.map(() => null)
    values[0] = opts.totalRow?.label ?? 'Summe'
    for (const idx of opts.sumColumns) {
      const col = columns[idx]
      if (!col) continue
      let sum = 0
      for (const r of opts.rowsForSum ?? rows) {
        const v = col.value(r)
        if (typeof v === 'number') sum += v
      }
      values[idx] = Math.round(sum * 100) / 100
    }
    totalRow.values = values
    applyFormats(totalRow, columns)
    totalRow.font = { bold: true }
    totalRow.eachCell((cell) => {
      cell.border = { top: THIN_BORDER }
    })
    last = lastDataRow + 1
  }
  return last
}

/** Neue Arbeitsmappe mit Metadaten. */
export function createWorkbook(now: Date = new Date()): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Festbüro'
  wb.lastModifiedBy = 'Festbüro'
  wb.created = now
  wb.modified = now
  return wb
}

/** Schreibt die Arbeitsmappe (legt den Zielordner bei Bedarf an) und liefert den Pfad. */
export async function saveWorkbook(wb: ExcelJS.Workbook, filePath: string): Promise<string> {
  const target = filePath.toLowerCase().endsWith('.xlsx') ? filePath : `${filePath}.xlsx`
  mkdirSync(dirname(target), { recursive: true })
  try {
    await wb.xlsx.writeFile(target)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
      throw new Error('Die Excel-Datei konnte nicht gespeichert werden. Ist sie noch in Excel geöffnet?')
    }
    throw new Error(`Die Excel-Datei konnte nicht gespeichert werden: ${(err as Error).message}`)
  }
  return target
}

/**
 * Speichern-Dialog für eine .xlsx-Datei. Vorschlag: `<Dokumentenordner>/<Festname>/<Dateiname>`.
 * Liefert null bei Abbruch.
 */
export async function askXlsxSavePath(opts: {
  title: string
  fileName: string
  festivalName?: string
  db?: Db
}): Promise<string | null> {
  const { app, dialog } = await import('electron')
  const { getMainWindow } = await import('../window')
  const { getSettings } = await import('./settings')
  let baseDir: string
  try {
    baseDir = getSettings(opts.db ?? getDb()).documentsDir ?? app.getPath('documents')
  } catch {
    baseDir = app.getPath('documents')
  }
  if (opts.festivalName) {
    const festDir = join(baseDir, sanitizeFolderName(opts.festivalName))
    if (existsSync(festDir)) baseDir = festDir
  }
  const options: Electron.SaveDialogOptions = {
    title: opts.title,
    buttonLabel: 'Speichern',
    defaultPath: join(baseDir, sanitizeFileName(opts.fileName)),
    filters: [{ name: 'Excel-Arbeitsmappe', extensions: ['xlsx'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation']
  }
  const win = getMainWindow()
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null
  return result.filePath
}

/* ------------------------------------------------------------------ */
/* Texte                                                               */
/* ------------------------------------------------------------------ */

export function typeLabel(type: InvoiceType): string {
  return type === 'storno' ? 'Storno' : 'Rechnung'
}

/** Status wie in der Liste: abgeschlossen / storniert / Storno. */
export function statusLabel(type: InvoiceType, status: InvoiceStatus): string {
  if (type === 'storno') return 'Storno'
  return status === 'storniert' ? 'storniert' : 'abgeschlossen'
}

/** Bezug: „zu Nr. …“ (Storno) bzw. „storniert durch Nr. …“ (stornierte Rechnung). */
export function referenceLabel(inv: { type: InvoiceType; originalNumber: string | null; stornoNumber: string | null }): string {
  if (inv.type === 'storno' && inv.originalNumber) return `zu Nr. ${inv.originalNumber}`
  if (inv.stornoNumber) return `storniert durch Nr. ${inv.stornoNumber}`
  return ''
}

const yesNo = (value: boolean): string => (value ? 'ja' : 'nein')

function rateValue(inv: EvalInvoice, rate: 7 | 19, field: 'grossCents' | 'netCents' | 'vatCents'): number | null {
  const b = inv.effectiveTotals.byRate.find((x) => x.rate === rate)
  return centsToEuro(b ? b[field] : 0)
}

/* ------------------------------------------------------------------ */
/* Arbeitsmappe der Auswertung                                         */
/* ------------------------------------------------------------------ */

export function buildEvaluationWorkbook(source: EvaluationSource, now: Date = new Date()): ExcelJS.Workbook {
  const evaluation = computeEvaluation(source)
  const { festival, invoices } = source
  const wb = createWorkbook(now)
  wb.title = `Auswertung ${festival.name}`

  /* Übersicht ------------------------------------------------------- */
  const transfersOpen = openTransfers(invoices)
  const overview = wb.addWorksheet('Übersicht')
  overview.getColumn(1).width = 34
  overview.getColumn(2).width = 22
  overview.getCell('A1').value = `Auswertung ${festival.name}`
  overview.getCell('A1').font = { bold: true, size: 14 }
  const info: Array<[string, ExcelJS.CellValue, string?]> = [
    ['Gründungsfest', festival.name],
    ['Festdatum', isoToExcelDate(festival.festivalDate), DATE_FORMAT],
    ['Exportiert am', toExcelDateTime(now), DATETIME_FORMAT],
    ['Steuerbefreiung', yesNo(festival.taxExempt)]
  ]
  info.forEach(([label, value, fmt], i) => {
    const row = overview.getRow(3 + i)
    row.getCell(1).value = label
    row.getCell(1).font = { bold: true }
    row.getCell(2).value = value
    if (fmt) row.getCell(2).numFmt = fmt
    row.getCell(2).alignment = { horizontal: 'left' }
  })
  const kpiStart = 3 + info.length + 1
  const kpiHeader = overview.getRow(kpiStart)
  kpiHeader.values = ['Kennzahl', 'Wert']
  styleHeaderRow(kpiHeader)
  const kpis: Array<[string, number, string]> = [
    ['Anzahl Rechnungen (inkl. stornierter)', evaluation.invoiceCount, INT_FORMAT],
    ['Anzahl Stornos', evaluation.stornoCount, INT_FORMAT],
    ['Gesamtumsatz (Stornos gegengerechnet)', centsToEuro(evaluation.totalGrossCents) ?? 0, EURO_FORMAT],
    ['davon bar', centsToEuro(evaluation.cashCents) ?? 0, EURO_FORMAT],
    ['davon per Überweisung', centsToEuro(evaluation.transferCents) ?? 0, EURO_FORMAT],
    ['Anzahl Personen', evaluation.persons, INT_FORMAT],
    ['Offene Überweisungen (Anzahl)', transfersOpen.length, INT_FORMAT],
    [
      'Offene Überweisungen (Summe)',
      centsToEuro(transfersOpen.reduce((s, inv) => s + inv.totals.grossCents, 0)) ?? 0,
      EURO_FORMAT
    ],
    ['Vereine ohne Rechnung', evaluation.clubsWithoutInvoice.length, INT_FORMAT]
  ]
  kpis.forEach(([label, value, fmt], i) => {
    const row = overview.getRow(kpiStart + 1 + i)
    row.getCell(1).value = label
    row.getCell(2).value = value
    row.getCell(2).numFmt = fmt
  })

  /* Rechnungen ------------------------------------------------------ */
  const invoiceSheet = wb.addWorksheet('Rechnungen')
  const invoiceColumns: SheetColumn<EvalInvoice>[] = [
    { header: 'Nummer', width: 13, value: (i) => i.number },
    { header: 'Typ', width: 10, value: (i) => typeLabel(i.type) },
    { header: 'Status', width: 14, value: (i) => statusLabel(i.type, i.status) },
    { header: 'Bezug', width: 24, value: (i) => referenceLabel(i) },
    { header: 'Storno-Grund', width: 28, value: (i) => i.stornoReason ?? '' },
    { header: 'Rechnungsdatum', width: 15, kind: 'date', value: (i) => isoToExcelDate(i.invoiceDate) },
    { header: 'Leistungsdatum', width: 15, kind: 'date', value: (i) => isoToExcelDate(i.serviceDate) },
    { header: 'Fälligkeitsdatum', width: 16, kind: 'date', value: (i) => isoToExcelDate(i.dueDate) },
    { header: 'Kundenart', width: 11, value: (i) => (i.customer.kind === 'verein' ? 'Verein' : 'Einzel') },
    { header: 'Kunde', width: 28, value: (i) => i.customerLabel },
    { header: 'Verein', width: 26, value: (i) => i.customer.clubName },
    { header: 'Name', width: 22, value: (i) => i.customer.contactName },
    { header: 'Straße', width: 22, value: (i) => i.customer.street },
    { header: 'PLZ', width: 8, value: (i) => i.customer.zip },
    { header: 'Ort', width: 18, value: (i) => i.customer.city },
    { header: 'Angemeldete Personen', width: 12, kind: 'int', value: (i) => i.customer.registeredPersons },
    { header: 'Personen', width: 10, kind: 'int', value: (i) => i.persons },
    { header: 'Zahlart', width: 13, value: (i) => i.paymentLabel },
    { header: 'Zahlungsfrist (Tage)', width: 11, kind: 'int', value: (i) => i.dueDays },
    { header: 'Steuerbefreit', width: 12, value: (i) => yesNo(i.taxExempt) },
    { header: 'Netto', width: 13, kind: 'euro', value: (i) => centsToEuro(i.effectiveTotals.netCents) },
    { header: 'MwSt', width: 12, kind: 'euro', value: (i) => centsToEuro(i.effectiveTotals.vatCents) },
    { header: 'Brutto', width: 13, kind: 'euro', value: (i) => centsToEuro(i.totals.grossCents) },
    { header: 'Brutto 7 %', width: 12, kind: 'euro', value: (i) => rateValue(i, 7, 'grossCents') },
    { header: 'Netto 7 %', width: 12, kind: 'euro', value: (i) => rateValue(i, 7, 'netCents') },
    { header: 'MwSt 7 %', width: 11, kind: 'euro', value: (i) => rateValue(i, 7, 'vatCents') },
    { header: 'Brutto 19 %', width: 12, kind: 'euro', value: (i) => rateValue(i, 19, 'grossCents') },
    { header: 'Netto 19 %', width: 12, kind: 'euro', value: (i) => rateValue(i, 19, 'netCents') },
    { header: 'MwSt 19 %', width: 11, kind: 'euro', value: (i) => rateValue(i, 19, 'vatCents') },
    { header: 'Gedruckt', width: 10, value: (i) => yesNo(i.printed) },
    { header: 'Gedruckt am', width: 17, kind: 'datetime', value: (i) => toExcelDateTime(i.printedAt) },
    { header: 'Druckfehler', width: 24, value: (i) => i.printError ?? '' },
    { header: 'PDF vorhanden', width: 9, value: (i) => yesNo(Boolean(i.pdfPath)) },
    { header: 'PDF-Pfad', width: 40, value: (i) => i.pdfPath ?? '' },
    { header: 'Erstellt am', width: 17, kind: 'datetime', value: (i) => toExcelDateTime(i.createdAt) }
  ]
  writeTable(invoiceSheet, invoiceColumns, invoices, {
    sumColumns: [16, 20, 21, 22, 23, 24, 25, 26, 27, 28],
    rowsForSum: invoices
  })
  // Personen-Summe mit Storno-Gegenrechnung (persons ist beim Storno positiv)
  if (invoices.length > 0) invoiceSheet.getRow(invoices.length + 2).getCell(17).value = evaluation.persons

  /* Positionen ------------------------------------------------------ */
  interface PositionRow {
    inv: EvalInvoice
    line: EvalInvoice['lines'][number]
  }
  const positions: PositionRow[] = []
  for (const inv of invoices) {
    for (const line of inv.lines) {
      if (line.quantity === 0 && line.lineTotalCents === 0) continue
      positions.push({ inv, line })
    }
  }
  const positionSheet = wb.addWorksheet('Positionen')
  const positionColumns: SheetColumn<PositionRow>[] = [
    { header: 'Rechnungsnummer', width: 16, value: (p) => p.inv.number },
    { header: 'Typ', width: 10, value: (p) => typeLabel(p.inv.type) },
    { header: 'Status', width: 14, value: (p) => statusLabel(p.inv.type, p.inv.status) },
    { header: 'Datum', width: 12, kind: 'date', value: (p) => isoToExcelDate(p.inv.invoiceDate) },
    { header: 'Kunde', width: 28, value: (p) => p.inv.customerLabel },
    { header: 'Zahlart', width: 13, value: (p) => p.inv.paymentLabel },
    { header: 'Pos.', width: 6, kind: 'int', value: (p) => p.line.position },
    { header: 'Bezeichnung', width: 30, value: (p) => p.line.name },
    { header: 'Zusatzposition', width: 13, value: (p) => yesNo(p.line.productId === null) },
    { header: 'MwSt-Satz', width: 10, kind: 'percent', value: (p) => p.line.vatRate },
    { header: 'Einzelpreis', width: 12, kind: 'euro', value: (p) => centsToEuro(p.line.priceCents) },
    { header: 'Menge', width: 9, kind: 'int', value: (p) => p.line.quantity },
    { header: 'Summe', width: 13, kind: 'euro', value: (p) => centsToEuro(p.line.lineTotalCents) }
  ]
  writeTable(positionSheet, positionColumns, positions)

  /* Produkte -------------------------------------------------------- */
  const productSheet = wb.addWorksheet('Produkte')
  type ProductRow = (typeof evaluation.products)[number]
  const productColumns: SheetColumn<ProductRow>[] = [
    { header: 'Produkt', width: 34, value: (p) => p.name },
    { header: 'Zusatzposition', width: 14, value: (p) => yesNo(p.productId === null) },
    { header: 'Menge', width: 10, kind: 'int', value: (p) => p.quantity },
    { header: 'Umsatz', width: 14, kind: 'euro', value: (p) => centsToEuro(p.grossCents) }
  ]
  writeTable(productSheet, productColumns, evaluation.products, { sumColumns: [3] })

  /* Steuer ---------------------------------------------------------- */
  const taxSheet = wb.addWorksheet('Steuer')
  type TaxRow = (typeof evaluation.taxRates)[number]
  const taxColumns: SheetColumn<TaxRow>[] = [
    { header: 'MwSt-Satz', width: 12, kind: 'percent', value: (t) => t.rate },
    { header: 'Netto', width: 14, kind: 'euro', value: (t) => centsToEuro(t.netCents) },
    { header: 'MwSt', width: 14, kind: 'euro', value: (t) => centsToEuro(t.vatCents) },
    { header: 'Brutto', width: 14, kind: 'euro', value: (t) => centsToEuro(t.grossCents) }
  ]
  const taxLast = writeTable(taxSheet, taxColumns, evaluation.taxRates, { sumColumns: [1, 2, 3] })
  if (!evaluation.showTaxRates || source.invoices.some((i) => i.taxExempt)) {
    const note = taxSheet.getRow(taxLast + 2).getCell(1)
    note.value = evaluation.showTaxRates
      ? 'Hinweis: Steuerbefreite Belege weisen keine Umsatzsteuer aus (Netto = Brutto).'
      : 'Hinweis: Für dieses Fest gilt die Steuerbefreiung – es wird keine Umsatzsteuer ausgewiesen.'
    note.font = { italic: true, color: { argb: 'FF555F6B' } }
  }

  /* Zahlarten ------------------------------------------------------- */
  const paymentSheet = wb.addWorksheet('Zahlarten')
  const payments = summarizePayments(invoices)
  type PaymentRow = (typeof payments)[number]
  const paymentColumns: SheetColumn<PaymentRow>[] = [
    { header: 'Zahlart', width: 18, value: (p) => p.label },
    { header: 'Rechnungen', width: 13, kind: 'int', value: (p) => p.invoiceCount },
    { header: 'Stornos', width: 14, kind: 'int', value: (p) => p.stornoCount },
    { header: 'Summe', width: 30, kind: 'euro', value: (p) => centsToEuro(p.grossCents) }
  ]
  const paymentLast = writeTable(paymentSheet, paymentColumns, payments, { sumColumns: [1, 2, 3] })
  const titleRow = paymentLast + 2
  paymentSheet.getCell(titleRow, 1).value = 'Offene Überweisungen'
  paymentSheet.getCell(titleRow, 1).font = { bold: true, size: 12 }
  paymentSheet.getCell(titleRow + 1, 1).value =
    'Zahlungseingänge werden nicht erfasst: Liste aller nicht stornierten Überweisungsrechnungen, sortiert nach Fälligkeit.'
  paymentSheet.getCell(titleRow + 1, 1).font = { italic: true, color: { argb: 'FF555F6B' } }
  const today = todayIso(now)
  const transferColumns: SheetColumn<EvalInvoice>[] = [
    { header: 'Fälligkeitsdatum', width: 18, kind: 'date', value: (i) => isoToExcelDate(i.dueDate) },
    { header: 'Rechnungsnummer', width: 13, value: (i) => i.number },
    { header: 'Rechnungsdatum', width: 14, kind: 'date', value: (i) => isoToExcelDate(i.invoiceDate) },
    { header: 'Kunde', width: 30, value: (i) => i.customerLabel },
    { header: 'Betrag', width: 14, kind: 'euro', value: (i) => centsToEuro(i.totals.grossCents) },
    { header: 'Fällig', width: 12, value: (i) => (i.dueDate < today ? 'überfällig' : 'offen') }
  ]
  writeTable(paymentSheet, transferColumns, transfersOpen, {
    startRow: titleRow + 3,
    sumColumns: [4],
    freeze: false
  })
  paymentSheet.views = [{ state: 'frozen', ySplit: 1, xSplit: 0, topLeftCell: 'A2', activeCell: 'A2' }]

  /* Vereine --------------------------------------------------------- */
  const clubSheet = wb.addWorksheet('Vereine')
  const clubRows = buildClubReport(source)
  type ClubRow = (typeof clubRows)[number]
  const clubColumns: SheetColumn<ClubRow>[] = [
    { header: 'Verein', width: 32, value: (c) => c.clubName },
    { header: 'Ansprechpartner', width: 22, value: (c) => c.contactName },
    { header: 'Ort', width: 18, value: (c) => c.city },
    { header: 'Angemeldete Personen', width: 13, kind: 'int', value: (c) => c.registeredPersons },
    { header: 'Abgerechnete Personen', width: 13, kind: 'int', value: (c) => c.billedPersons },
    {
      header: 'Differenz',
      width: 11,
      kind: 'int',
      value: (c) => (c.registeredPersons === null ? null : c.billedPersons - c.registeredPersons)
    },
    { header: 'Rechnungen', width: 11, kind: 'int', value: (c) => c.invoiceCount },
    { header: 'Umsatz', width: 14, kind: 'euro', value: (c) => centsToEuro(c.grossCents) },
    { header: 'Im Vereinsstamm', width: 15, value: (c) => yesNo(c.inStamm) }
  ]
  writeTable(clubSheet, clubColumns, clubRows, { sumColumns: [3, 4, 5, 6, 7] })

  return wb
}

/** Dateiname-Vorschlag, z. B. „Auswertung Testfest 2025 2025-06-02.xlsx“. */
export function evaluationFileName(festivalName: string, now: Date = new Date()): string {
  return `Auswertung ${festivalName} ${todayIso(now)}.xlsx`
}

/** Schreibt die Auswertung ohne Dialog nach `filePath` (Unit-Tests, Automatisierung). */
export async function writeEvaluationExcel(
  festivalId: number,
  filePath: string,
  db: Db = getDb(),
  now: Date = new Date()
): Promise<string> {
  const source = loadEvaluationSource(festivalId, db)
  return saveWorkbook(buildEvaluationWorkbook(source, now), filePath)
}

/** IPC `evaluation.exportExcel`: Speichern-Dialog → Datei schreiben; null bei Abbruch. */
export async function exportEvaluationExcel(festivalId: number, db: Db = getDb()): Promise<string | null> {
  const source = loadEvaluationSource(festivalId, db)
  const now = new Date()
  const filePath = await askXlsxSavePath({
    title: 'Auswertung nach Excel exportieren',
    fileName: evaluationFileName(source.festival.name, now),
    festivalName: source.festival.name,
    db
  })
  if (!filePath) return null
  return saveWorkbook(buildEvaluationWorkbook(source, now), filePath)
}
