import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '../db/connection'
import {
  centsToEuro,
  DATE_FORMAT,
  DATETIME_FORMAT,
  EURO_FORMAT,
  isoToExcelDate,
  writeEvaluationExcel
} from './evaluation-export'
import { insertFestival, seedScenario, type Scenario } from './evaluation-fixtures'
import { writeInvoiceListExcel } from './invoice-list-export'

async function readWorkbook(path: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path)
  return wb
}

/** Spaltennummer (1-basiert) einer Überschrift in Zeile `headerRow`. */
function col(ws: ExcelJS.Worksheet, header: string, headerRow = 1): number {
  const row = ws.getRow(headerRow)
  for (let c = 1; c <= row.cellCount; c++) {
    if (row.getCell(c).value === header) return c
  }
  throw new Error(`Spalte „${header}“ nicht gefunden in ${ws.name}`)
}

/** Datenzeilen (ab headerRow + 1) bis zur ersten Zeile ohne Wert in Spalte 1. */
function dataRows(ws: ExcelJS.Worksheet, headerRow = 1): ExcelJS.Row[] {
  const rows: ExcelJS.Row[] = []
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const first = row.getCell(1).value
    if (first === null || first === undefined || first === '' || first === 'Summe') break
    rows.push(row)
  }
  return rows
}

function expectHeaderStyled(ws: ExcelJS.Worksheet, headerRow = 1): void {
  expect(ws.getRow(headerRow).getCell(1).font?.bold).toBe(true)
}

describe('Excel-Export der Auswertung', () => {
  let db: Db
  let dir: string
  let scenario: Scenario
  const now = new Date(2025, 5, 2, 18, 30, 0)

  beforeEach(() => {
    db = openDatabase(':memory:')
    dir = mkdtempSync(join(tmpdir(), 'festbuero-liste-test-'))
    scenario = seedScenario(db)
  })
  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('Hilfsfunktionen: Cent → Euro, ISO-Datum → UTC-Datum', () => {
    expect(centsToEuro(67020)).toBe(670.2)
    expect(centsToEuro(-16700)).toBe(-167)
    expect(centsToEuro(0)).toBe(0)
    expect(Object.is(centsToEuro(-0), -0)).toBe(false)
    expect(isoToExcelDate('2025-06-01')?.toISOString()).toBe('2025-06-01T00:00:00.000Z')
    expect(isoToExcelDate('kaputt')).toBeNull()
  })

  it('schreibt alle Blätter in der Reihenfolge der Spezifikation', async () => {
    const path = await writeEvaluationExcel(scenario.festivalId, join(dir, 'auswertung'), db, now)
    expect(path.endsWith('auswertung.xlsx')).toBe(true)
    const wb = await readWorkbook(path)
    expect(wb.worksheets.map((ws) => ws.name)).toEqual([
      'Übersicht',
      'Rechnungen',
      'Positionen',
      'Produkte',
      'Steuer',
      'Zahlarten',
      'Vereine'
    ])
  })

  it('Übersicht: Festname, Exportzeitpunkt und Kennzahlen als echte Zahlen', async () => {
    const wb = await readWorkbook(await writeEvaluationExcel(scenario.festivalId, join(dir, 'a.xlsx'), db, now))
    const ws = wb.getWorksheet('Übersicht')!
    const byLabel = new Map<string, ExcelJS.Cell>()
    ws.eachRow((row) => {
      const label = row.getCell(1).value
      if (typeof label === 'string') byLabel.set(label, row.getCell(2))
    })
    expect(byLabel.get('Gründungsfest')!.value).toBe('Testfest 2025')
    const exported = byLabel.get('Exportiert am')!
    expect(exported.value).toBeInstanceOf(Date)
    expect(exported.numFmt).toBe(DATETIME_FORMAT)
    expect((exported.value as Date).toISOString()).toBe('2025-06-02T18:30:00.000Z') // lokale Zeit wie angezeigt
    const total = byLabel.get('Gesamtumsatz (Stornos gegengerechnet)')!
    expect(total.value).toBe(540.5)
    expect(total.numFmt).toBe(EURO_FORMAT)
    expect(byLabel.get('Anzahl Rechnungen (inkl. stornierter)')!.value).toBe(5)
    expect(byLabel.get('Anzahl Stornos')!.value).toBe(1)
    expect(byLabel.get('davon bar')!.value).toBe(400.5)
    expect(byLabel.get('davon per Überweisung')!.value).toBe(140)
    expect(byLabel.get('Anzahl Personen')!.value).toBe(33)
  })

  it('Rechnungen: eine Zeile pro Beleg mit Typ, Status, Bezug, Grund, Druckstatus; Beträge und Daten formatiert', async () => {
    const wb = await readWorkbook(await writeEvaluationExcel(scenario.festivalId, join(dir, 'a.xlsx'), db, now))
    const ws = wb.getWorksheet('Rechnungen')!
    expectHeaderStyled(ws)
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
    expect(ws.autoFilter).toBeTruthy()
    const rows = dataRows(ws)
    expect(rows.map((r) => r.getCell(1).value)).toEqual(['2025-001', '2025-002', '2025-003', '2025-004', '2025-005', '2025-006'])

    const r2 = rows[1]!
    expect(r2.getCell(col(ws, 'Typ')).value).toBe('Rechnung')
    expect(r2.getCell(col(ws, 'Status')).value).toBe('storniert')
    expect(r2.getCell(col(ws, 'Bezug')).value).toBe('storniert durch Nr. 2025-004')
    const s4 = rows[3]!
    expect(s4.getCell(col(ws, 'Typ')).value).toBe('Storno')
    expect(s4.getCell(col(ws, 'Status')).value).toBe('Storno')
    expect(s4.getCell(col(ws, 'Bezug')).value).toBe('zu Nr. 2025-002')
    expect(s4.getCell(col(ws, 'Storno-Grund')).value).toBe('Falsche Personenzahl')
    const brutto = s4.getCell(col(ws, 'Brutto'))
    expect(brutto.value).toBe(-167)
    expect(brutto.numFmt).toBe(EURO_FORMAT)

    const date = rows[0]!.getCell(col(ws, 'Rechnungsdatum'))
    expect(date.value).toBeInstanceOf(Date)
    expect((date.value as Date).toISOString()).toBe('2025-06-01T00:00:00.000Z')
    expect(date.numFmt).toBe(DATE_FORMAT)
    expect(rows[2]!.getCell(col(ws, 'Gedruckt')).value).toBe('nein')
    expect(rows[0]!.getCell(col(ws, 'Gedruckt')).value).toBe('ja')
    expect(rows[2]!.getCell(col(ws, 'Kunde')).value).toBe('Einzelrechnung')

    // Summenzeile: Personen mit Storno-Gegenrechnung, Brutto gesamt
    const sumRow = ws.getRow(rows.length + 2)
    expect(sumRow.getCell(1).value).toBe('Summe')
    expect(sumRow.getCell(col(ws, 'Personen')).value).toBe(33)
    expect(sumRow.getCell(col(ws, 'Brutto')).value).toBe(540.5)
  })

  it('Positionen: eine Zeile pro Position (ohne Menge 0) mit Nummer, Datum, Kunde; Autofilter', async () => {
    const wb = await readWorkbook(await writeEvaluationExcel(scenario.festivalId, join(dir, 'a.xlsx'), db, now))
    const ws = wb.getWorksheet('Positionen')!
    expectHeaderStyled(ws)
    expect(ws.autoFilter).toBeTruthy()
    const rows = dataRows(ws)
    // R001: 3, R002: 2 (Getränkemarke 0 entfällt), R003: 2, S004: 2, R005: 2, R006: 1
    expect(rows).toHaveLength(12)
    const kaffee = rows.find((r) => r.getCell(col(ws, 'Bezeichnung')).value === 'Kaffee')!
    expect(kaffee.getCell(col(ws, 'Zusatzposition')).value).toBe('ja')
    expect(kaffee.getCell(col(ws, 'Einzelpreis')).value).toBe(2.5)
    expect(kaffee.getCell(col(ws, 'Summe')).numFmt).toBe(EURO_FORMAT)
    expect(kaffee.getCell(col(ws, 'Datum')).value).toBeInstanceOf(Date)
    const storno = rows.filter((r) => r.getCell(1).value === '2025-004')
    expect(storno.map((r) => r.getCell(col(ws, 'Menge')).value)).toEqual([-12, -1])
    expect(storno.map((r) => r.getCell(col(ws, 'Summe')).value)).toEqual([-162, -5])
  })

  it('Produkte, Steuer und Zahlarten (inkl. offener Überweisungen)', async () => {
    const wb = await readWorkbook(await writeEvaluationExcel(scenario.festivalId, join(dir, 'a.xlsx'), db, now))
    const products = wb.getWorksheet('Produkte')!
    expect(dataRows(products).map((r) => [r.getCell(1).value, r.getCell(3).value, r.getCell(4).value])).toEqual([
      ['Festessen', 33, 445.5],
      ['Getränkemarke', 40, 80],
      ['Festschrift', 2, 10],
      ['Kaffee', 2, 5]
    ])
    expect(products.getRow(2).getCell(4).numFmt).toBe(EURO_FORMAT)

    const tax = wb.getWorksheet('Steuer')!
    const taxRows = dataRows(tax)
    expect(taxRows.map((r) => r.getCell(1).value)).toEqual([7, 19])
    expect(taxRows[0]!.getCell(col(tax, 'Netto')).value).toBe(9.34)
    expect(taxRows[0]!.getCell(col(tax, 'MwSt')).value).toBe(0.66)
    expect(taxRows[0]!.getCell(col(tax, 'Brutto')).value).toBe(10)
    expect(taxRows[1]!.getCell(col(tax, 'Brutto')).value).toBe(530.5)

    const pay = wb.getWorksheet('Zahlarten')!
    const payRows = dataRows(pay)
    expect(payRows.map((r) => [r.getCell(1).value, r.getCell(4).value])).toEqual([
      ['Bar', 400.5],
      ['Überweisung', 140]
    ])
    // Liste der offenen Überweisungen
    let listHeader = 0
    pay.eachRow((row, n) => {
      if (row.getCell(1).value === 'Fälligkeitsdatum') listHeader = n
    })
    expect(listHeader).toBeGreaterThan(0)
    const open = dataRows(pay, listHeader)
    expect(open).toHaveLength(1)
    expect(open[0]!.getCell(col(pay, 'Rechnungsnummer', listHeader)).value).toBe('2025-005')
    const due = open[0]!.getCell(1)
    expect((due.value as Date).toISOString()).toBe('2025-06-09T00:00:00.000Z')
    expect(due.numFmt).toBe(DATE_FORMAT)
    expect(open[0]!.getCell(col(pay, 'Betrag', listHeader)).value).toBe(140)
  })

  it('Vereine: angemeldet vs. abgerechnet, inklusive Vereinen außerhalb des Stamms', async () => {
    const wb = await readWorkbook(await writeEvaluationExcel(scenario.festivalId, join(dir, 'a.xlsx'), db, now))
    const ws = wb.getWorksheet('Vereine')!
    const rows = dataRows(ws).map((r) => [
      r.getCell(1).value,
      r.getCell(col(ws, 'Angemeldete Personen')).value,
      r.getCell(col(ws, 'Abgerechnete Personen')).value,
      r.getCell(col(ws, 'Im Vereinsstamm')).value
    ])
    expect(rows).toEqual([
      ['Musterverein e.V.', 20, 18, 'ja'],
      ['Sportfreunde Beispielstadt', 15, 10, 'ja'],
      ['Trachtenverein Muster', 10, 0, 'ja'],
      ['Alter Verein', 8, 5, 'nein']
    ])
  })

  it('funktioniert auch für ein Fest ohne Belege', async () => {
    const empty = insertFestival(db, { name: 'Leeres Fest', taxExempt: true })
    const wb = await readWorkbook(await writeEvaluationExcel(empty, join(dir, 'leer.xlsx'), db, now))
    expect(wb.worksheets).toHaveLength(7)
    expect(dataRows(wb.getWorksheet('Rechnungen')!)).toHaveLength(0)
  })
})

describe('Excel-Export der Rechnungsliste', () => {
  let db: Db
  let dir: string
  let scenario: Scenario

  beforeEach(() => {
    db = openDatabase(':memory:')
    dir = mkdtempSync(join(tmpdir(), 'festbuero-liste-test-'))
    scenario = seedScenario(db)
  })
  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('exportiert alle Belege mit den Spalten der Liste', async () => {
    const wb = await readWorkbook(await writeInvoiceListExcel(scenario.festivalId, join(dir, 'liste.xlsx'), undefined, db))
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Rechnungen'])
    const ws = wb.getWorksheet('Rechnungen')!
    expect(ws.getRow(1).values).toEqual([
      undefined,
      'Nummer',
      'Datum',
      'Kunde',
      'Personen',
      'Zahlart',
      'Betrag',
      'Status',
      'Bezug',
      'Gedruckt',
      'Gedruckt am'
    ])
    expectHeaderStyled(ws)
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
    expect(ws.autoFilter).toBeTruthy()
    const rows = dataRows(ws)
    expect(rows).toHaveLength(6)
    const betrag = rows[3]!.getCell(col(ws, 'Betrag'))
    expect(betrag.value).toBe(-167)
    expect(betrag.numFmt).toBe(EURO_FORMAT)
    expect(rows[3]!.getCell(col(ws, 'Status')).value).toBe('Storno')
    expect(rows[3]!.getCell(col(ws, 'Bezug')).value).toBe('zu Nr. 2025-002')
    expect(rows[0]!.getCell(col(ws, 'Datum')).numFmt).toBe(DATE_FORMAT)
    const sum = ws.getRow(8)
    expect(sum.getCell(col(ws, 'Betrag')).value).toBe(540.5)
    expect(sum.getCell(col(ws, 'Personen')).value).toBe(33)
  })

  it('exportiert nur die übergebenen Belege in deren Reihenfolge', async () => {
    const { r5, r1 } = scenario.invoices
    const wb = await readWorkbook(await writeInvoiceListExcel(scenario.festivalId, join(dir, 'auswahl.xlsx'), [r5, r1, 99999], db))
    const rows = dataRows(wb.getWorksheet('Rechnungen')!)
    expect(rows.map((r) => r.getCell(1).value)).toEqual(['2025-005', '2025-001'])
    expect(rows.map((r) => r.getCell(6).value)).toEqual([140, 320])
  })
})
