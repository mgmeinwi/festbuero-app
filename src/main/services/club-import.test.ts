import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ClubImportRow } from '@shared/types'
import { openDatabase, type Db } from '../db/connection'
import {
  applyImport,
  cellText,
  commitImport,
  findHeaderRow,
  markDuplicates,
  matchHeader,
  normalizeHeader,
  parseClubFile,
  parseClubWorkbook,
  parsePersons,
  parseZip,
  previewImport,
  unwrapCellValue
} from './club-import'
import { createClub, getClub, listClubs } from './clubs'

const FIXTURES = fileURLToPath(new URL('../../../tests/fixtures/', import.meta.url))
const fixture = (name: string) => join(FIXTURES, name)

function insertFestival(db: Db, name = 'Testfest 2025'): number {
  const now = new Date().toISOString()
  const result = db
    .prepare('INSERT INTO festival (name, festival_date, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(name, '2025-06-01', now, now)
  return Number(result.lastInsertRowid)
}

/** Arbeitsmappe aus Zeilen (Zeile 1 = erstes Element). */
function workbook(rows: unknown[][], sheetName = 'Tabelle1'): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(sheetName)
  rows.forEach((values, i) => {
    if (values.length > 0) ws.getRow(i + 1).values = values as ExcelJS.CellValue[]
  })
  return wb
}

const HEADER = ['Name', 'Verein', 'Straße', 'PLZ', 'Ort', 'ang. Personen']

describe('Kopfzeile erkennen', () => {
  it.each([
    ['Verein', 'clubName'],
    ['  VEREIN ', 'clubName'],
    ['Vereinsname', 'clubName'],
    ['Name', 'contactName'],
    ['Ansprechpartner', 'contactName'],
    ['Straße', 'street'],
    ['Strasse', 'street'],
    ['STRASSE', 'street'],
    ['Str.', 'street'],
    ['PLZ', 'zip'],
    ['P.L.Z.', 'zip'],
    ['Postleitzahl', 'zip'],
    ['Ort', 'city'],
    ['Wohnort', 'city'],
    ['ang. Personen', 'registeredPersons'],
    ['ang.Personen', 'registeredPersons'],
    ['Ang. Personen', 'registeredPersons'],
    ['angemeldete Personen', 'registeredPersons'],
    ['Angemeldete  Personen', 'registeredPersons'],
    ['Personen', 'registeredPersons'],
    ['Personen (Anzahl)', 'registeredPersons'],
    ['ang. Pers.', 'registeredPersons']
  ])('„%s“ → %s', (label, field) => {
    expect(matchHeader(label)).toBe(field)
  })

  it.each(['Nr', 'Rnr', 'Bier', 'Brotzeit', 'Festzeichen', 'Betrag', '', 'Personen gesamt Bier'])(
    'ignoriert „%s“',
    (label) => {
      expect(matchHeader(label)).toBeNull()
    }
  )

  it('normalisiert Umlaute, Punkte und Leerzeichen', () => {
    expect(normalizeHeader(' Straße ')).toBe('strasse')
    expect(normalizeHeader('ang. Personen')).toBe('angpersonen')
    expect(normalizeHeader('Ort ')).toBe('ort')
  })

  it('findet die Kopfzeile unabhängig von Position und Spaltenreihenfolge', () => {
    const wb = workbook([
      ['Anmeldeliste'],
      [],
      ['Betrag', 'ang.Personen', 'Ort', 'PLZ', '  VEREIN ', 'Nr', 'Name'],
      [10, 5, 'Musterdorf', 12345, 'FF Musterdorf', 1, 'Anna Beispiel']
    ])
    const header = findHeaderRow(wb.worksheets[0]!)
    expect(header?.rowNumber).toBe(3)
    expect(header?.columns).toEqual({ registeredPersons: 2, city: 3, zip: 4, clubName: 5, contactName: 7 })
    const parsed = parseClubWorkbook(wb)
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0]).toMatchObject({
      rowNumber: 4,
      clubName: 'FF Musterdorf',
      contactName: 'Anna Beispiel',
      zip: '12345',
      city: 'Musterdorf',
      street: '',
      registeredPersons: 5,
      errors: []
    })
    expect(parsed.missingOptionalColumns).toEqual(['Straße'])
  })

  it('sucht nur in den ersten 15 Zeilen', () => {
    const rows: unknown[][] = Array.from({ length: 15 }, () => ['Notiz'])
    rows.push(HEADER, ['A', 'FF Musterdorf', 'Weg 1', 12345, 'Ort', 3])
    const parsed = parseClubWorkbook(workbook(rows))
    expect(parsed.headerRow).toBeNull()
    expect(parsed.missingColumns).toEqual(['Verein', 'ang. Personen'])
    expect(parsed.validRows).toBe(0)
  })

  it('nimmt das erste Blatt mit vollständiger Kopfzeile', () => {
    const wb = new ExcelJS.Workbook()
    wb.addWorksheet('Deckblatt').getRow(1).values = ['Gründungsfest', 'Musterdorf']
    wb.addWorksheet('Preise').getRow(1).values = ['Produkt', 'Preis']
    const ws = wb.addWorksheet('Liste')
    ws.getRow(1).values = HEADER
    ws.getRow(2).values = ['A', 'FF Musterdorf', 'Weg 1', 12345, 'Ort', 3]
    const parsed = parseClubWorkbook(wb)
    expect(parsed.sheetName).toBe('Liste')
    expect(parsed.validRows).toBe(1)
  })

  it('meldet fehlende Pflicht- und optionale Spalten', () => {
    const parsed = parseClubWorkbook(workbook([['Verein', 'Ort'], ['FF Musterdorf', 'Musterdorf']]))
    expect(parsed.missingColumns).toEqual(['ang. Personen'])
    expect(parsed.missingOptionalColumns).toEqual(['Name', 'Straße', 'PLZ'])
    expect(parsed.validRows).toBe(0)
  })

  it('ignoriert ausgeblendete Blätter', () => {
    const wb = new ExcelJS.Workbook()
    const hidden = wb.addWorksheet('Alt', { state: 'hidden' })
    hidden.getRow(1).values = HEADER
    hidden.getRow(2).values = ['Alt', 'Alter Verein', '', '', '', 1]
    const ws = wb.addWorksheet('Neu')
    ws.getRow(1).values = HEADER
    ws.getRow(2).values = ['Neu', 'Neuer Verein', '', '', '', 2]
    expect(parseClubWorkbook(wb).rows.map((r) => r.clubName)).toEqual(['Neuer Verein'])
  })
})

describe('Zellwerte', () => {
  it('liest Zahl, Text, Rich-Text, Formel, Hyperlink, Datum und Fehler', () => {
    expect(unwrapCellValue(42)).toBe(42)
    expect(unwrapCellValue('  Text ')).toBe('  Text ')
    expect(unwrapCellValue({ richText: [{ text: 'FF ' }, { font: { bold: true }, text: 'Musterdorf' }] })).toBe(
      'FF Musterdorf'
    )
    expect(unwrapCellValue({ formula: '10+5', result: 15 })).toBe(15)
    expect(unwrapCellValue({ sharedFormula: 'A1', result: 'Ort' })).toBe('Ort')
    expect(unwrapCellValue({ formula: 'A1' })).toBeNull()
    expect(unwrapCellValue({ text: 'FC Demohofen', hyperlink: 'https://example.org' })).toBe('FC Demohofen')
    expect(unwrapCellValue({ text: { richText: [{ text: 'Link' }] }, hyperlink: 'https://example.org' })).toBe('Link')
    expect(unwrapCellValue({ error: '#N/A' })).toBeNull()
    expect(unwrapCellValue({ formula: '1/0', result: { error: '#DIV/0!' } })).toBeNull()
    const date = new Date(Date.UTC(2025, 5, 1))
    expect(cellText(unwrapCellValue(date))).toBe('01.06.2025')
    expect(cellText(true)).toBe('WAHR')
    expect(cellText('  FF   Musterdorf\t')).toBe('FF Musterdorf')
    expect(cellText(2.5)).toBe('2,5')
  })

  it('PLZ: immer Text, führende Nullen', () => {
    expect(parseZip(12345)).toBe('12345')
    expect(parseZip(1067)).toBe('01067')
    expect(parseZip(1067, '00000')).toBe('01067')
    expect(parseZip(67, '00000')).toBe('00067')
    expect(parseZip(67)).toBe('67')
    expect(parseZip(1234, '0')).toBe('01234')
    expect(parseZip(123456)).toBe('123456')
    expect(parseZip('01067')).toBe('01067')
    expect(parseZip(' 1067 ')).toBe('1067')
    expect(parseZip('A-1010')).toBe('A-1010')
    expect(parseZip(null)).toBe('')
    expect(parseZip(1067, '[<=99999]00000;General')).toBe('01067')
  })

  it('Personen: ganze Zahl ≥ 0 als Zahl oder Zahltext', () => {
    expect(parsePersons(20)).toEqual({ value: 20 })
    expect(parsePersons(0)).toEqual({ value: 0 })
    expect(parsePersons(' 25 ')).toEqual({ value: 25 })
    expect(parsePersons('20,0')).toEqual({ value: 20 })
    expect(parsePersons(null).error).toBe('Keine Zahl bei Personen (Feld ist leer).')
    expect(parsePersons('  ').error).toBe('Keine Zahl bei Personen (Feld ist leer).')
    expect(parsePersons('ca. 20').error).toBe('Keine Zahl bei Personen („ca. 20“).')
    expect(parsePersons('20 Personen').error).toContain('Keine Zahl bei Personen')
    expect(parsePersons(12.5).error).toBe('Personen müssen eine ganze Zahl ab 0 sein („12,5“).')
    expect(parsePersons(-3).error).toBe('Personen müssen eine ganze Zahl ab 0 sein („-3“).')
    expect(parsePersons('12,5').error).toContain('ganze Zahl')
    expect(parsePersons(true).error).toContain('Keine Zahl bei Personen')
    expect(parsePersons(1_000_000).error).toContain('Zu viele Personen')
  })

  it('übernimmt das Zahlenformat 00000 aus der Zelle', () => {
    const wb = workbook([HEADER, ['A', 'FF Musterdorf', 'Weg 1', 1067, 'Ort', 3]])
    wb.worksheets[0]!.getCell('D2').numFmt = '00000'
    expect(parseClubWorkbook(wb).rows[0]!.zip).toBe('01067')
  })
})

describe('Zeilen', () => {
  it('überspringt leere Zeilen und markiert fehlende Vereinsnamen und Summenzeilen', () => {
    const wb = workbook([
      ['Nr', ...HEADER, 'Betrag'],
      [1, 'Anna', 'FF Musterdorf', 'Weg 1', 12345, 'Musterdorf', 10, 100],
      [],
      [2, null, null, null, null, null, null, null],
      [3],
      [4, 'Bernd', '', 'Weg 2', 23456, 'Beispielstadt', 5, 50],
      [null, null, 'Summe', null, null, null, 15, 150],
      [null, 'Summe', null, null, null, null, 15, 150]
    ])
    const parsed = parseClubWorkbook(wb)
    // Zeilen 3–5 enthalten in den erkannten Spalten nichts → übersprungen
    expect(parsed.rows.map((r) => r.rowNumber)).toEqual([2, 6, 7, 8])
    expect(parsed.totalRows).toBe(4)
    expect(parsed.validRows).toBe(1)
    expect(parsed.rows[1]!.errors).toEqual(['Vereinsname fehlt.'])
    expect(parsed.rows[2]!.errors).toEqual(['Summenzeile („Summe“) – wird nicht importiert.'])
    expect(parsed.rows[3]!.errors).toEqual(['Vereinsname fehlt.'])
  })

  it('sammelt mehrere Fehler pro Zeile', () => {
    const parsed = parseClubWorkbook(workbook([HEADER, ['Anna', '', 'Weg', 1, 'Ort', 'ca. 20']]))
    expect(parsed.rows[0]!.errors).toEqual(['Vereinsname fehlt.', 'Keine Zahl bei Personen („ca. 20“).'])
    expect(parsed.rows[0]!.registeredPersons).toBeNull()
  })

  it('meldet zu lange Werte', () => {
    const parsed = parseClubWorkbook(workbook([HEADER, ['A', 'V'.repeat(201), '', '1'.repeat(21), '', 1]]))
    expect(parsed.rows[0]!.errors).toEqual([
      'Verein ist zu lang (höchstens 200 Zeichen).',
      'PLZ ist zu lang (höchstens 20 Zeichen).'
    ])
  })

  it('Dubletten: identische Zeile = Fehler, gleicher Name mit anderen Daten = Hinweis', () => {
    const parsed = parseClubWorkbook(
      workbook([
        HEADER,
        ['Anna', 'FF Musterdorf', 'Weg 1', 12345, 'Musterdorf', 10],
        ['Bernd', 'TSV Beispielstadt', 'Weg 2', 23456, 'Beispielstadt', 5],
        ['Clara', 'ff  musterdorf', 'Weg 1', 12345, 'Musterdorf', 4],
        ['Anna', 'FF Musterdorf', 'Weg 1', 12345, 'Musterdorf', 10],
        ['', 'TSV Beispielstadt', '', '', '', 'ca. 3']
      ])
    )
    const byRow = new Map(parsed.rows.map((r) => [r.rowNumber, r]))
    expect(byRow.get(2)!.errors).toEqual([])
    expect(byRow.get(2)!.warnings).toEqual(['Verein „FF Musterdorf“ steht mehrfach in der Datei (auch Zeile 4).'])
    expect(byRow.get(4)!.errors).toEqual([])
    expect(byRow.get(4)!.warnings).toEqual(['Verein „ff musterdorf“ steht mehrfach in der Datei (auch Zeile 2).'])
    expect(byRow.get(5)!.errors).toEqual(['Doppelte Zeile: identisch mit Zeile 2.'])
    // fehlerhafte Zeilen zählen nicht als Dublette
    expect(byRow.get(3)!.warnings).toBeUndefined()
    expect(parsed.validRows).toBe(3)
  })

  it('markDuplicates lässt eindeutige Zeilen unverändert', () => {
    const rows: ClubImportRow[] = [
      { rowNumber: 2, contactName: '', clubName: 'A', street: '', zip: '', city: '', registeredPersons: 1, errors: [] },
      { rowNumber: 3, contactName: '', clubName: 'B', street: '', zip: '', city: '', registeredPersons: 1, errors: [] }
    ]
    markDuplicates(rows)
    expect(rows.every((r) => r.errors.length === 0 && r.warnings === undefined)).toBe(true)
  })
})

describe('Testdateien', () => {
  it('vereine-beispiel.xlsx: 15 Vereine, Zusatzspalten ignoriert, Summenzeile als Fehler', async () => {
    const parsed = await parseClubFile(fixture('vereine-beispiel.xlsx'))
    expect(parsed.sheetName).toBe('Übersicht')
    expect(parsed.headerRow).toBe(1)
    expect(parsed.missingColumns).toEqual([])
    expect(parsed.missingOptionalColumns).toEqual([])
    expect(parsed.totalRows).toBe(16)
    expect(parsed.validRows).toBe(15)
    const errors = parsed.rows.filter((r) => r.errors.length > 0)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ rowNumber: 18, contactName: 'Summe', errors: ['Vereinsname fehlt.'] })

    const byClub = new Map(parsed.rows.map((r) => [r.clubName, r]))
    expect(byClub.get('FF Musterdorf')).toMatchObject({
      contactName: 'Anna Beispiel',
      street: 'Hauptstraße 1',
      zip: '12345',
      city: 'Musterdorf',
      registeredPersons: 45
    })
    expect(byClub.get('Schützenverein Testingen e.V.')!.zip).toBe('01234')
    expect(byClub.get('Burschenverein Platzhalterau')!.zip).toBe('09876')
    expect(byClub.get('Gartenbauverein Skizzenberg')!.zip).toBe('67890')
    expect(byClub.get('Trachtenverein Vorlagenbach')!.registeredPersons).toBe(25)
    expect(byClub.get('Musikkapelle Fiktivried')!.contactName).toBe('Eva Testmann')
    expect(byClub.get('FC Demohofen')!.registeredPersons).toBe(27)
    expect(byClub.get('Sportfreunde Rohlingen')!.contactName).toBe('Lukas Attrappe')
  })

  it('vereine-fehler.xlsx: Kopfzeile in Zeile 3, Fehlerzeilen mit Meldungen', async () => {
    const parsed = await parseClubFile(fixture('vereine-fehler.xlsx'))
    expect(parsed.headerRow).toBe(3)
    expect(parsed.missingColumns).toEqual([])
    expect(parsed.totalRows).toBe(9)
    expect(parsed.validRows).toBe(3)
    const messages = Object.fromEntries(parsed.rows.map((r) => [r.rowNumber, r.errors]))
    expect(messages).toEqual({
      4: [],
      5: ['Vereinsname fehlt.'],
      6: ['Keine Zahl bei Personen („ca. 20“).'],
      9: [],
      10: ['Keine Zahl bei Personen (Feld ist leer).'],
      11: ['Personen müssen eine ganze Zahl ab 0 sein („12,5“).'],
      12: [],
      13: ['Doppelte Zeile: identisch mit Zeile 9.'],
      14: ['Personen müssen eine ganze Zahl ab 0 sein („-3“).']
    })
    expect(parsed.rows.find((r) => r.rowNumber === 9)!.zip).toBe('04444')
    expect(parsed.rows.find((r) => r.rowNumber === 12)!.warnings?.[0]).toContain('mehrfach')
  })

  it('vereine-ohne-pflichtspalte.xlsx: Import nicht möglich', async () => {
    const parsed = await parseClubFile(fixture('vereine-ohne-pflichtspalte.xlsx'))
    expect(parsed.missingColumns).toEqual(['ang. Personen'])
    expect(parsed.totalRows).toBe(3)
    expect(parsed.validRows).toBe(0)
  })
})

describe('Datei laden', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'festbuero-club-import-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('meldet verständliche Fehler', async () => {
    await expect(parseClubFile(join(dir, 'fehlt.xlsx'))).rejects.toThrow('Die Datei wurde nicht gefunden')
    await expect(parseClubFile(join(dir, 'alt.xls'))).rejects.toThrow('(.xls) wird nicht unterstützt')
    await expect(parseClubFile(join(dir, 'liste.csv'))).rejects.toThrow('.csv werden nicht unterstützt')
    await expect(parseClubFile(join(dir, 'liste.txt'))).rejects.toThrow('Format .xlsx')
    const broken = join(dir, 'kaputt.xlsx')
    writeFileSync(broken, 'keine Excel-Datei')
    await expect(parseClubFile(broken)).rejects.toThrow('gültige Excel-Datei')
  })
})

describe('Vorschau und Import (Ersetzungslogik)', () => {
  let db: Db
  let festivalId: number
  let otherFestivalId: number
  let dir: string

  beforeEach(() => {
    db = openDatabase(':memory:')
    festivalId = insertFestival(db)
    otherFestivalId = insertFestival(db, 'Anderes Fest')
    dir = mkdtempSync(join(tmpdir(), 'festbuero-club-import-'))
  })
  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  async function writeList(name: string, rows: unknown[][]): Promise<string> {
    const path = join(dir, name)
    await workbook([HEADER, ...rows]).xlsx.writeFile(path)
    return path
  }

  function insertInvoice(clubId: number, opts: { number: string; clubName: string }) {
    const now = new Date().toISOString()
    const customer = JSON.stringify({ kind: 'verein', clubId, clubName: opts.clubName, contactName: '', street: '', zip: '', city: '' })
    db.prepare(
      `INSERT INTO invoice (festival_id, number, seq, type, status, original_invoice_id, customer_kind, club_id,
         customer_json, persons, payment_kind, payment_label, payment_text, due_days, invoice_date, service_date,
         due_date, total_gross_cents, total_net_cents, total_vat_cents, totals_json, tax_exempt, tax_exempt_text,
         festival_name, template_json, created_at)
       VALUES (?, ?, 1, 'rechnung', 'abgeschlossen', NULL, 'verein', ?, ?, 10, 'bar', 'Bar', '', 7, '2025-06-01',
         '2025-06-01', '2025-06-08', 1000, 1000, 0, '{}', 1, '', 'Testfest', '{}', ?)`
    ).run(festivalId, opts.number, clubId, customer, now)
  }

  it('Vorschau ohne bestehende Vereine', async () => {
    const preview = await previewImport(festivalId, fixture('vereine-beispiel.xlsx'), db)
    expect(preview).toMatchObject({
      filePath: fixture('vereine-beispiel.xlsx'),
      sheetName: 'Übersicht',
      totalRows: 16,
      validRows: 15,
      missingColumns: [],
      existingImportedCount: 0,
      replacedManualClubs: [],
      headerRow: 1
    })
    expect(listClubs(festivalId, db)).toHaveLength(0)
  })

  it('erster Import legt alle gültigen Zeilen als „import“ an', async () => {
    const result = await commitImport(festivalId, fixture('vereine-beispiel.xlsx'), db)
    expect(result).toEqual({ imported: 15, skipped: 1, removedImported: 0, removedManual: 0 })
    const clubs = listClubs(festivalId, db)
    expect(clubs).toHaveLength(15)
    expect(clubs.every((c) => c.source === 'import' && c.festivalId === festivalId)).toBe(true)
    expect(clubs.find((c) => c.clubName.startsWith('Schützenverein'))!.zip).toBe('01234')
  })

  it('erneuter Import ersetzt importierte Vereine, manuelle bleiben außer bei Namensgleichheit', async () => {
    await commitImport(festivalId, fixture('vereine-beispiel.xlsx'), db)
    const manualKeep = createClub(
      festivalId,
      { contactName: 'Hand', clubName: 'SV Handeingabe', street: '', zip: '', city: '', registeredPersons: 7 },
      db
    )
    createClub(
      festivalId,
      { contactName: 'Doppelt', clubName: 'ff musterdorf', street: '', zip: '', city: '', registeredPersons: 1 },
      db
    )
    const otherFestivalClub = createClub(
      otherFestivalId,
      { contactName: '', clubName: 'TSV Beispielstadt', street: '', zip: '', city: '', registeredPersons: 1 },
      db
    )

    const path = await writeList('neu.xlsx', [
      ['Anna Neu', 'FF Musterdorf', 'Neuer Weg 1', 12345, 'Musterdorf', 50],
      ['Zoe Zusatz', 'Neuer Verein Testingen', '', 1067, 'Testingen', 3],
      ['', '', '', '', '', 'ca. 4']
    ])
    const preview = await previewImport(festivalId, path, db)
    expect(preview.existingImportedCount).toBe(15)
    expect(preview.replacedManualClubs).toEqual(['ff musterdorf'])
    expect(preview.validRows).toBe(2)

    const result = await commitImport(festivalId, path, db)
    expect(result).toEqual({ imported: 2, skipped: 1, removedImported: 15, removedManual: 1 })

    const clubs = listClubs(festivalId, db)
    expect(clubs.map((c) => [c.clubName, c.source]).sort()).toEqual(
      [
        ['FF Musterdorf', 'import'],
        ['Neuer Verein Testingen', 'import'],
        ['SV Handeingabe', 'manual']
      ].sort()
    )
    expect(clubs.find((c) => c.clubName === 'FF Musterdorf')).toMatchObject({ contactName: 'Anna Neu', registeredPersons: 50 })
    expect(clubs.find((c) => c.clubName === 'Neuer Verein Testingen')!.zip).toBe('01067')
    expect(getClub(manualKeep.id, db).registeredPersons).toBe(7)
    // anderes Fest unberührt
    expect(listClubs(otherFestivalId, db).map((c) => c.id)).toEqual([otherFestivalClub.id])
  })

  it('behält die ID gleichnamiger Vereine, damit „Rechnung vorhanden“ erhalten bleibt', async () => {
    await commitImport(festivalId, fixture('vereine-beispiel.xlsx'), db)
    const ff = listClubs(festivalId, db).find((c) => c.clubName === 'FF Musterdorf')!
    insertInvoice(ff.id, { number: '2025-001', clubName: 'FF Musterdorf' })
    const manual = createClub(
      festivalId,
      { contactName: '', clubName: 'Neuer Verein', street: '', zip: '', city: '', registeredPersons: 2 },
      db
    )
    insertInvoice(manual.id, { number: '2025-002', clubName: 'Neuer Verein' })
    expect(getClub(ff.id, db).hasInvoice).toBe(true)

    const path = await writeList('zweiter.xlsx', [
      ['Anna', 'FF Musterdorf', '', '', '', 46],
      ['Neu', 'Neuer Verein', '', '', '', 4]
    ])
    await commitImport(festivalId, path, db)
    const clubs = listClubs(festivalId, db)
    expect(clubs).toHaveLength(2)
    expect(clubs.find((c) => c.clubName === 'FF Musterdorf')).toMatchObject({ id: ff.id, hasInvoice: true, registeredPersons: 46 })
    expect(clubs.find((c) => c.clubName === 'Neuer Verein')).toMatchObject({
      id: manual.id,
      source: 'import',
      hasInvoice: true
    })
  })

  it('Rechnung für einen Verein, erneuter Import mit neuer ID: hasInvoice bleibt true (Zuordnung über den Namen)', async () => {
    await commitImport(festivalId, fixture('vereine-beispiel.xlsx'), db)
    const ff = listClubs(festivalId, db).find((c) => c.clubName === 'FF Musterdorf')!
    insertInvoice(ff.id, { number: '2025-001', clubName: 'FF Musterdorf' })
    // Verein wird gelöscht → beim nächsten Import entsteht ein neuer Datensatz mit neuer ID
    db.prepare('DELETE FROM club WHERE id = ?').run(ff.id)
    const path = await writeList('neu.xlsx', [['Anna', 'ff musterdorf', '', '', '', 46]])
    await commitImport(festivalId, path, db)
    const reimported = listClubs(festivalId, db)
    expect(reimported).toHaveLength(1)
    expect(reimported[0]!.id).not.toBe(ff.id)
    expect(reimported[0]!.hasInvoice).toBe(true)
  })

  it('verweigert den Import bei fehlender Pflichtspalte oder ohne gültige Zeile und ändert nichts', async () => {
    await commitImport(festivalId, fixture('vereine-beispiel.xlsx'), db)
    await expect(commitImport(festivalId, fixture('vereine-ohne-pflichtspalte.xlsx'), db)).rejects.toThrow(
      'Import nicht möglich: Es fehlen Pflichtspalten (ang. Personen).'
    )
    const empty = await writeList('leer.xlsx', [['', '', '', '', '', 'ca. 4']])
    await expect(commitImport(festivalId, empty, db)).rejects.toThrow('keine gültigen Vereine')
    expect(listClubs(festivalId, db)).toHaveLength(15)
  })

  it('macht bei einem Fehler in der Transaktion alles rückgängig', async () => {
    await commitImport(festivalId, fixture('vereine-beispiel.xlsx'), db)
    const parsed = await parseClubFile(fixture('vereine-fehler.xlsx'))
    // ungültige Personenzahl an der DB vorbeischmuggeln → CHECK-Constraint schlägt fehl
    parsed.rows.find((r) => r.errors.length === 0)!.registeredPersons = -1
    expect(() => applyImport(festivalId, parsed, db)).toThrow()
    expect(listClubs(festivalId, db)).toHaveLength(15)
  })

  it('wirft bei unbekanntem Fest', async () => {
    await expect(previewImport(9999, fixture('vereine-beispiel.xlsx'), db)).rejects.toThrow(
      'Das Gründungsfest wurde nicht gefunden.'
    )
  })
})
