import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Club } from '@shared/types'
import { openDatabase, type Db } from '../db/connection'
import { commitImport, parseClubFile } from './club-import'
import {
  buildTemplateWorkbook,
  exportTemplate,
  HINTS_SHEET_NAME,
  TEMPLATE_MIN_ROWS,
  TEMPLATE_SHEET_NAME,
  templateFileName,
  writeTemplateFile
} from './club-template-export'
import { createClub, listClubs } from './clubs'

const CLUB: Club = {
  id: 1,
  festivalId: 1,
  contactName: 'Anna Beispiel',
  clubName: 'FF Musterdorf',
  street: 'Hauptstraße 1',
  zip: '01067',
  city: 'Musterdorf',
  registeredPersons: 45,
  source: 'import',
  hasInvoice: false
}

function insertFestival(db: Db, name: string): number {
  const now = new Date().toISOString()
  return Number(
    db
      .prepare('INSERT INTO festival (name, festival_date, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(name, '2025-06-01', now, now).lastInsertRowid
  )
}

async function reload(path: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path)
  return wb
}

describe('Anmelde-Vorlage', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'festbuero-club-template-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('Dateiname-Vorschlag', () => {
    expect(templateFileName('Gründungsfest 2025')).toBe('Anmeldung Gründungsfest 2025.xlsx')
    expect(templateFileName('Fest: 100/Jahre?')).toBe('Anmeldung Fest_ 100_Jahre_.xlsx')
  })

  it('Blatt „Anmeldungen“: Kopfzeile, Formate, Datenüberprüfung', async () => {
    const path = join(dir, 'vorlage.xlsx')
    await writeTemplateFile(path, { festivalName: 'Testfest 2025' })
    const wb = await reload(path)
    expect(wb.worksheets.map((ws) => ws.name)).toEqual([TEMPLATE_SHEET_NAME, HINTS_SHEET_NAME])

    const ws = wb.getWorksheet(TEMPLATE_SHEET_NAME)!
    const header = ws.getRow(1)
    expect([1, 2, 3, 4, 5, 6].map((c) => header.getCell(c).value)).toEqual([
      'Name',
      'Verein',
      'Straße',
      'PLZ',
      'Ort',
      'ang. Personen'
    ])
    expect(header.getCell(7).value).toBeNull()
    for (let c = 1; c <= 6; c++) expect(header.getCell(c).font?.bold).toBe(true)

    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
    expect(ws.autoFilter).toBe(`A1:F${TEMPLATE_MIN_ROWS + 1}`)
    expect(ws.getColumn(2).width).toBeGreaterThanOrEqual(30)
    expect(ws.getColumn(4).width).toBeGreaterThanOrEqual(8)

    // PLZ als Text, Personen mit Datenüberprüfung – auch in der letzten vorformatierten Zeile
    for (const r of [2, TEMPLATE_MIN_ROWS + 1]) {
      expect(ws.getCell(r, 4).numFmt).toBe('@')
      expect(ws.getCell(r, 6).dataValidation).toMatchObject({
        type: 'whole',
        operator: 'greaterThanOrEqual',
        allowBlank: true,
        formulae: [0],
        showErrorMessage: true
      })
    }
    expect(ws.getCell(2, 1).value).toBeNull()
  })

  it('Blatt „Hinweise“ mit Ausfüllanleitung', async () => {
    const path = join(dir, 'vorlage.xlsx')
    await writeTemplateFile(path, { festivalName: 'Testfest 2025', now: new Date(2025, 4, 3) })
    const ws = (await reload(path)).getWorksheet(HINTS_SHEET_NAME)!
    const texts: string[] = []
    ws.eachRow((row) => texts.push(String(row.getCell(1).value ?? '')))
    const all = texts.join('\n')
    expect(texts[0]).toBe('Anmeldung zum Testfest 2025')
    expect(all).toContain('ang. Personen')
    expect(all).toContain('führender Null')
    expect(all).toContain('.xlsx')
    expect(all).toContain('03.05.2025')
    expect(all).not.toContain('bekannte Vereine')
  })

  it('vorausgefüllt mit Vereinen (PLZ als Text, alphabetisch)', async () => {
    const path = join(dir, 'vorlage.xlsx')
    const clubs: Club[] = [
      { ...CLUB, id: 2, clubName: 'TSV Beispielstadt', zip: '23456', registeredPersons: 0, contactName: '' },
      CLUB
    ]
    await writeTemplateFile(path, { festivalName: 'Testfest', clubs })
    const wb = await reload(path)
    const ws = wb.getWorksheet(TEMPLATE_SHEET_NAME)!
    expect(ws.getRow(2).values).toEqual([undefined, 'Anna Beispiel', 'FF Musterdorf', 'Hauptstraße 1', '01067', 'Musterdorf', 45])
    expect(ws.getCell('A3').value).toBeNull()
    expect(ws.getCell('B3').value).toBe('TSV Beispielstadt')
    expect(ws.getCell('F3').value).toBe(0)
    expect(String(wb.getWorksheet(HINTS_SHEET_NAME)!.getColumn(1).values.join(' '))).toContain('2 bekannte Vereine')
  })

  it('genug vorformatierte Zeilen auch bei vielen Vereinen', () => {
    const clubs = Array.from({ length: 400 }, (_, i) => ({ ...CLUB, id: i + 1, clubName: `Verein ${i + 1}` }))
    const ws = buildTemplateWorkbook({ festivalName: 'X', clubs }).getWorksheet(TEMPLATE_SHEET_NAME)!
    expect(ws.autoFilter).toBe('A1:F501')
    expect(ws.getCell(501, 4).numFmt).toBe('@')
  })

  it('Rundreise: leere Vorlage ausfüllen → fehlerfrei importieren', async () => {
    const path = join(dir, 'vorlage.xlsx')
    await writeTemplateFile(path, { festivalName: 'Testfest 2025' })

    // wie der Vorstand in Excel: Werte in die vorformatierten Zeilen schreiben
    const wb = await reload(path)
    const ws = wb.getWorksheet(TEMPLATE_SHEET_NAME)!
    const filled = [
      ['Anna Beispiel', 'FF Musterdorf', 'Hauptstraße 1', '01067', 'Musterdorf', 45],
      ['Bernd Platzhalter', 'TSV Beispielstadt', 'Sportplatzweg 3', '23456', 'Beispielstadt', 38],
      ['', 'Schützenverein Testingen', '', '', 'Testingen', 0]
    ]
    filled.forEach((values, i) => {
      values.forEach((v, c) => {
        ws.getCell(i + 2, c + 1).value = v === '' ? null : v
      })
    })
    // eine leere Zeile dazwischen ist erlaubt
    ws.getCell(6, 2).value = 'Musikkapelle Fiktivried'
    ws.getCell(6, 6).value = 30
    const filledPath = join(dir, 'ausgefuellt.xlsx')
    await wb.xlsx.writeFile(filledPath)

    const parsed = await parseClubFile(filledPath)
    expect(parsed.sheetName).toBe(TEMPLATE_SHEET_NAME)
    expect(parsed.missingColumns).toEqual([])
    expect(parsed.missingOptionalColumns).toEqual([])
    expect(parsed.totalRows).toBe(4)
    expect(parsed.validRows).toBe(4)
    expect(parsed.rows.flatMap((r) => r.errors)).toEqual([])
    expect(parsed.rows[0]).toMatchObject({ clubName: 'FF Musterdorf', zip: '01067', registeredPersons: 45 })
    expect(parsed.rows[3]).toMatchObject({ rowNumber: 6, clubName: 'Musikkapelle Fiktivried', registeredPersons: 30 })
  })

  describe('exportTemplate (mit Datenbank)', () => {
    let db: Db
    let festivalId: number
    beforeEach(() => {
      db = openDatabase(':memory:')
      festivalId = insertFestival(db, 'Gründungsfest 2025')
    })
    afterEach(() => db.close())

    it('schlägt „Anmeldung <Festname>.xlsx“ vor und liefert null bei Abbruch', async () => {
      const suggestions: Array<{ defaultPath: string; fileName: string }> = []
      const result = await exportTemplate(festivalId, undefined, {
        db,
        defaultDir: dir,
        chooseSavePath: async (s) => {
          suggestions.push(s)
          return null
        }
      })
      expect(result).toBeNull()
      expect(suggestions).toEqual([
        { defaultPath: join(dir, 'Anmeldung Gründungsfest 2025.xlsx'), fileName: 'Anmeldung Gründungsfest 2025.xlsx' }
      ])
    })

    it('schreibt die Datei (Endung wird ergänzt) und lässt sich mit prefill wieder importieren', async () => {
      createClub(
        festivalId,
        { contactName: 'Anna', clubName: 'FF Musterdorf', street: 'Weg 1', zip: '01067', city: 'Musterdorf', registeredPersons: 12 },
        db
      )
      createClub(
        festivalId,
        { contactName: '', clubName: 'TSV Beispielstadt', street: '', zip: '', city: '', registeredPersons: 0 },
        db
      )
      const target = join(dir, 'export')
      const path = await exportTemplate(festivalId, { prefill: true }, { db, chooseSavePath: async () => target })
      expect(path).toBe(`${target}.xlsx`)
      expect(existsSync(path!)).toBe(true)

      // Rundreise über den echten Import in ein anderes Fest
      const otherId = insertFestival(db, 'Neues Fest')
      const result = await commitImport(otherId, path!, db)
      expect(result).toMatchObject({ imported: 2, skipped: 0 })
      expect(listClubs(otherId, db).map((c) => [c.clubName, c.zip, c.registeredPersons])).toEqual([
        ['FF Musterdorf', '01067', 12],
        ['TSV Beispielstadt', '', 0]
      ])
    })

    it('ohne prefill bleibt die Vorlage leer', async () => {
      createClub(festivalId, { contactName: '', clubName: 'X', street: '', zip: '', city: '', registeredPersons: 1 }, db)
      const path = await exportTemplate(festivalId, {}, { db, chooseSavePath: async () => join(dir, 'leer.xlsx') })
      const parsed = await parseClubFile(path!)
      expect(parsed.totalRows).toBe(0)
      expect(parsed.missingColumns).toEqual([])
    })

    it('wirft bei unbekanntem Fest', async () => {
      await expect(exportTemplate(999, {}, { db, chooseSavePath: async () => null })).rejects.toThrow(
        'Das Gründungsfest wurde nicht gefunden.'
      )
    })
  })
})
