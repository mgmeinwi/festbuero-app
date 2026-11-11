/**
 * Excel-Import des Vereinsstamms (exceljs). Zuständig: Bereich „Vereine“.
 *
 * Ablauf:
 * 1. Kopfzeile finden: In den ersten {@link HEADER_SCAN_ROWS} Zeilen jedes sichtbaren Blatts wird die
 *    Zeile mit den meisten erkannten Spaltennamen gesucht. Erkannt wird über den Namen (tolerant:
 *    Groß-/Kleinschreibung, Leerzeichen, Punkte, Umlaute, Varianten), nicht über die Position.
 *    Genommen wird das erste Blatt, dessen Kopfzeile beide Pflichtspalten enthält, sonst das erste
 *    Blatt mit einer erkennbaren Kopfzeile (dann mit `missingColumns`).
 * 2. Datenzeilen lesen: Zeilen, in denen alle erkannten Spalten leer sind, werden übersprungen
 *    (Zusatzspalten wie Nr, Rnr, Produkte, Betrag werden ignoriert). Fehlender Vereinsname, keine
 *    ganze Zahl bei Personen, zu lange Werte und Summenzeilen sind Fehler (Zeile wird nicht importiert).
 * 3. Dubletten innerhalb der Datei (gleicher Vereinsname, siehe `clubNameKey`):
 *    - komplett identische Zeile → Fehler (die Wiederholung wird nicht importiert),
 *    - gleicher Vereinsname mit abweichenden Angaben → Hinweis, beide Zeilen werden importiert
 *      (z. B. zwei Gruppen eines Vereins; das Festbüro wählt bei der Rechnung den passenden Eintrag).
 *
 * `commitImport` ersetzt in EINER Transaktion den importierten Vereinsstamm des Fests:
 * alle bisher importierten Vereine und manuell angelegte Vereine mit gleichem Namen wie ein
 * importierter werden ersetzt, alle anderen manuellen Vereine bleiben. Gibt es zu einer neuen Zeile
 * einen bisherigen Verein mit gleichem Namen, wird dessen Datensatz (ID) weiterverwendet und
 * überschrieben, damit Verweise aus Rechnungen (`hasInvoice`) über einen erneuten Import hinweg
 * erhalten bleiben. Rechnungen selbst bleiben unberührt (eigene Kopien der Kundendaten).
 */
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import ExcelJS from 'exceljs'
import type { ClubImportPreview, ClubImportResult, ClubImportRow, ClubInput } from '@shared/types'
import { getDb, type Db } from '../db/connection'
import * as repo from '../db/repositories/clubs'
import { cleanText, clubNameKey, MAX_PERSONS, MAX_TEXT_LENGTH, MAX_ZIP_LENGTH, transliterate } from './clubs'

/** Anzahl der Zeilen am Blattanfang, in denen die Kopfzeile gesucht wird. */
export const HEADER_SCAN_ROWS = 15

export type ClubField = keyof ClubInput

/** Spaltennamen, wie sie in Meldungen und in der Anmelde-Vorlage erscheinen. */
export const COLUMN_LABELS: Record<ClubField, string> = {
  contactName: 'Name',
  clubName: 'Verein',
  street: 'Straße',
  zip: 'PLZ',
  city: 'Ort',
  registeredPersons: 'ang. Personen'
}

/** Reihenfolge der Spalten (Vorlage, Meldungen). */
export const COLUMN_ORDER: readonly ClubField[] = ['contactName', 'clubName', 'street', 'zip', 'city', 'registeredPersons']
export const REQUIRED_FIELDS: readonly ClubField[] = ['clubName', 'registeredPersons']
export const OPTIONAL_FIELDS: readonly ClubField[] = ['contactName', 'street', 'zip', 'city']

/** Erkannte Spaltennamen (bereits normalisiert, siehe `normalizeHeader`). */
const HEADER_ALIASES: Record<ClubField, readonly string[]> = {
  contactName: [
    'name',
    'ansprechpartner',
    'ansprechpartnerin',
    'ansprechperson',
    'kontakt',
    'kontaktperson',
    'vornamename',
    'namevorname',
    'vorundnachname'
  ],
  clubName: ['verein', 'vereinsname', 'vereinname', 'vereinbezeichnung', 'vereinsbezeichnung'],
  street: ['strasse', 'str', 'strassenr', 'strassehausnummer', 'strasseundhausnummer', 'strassehausnr', 'anschrift', 'adresse'],
  zip: ['plz', 'postleitzahl', 'postleitzahlplz'],
  city: ['ort', 'wohnort', 'stadt', 'gemeinde', 'ortschaft'],
  registeredPersons: [
    'angpersonen',
    'angpers',
    'angemeldetepersonen',
    'angemeldetepers',
    'anzahlangemeldetepersonen',
    'personen',
    'personenzahl',
    'personenanzahl',
    'anzahlpersonen',
    'pers',
    'teilnehmer',
    'teilnehmerzahl',
    'anzahlteilnehmer',
    'angemeldet'
  ]
}

const FIELD_BY_ALIAS: ReadonlyMap<string, ClubField> = new Map(
  (Object.entries(HEADER_ALIASES) as Array<[ClubField, readonly string[]]>).flatMap(([field, aliases]) =>
    aliases.map((alias) => [alias, field] as const)
  )
)

/** Typische Beschriftungen von Summenzeilen in der Spalte „Verein“. */
const SUMMARY_KEYS = new Set(['summe', 'summen', 'gesamt', 'gesamtsumme', 'insgesamt', 'total', 'zwischensumme', 'endsumme'])

/**
 * Normalisiert einen Spaltennamen: Klammerzusätze weg, Kleinschreibung, Umlaute (ä → ae, ß → ss),
 * alle Leerzeichen, Punkte und sonstigen Zeichen entfernt. „  ang. Personen “ → „angpersonen“.
 */
export function normalizeHeader(value: string): string {
  return transliterate(cleanText(value).replace(/\([^)]*\)/g, ' ').toLowerCase()).replace(/[^a-z0-9]+/g, '')
}

/** Ordnet einen Spaltennamen einem Feld zu (oder null). */
export function matchHeader(value: string): ClubField | null {
  const key = normalizeHeader(value)
  return key ? (FIELD_BY_ALIAS.get(key) ?? null) : null
}

/* ------------------------------------------------------------------ */
/* Zellwerte                                                           */
/* ------------------------------------------------------------------ */

export type CellPrimitive = string | number | boolean | Date | null

/**
 * Liefert den eigentlichen Wert einer exceljs-Zelle: Zahl, Text, Wahrheitswert oder Datum.
 * Rich-Text wird zusammengesetzt, Formeln liefern ihr (gespeichertes) Ergebnis, Hyperlinks ihren
 * Text. Fehlerwerte (#NV, #BEZUG! …) und Formeln ohne Ergebnis gelten als leer.
 */
export function unwrapCellValue(value: unknown, depth = 0): CellPrimitive {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value !== 'object' || depth > 5) return null
  const v = value as Record<string, unknown>
  if (Array.isArray(v.richText)) {
    return v.richText
      .map((part: unknown) => {
        const text = (part as { text?: unknown } | null)?.text
        return typeof text === 'string' ? text : ''
      })
      .join('')
  }
  if ('formula' in v || 'sharedFormula' in v || 'result' in v) return unwrapCellValue(v.result, depth + 1)
  if ('text' in v || 'hyperlink' in v) return unwrapCellValue(v.text, depth + 1)
  return null
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Text einer Zelle (getrimmt). Datumswerte als TT.MM.JJJJ, ganze Zahlen ohne Nachkommastellen. */
export function cellText(value: CellPrimitive): string {
  if (value === null) return ''
  if (typeof value === 'string') return cleanText(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return ''
    return Number.isInteger(value) ? String(value) : String(value).replace('.', ',')
  }
  if (typeof value === 'boolean') return value ? 'WAHR' : 'FALSCH'
  // exceljs liefert Datumswerte in UTC
  return `${pad2(value.getUTCDate())}.${pad2(value.getUTCMonth() + 1)}.${value.getUTCFullYear()}`
}

/** Stellenzahl eines reinen Null-Zahlenformats wie `00000` (sonst 0). */
function zeroFormatWidth(numFmt: string | undefined): number {
  if (!numFmt) return 0
  const first = numFmt.split(';')[0] ?? ''
  const cleaned = first.replace(/\[[^\]]*\]/g, '').replace(/[\\"]/g, '')
  return /^0+$/.test(cleaned) ? cleaned.length : 0
}

/**
 * PLZ immer als Text. Zahlen werden umgewandelt; bei Zahlenformat `00000` (bzw. `0…0`) wird auf
 * dessen Stellenzahl aufgefüllt, sonst werden vierstellige Zahlen auf 5 Stellen aufgefüllt
 * (deutsche PLZ, z. B. 1067 → „01067“). Als Text eingegebene PLZ bleiben unverändert.
 */
export function parseZip(value: CellPrimitive, numFmt?: string): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return ''
    if (!Number.isInteger(value) || value < 0) return cellText(value)
    const digits = String(value)
    const width = zeroFormatWidth(numFmt)
    if (width > digits.length) return digits.padStart(width, '0')
    if (digits.length === 4) return digits.padStart(5, '0')
    return digits
  }
  return cellText(value)
}

/** Angemeldete Personen: ganze Zahl ≥ 0 (als Zahl oder Zahltext), sonst Fehlermeldung. */
export function parsePersons(value: CellPrimitive): { value: number | null; error?: string } {
  const text = cellText(value)
  if (text === '') return { value: null, error: 'Keine Zahl bei Personen (Feld ist leer).' }
  let n: number | null = null
  if (typeof value === 'number') {
    n = value
  } else if (typeof value === 'string') {
    if (!/^[+-]?\d+(?:[.,]\d+)?$/.test(text)) return { value: null, error: `Keine Zahl bei Personen („${text}“).` }
    n = Number(text.replace(',', '.'))
  } else {
    return { value: null, error: `Keine Zahl bei Personen („${text}“).` }
  }
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    return { value: null, error: `Personen müssen eine ganze Zahl ab 0 sein („${text}“).` }
  }
  if (n > MAX_PERSONS) return { value: null, error: `Zu viele Personen („${text}“, höchstens ${MAX_PERSONS}).` }
  return { value: n === 0 ? 0 : n }
}

/* ------------------------------------------------------------------ */
/* Kopfzeile                                                           */
/* ------------------------------------------------------------------ */

export interface HeaderMatch {
  rowNumber: number
  /** Spaltennummer (1-basiert) je erkanntem Feld */
  columns: Partial<Record<ClubField, number>>
}

function scoreHeader(match: HeaderMatch): [number, number] {
  const fields = Object.keys(match.columns) as ClubField[]
  return [fields.filter((f) => REQUIRED_FIELDS.includes(f)).length, fields.length]
}

function isRecognizable(match: HeaderMatch): boolean {
  const [required, total] = scoreHeader(match)
  return required > 0 || total >= 2
}

/** Sucht die beste Kopfzeile in den ersten Zeilen eines Blatts (oder null). */
export function findHeaderRow(ws: ExcelJS.Worksheet, scanRows = HEADER_SCAN_ROWS): HeaderMatch | null {
  let best: HeaderMatch | null = null
  const last = Math.min(scanRows, ws.rowCount)
  for (let r = 1; r <= last; r++) {
    const row = ws.findRow(r)
    if (!row) continue
    const columns: Partial<Record<ClubField, number>> = {}
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const field = matchHeader(cellText(unwrapCellValue(cell.value)))
      if (field && columns[field] === undefined) columns[field] = col
    })
    const match: HeaderMatch = { rowNumber: r, columns }
    if (!isRecognizable(match)) continue
    if (!best) {
      best = match
      continue
    }
    const [req, total] = scoreHeader(match)
    const [bestReq, bestTotal] = scoreHeader(best)
    if (req > bestReq || (req === bestReq && total > bestTotal)) best = match
  }
  return best
}

/* ------------------------------------------------------------------ */
/* Arbeitsmappe lesen                                                  */
/* ------------------------------------------------------------------ */

export interface ParsedClubFile {
  sheetName: string
  headerRow: number | null
  rows: ClubImportRow[]
  missingColumns: string[]
  missingOptionalColumns: string[]
  totalRows: number
  validRows: number
}

function readRow(row: ExcelJS.Row, rowNumber: number, columns: HeaderMatch['columns']): ClubImportRow | null {
  const raw = (field: ClubField): CellPrimitive => {
    const col = columns[field]
    return col ? unwrapCellValue(row.getCell(col).value) : null
  }
  const zipCol = columns.zip
  const values = {
    contactName: cellText(raw('contactName')),
    clubName: cellText(raw('clubName')),
    street: cellText(raw('street')),
    zip: zipCol ? parseZip(raw('zip'), row.getCell(zipCol).numFmt) : '',
    city: cellText(raw('city')),
    personsRaw: raw('registeredPersons')
  }
  const personsText = cellText(values.personsRaw)
  const empty =
    !values.contactName && !values.clubName && !values.street && !values.zip && !values.city && personsText === ''
  if (empty) return null

  const errors: string[] = []
  if (!values.clubName) {
    errors.push('Vereinsname fehlt.')
  } else if (SUMMARY_KEYS.has(clubNameKey(values.clubName))) {
    errors.push(`Summenzeile („${values.clubName}“) – wird nicht importiert.`)
  }
  for (const field of ['clubName', 'contactName', 'street', 'city'] as const) {
    if (values[field].length > MAX_TEXT_LENGTH) {
      errors.push(`${COLUMN_LABELS[field]} ist zu lang (höchstens ${MAX_TEXT_LENGTH} Zeichen).`)
    }
  }
  if (values.zip.length > MAX_ZIP_LENGTH) errors.push(`PLZ ist zu lang (höchstens ${MAX_ZIP_LENGTH} Zeichen).`)
  const persons = parsePersons(values.personsRaw)
  if (persons.error) errors.push(persons.error)

  return {
    rowNumber,
    contactName: values.contactName,
    clubName: values.clubName,
    street: values.street,
    zip: values.zip,
    city: values.city,
    registeredPersons: persons.value,
    errors
  }
}

function sameRowData(a: ClubImportRow, b: ClubImportRow): boolean {
  const k = (s: string) => cleanText(s).toLowerCase()
  return (
    clubNameKey(a.clubName) === clubNameKey(b.clubName) &&
    k(a.contactName) === k(b.contactName) &&
    k(a.street) === k(b.street) &&
    k(a.zip) === k(b.zip) &&
    k(a.city) === k(b.city) &&
    a.registeredPersons === b.registeredPersons
  )
}

/** Markiert Dubletten (siehe Kopfkommentar): identische Zeilen → Fehler, gleicher Name → Hinweis. */
export function markDuplicates(rows: ClubImportRow[]): void {
  const groups = new Map<string, ClubImportRow[]>()
  for (const row of rows) {
    if (row.errors.length > 0) continue
    const key = clubNameKey(row.clubName)
    const group = groups.get(key)
    if (group) group.push(row)
    else groups.set(key, [row])
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const distinct: ClubImportRow[] = []
    for (const row of group) {
      const original = distinct.find((d) => sameRowData(d, row))
      if (original) row.errors.push(`Doppelte Zeile: identisch mit Zeile ${original.rowNumber}.`)
      else distinct.push(row)
    }
    if (distinct.length < 2) continue
    for (const row of distinct) {
      const others = distinct.filter((d) => d !== row).map((d) => d.rowNumber)
      const warning = `Verein „${row.clubName}“ steht mehrfach in der Datei (auch Zeile ${others.join(', ')}).`
      row.warnings = [...(row.warnings ?? []), warning]
    }
  }
}

function visibleWorksheets(wb: ExcelJS.Workbook): ExcelJS.Worksheet[] {
  const visible = wb.worksheets.filter((ws) => ws.state !== 'hidden' && ws.state !== 'veryHidden')
  return visible.length > 0 ? visible : wb.worksheets
}

/** Liest eine geladene Arbeitsmappe (ohne Datenbank). */
export function parseClubWorkbook(wb: ExcelJS.Workbook): ParsedClubFile {
  const sheets = visibleWorksheets(wb)
  if (sheets.length === 0) throw new Error('Die Excel-Datei enthält keine Tabellenblätter.')

  let chosen: { ws: ExcelJS.Worksheet; header: HeaderMatch } | null = null
  let fallback: { ws: ExcelJS.Worksheet; header: HeaderMatch } | null = null
  for (const ws of sheets) {
    const header = findHeaderRow(ws)
    if (!header) continue
    if (REQUIRED_FIELDS.every((f) => header.columns[f] !== undefined)) {
      chosen = { ws, header }
      break
    }
    fallback ??= { ws, header }
  }
  const pick = chosen ?? fallback
  if (!pick) {
    return {
      sheetName: sheets[0]!.name,
      headerRow: null,
      rows: [],
      missingColumns: REQUIRED_FIELDS.map((f) => COLUMN_LABELS[f]),
      missingOptionalColumns: OPTIONAL_FIELDS.map((f) => COLUMN_LABELS[f]),
      totalRows: 0,
      validRows: 0
    }
  }

  const { ws, header } = pick
  const missingColumns = REQUIRED_FIELDS.filter((f) => header.columns[f] === undefined).map((f) => COLUMN_LABELS[f])
  const missingOptionalColumns = OPTIONAL_FIELDS.filter((f) => header.columns[f] === undefined).map(
    (f) => COLUMN_LABELS[f]
  )

  const rows: ClubImportRow[] = []
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= header.rowNumber) return
    const parsed = readRow(row, rowNumber, header.columns)
    if (parsed) rows.push(parsed)
  })
  if (missingColumns.length === 0) markDuplicates(rows)

  return {
    sheetName: ws.name,
    headerRow: header.rowNumber,
    rows,
    missingColumns,
    missingOptionalColumns,
    totalRows: rows.length,
    validRows: missingColumns.length === 0 ? rows.filter((r) => r.errors.length === 0).length : 0
  }
}

/** Lädt eine .xlsx-Datei mit verständlichen Fehlermeldungen. */
export async function loadWorkbook(filePath: string): Promise<ExcelJS.Workbook> {
  if (typeof filePath !== 'string' || filePath.trim() === '') throw new Error('Es wurde keine Datei angegeben.')
  const ext = extname(filePath).toLowerCase()
  if (ext === '.xls') {
    throw new Error(
      'Das alte Excel-Format (.xls) wird nicht unterstützt. Bitte die Datei in Excel öffnen und als „Excel-Arbeitsmappe (.xlsx)“ speichern.'
    )
  }
  if (ext === '.csv' || ext === '.ods' || ext === '.numbers') {
    throw new Error(`Dateien im Format ${ext} werden nicht unterstützt. Bitte die Datei als Excel-Arbeitsmappe (.xlsx) speichern.`)
  }
  if (ext !== '.xlsx' && ext !== '.xlsm') throw new Error('Bitte eine Excel-Datei im Format .xlsx wählen.')

  let buffer: Buffer
  try {
    buffer = await readFile(filePath)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') throw new Error('Die Datei wurde nicht gefunden. Wurde sie verschoben oder gelöscht?')
    if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
      throw new Error('Die Datei kann nicht gelesen werden. Ist sie noch in einem anderen Programm geöffnet?')
    }
    throw new Error('Die Datei konnte nicht gelesen werden.')
  }

  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer)
  } catch {
    throw new Error(
      'Die Datei konnte nicht gelesen werden. Ist es eine gültige Excel-Datei (.xlsx)? Passwortgeschützte Dateien werden nicht unterstützt.'
    )
  }
  return wb
}

export async function parseClubFile(filePath: string): Promise<ParsedClubFile> {
  return parseClubWorkbook(await loadWorkbook(filePath))
}

/* ------------------------------------------------------------------ */
/* Vorschau und Import                                                 */
/* ------------------------------------------------------------------ */

function requireFestival(db: Db, festivalId: number): void {
  if (!Number.isInteger(festivalId) || !repo.festivalExists(db, festivalId)) {
    throw new Error('Das Gründungsfest wurde nicht gefunden.')
  }
}

function validRowsOf(parsed: ParsedClubFile): ClubImportRow[] {
  return parsed.missingColumns.length > 0 ? [] : parsed.rows.filter((r) => r.errors.length === 0)
}

/** Manuell angelegte Vereine, deren Name einem gültigen Import-Verein entspricht. */
function manualClubsToReplace(db: Db, festivalId: number, valid: ClubImportRow[]): Array<{ id: number; clubName: string }> {
  const keys = new Set(valid.map((r) => clubNameKey(r.clubName)))
  return repo.listClubNamesBySource(db, festivalId, 'manual').filter((c) => keys.has(clubNameKey(c.clubName)))
}

/** Prüft die Datei und zeigt, was ein Import ändern würde (ohne etwas zu speichern). */
export async function previewImport(festivalId: number, filePath: string, db: Db = getDb()): Promise<ClubImportPreview> {
  requireFestival(db, festivalId)
  const parsed = await parseClubFile(filePath)
  const valid = validRowsOf(parsed)
  return {
    filePath,
    sheetName: parsed.sheetName,
    totalRows: parsed.totalRows,
    validRows: parsed.validRows,
    rows: parsed.rows,
    missingColumns: parsed.missingColumns,
    missingOptionalColumns: parsed.missingOptionalColumns,
    headerRow: parsed.headerRow,
    existingImportedCount: repo.countImportedClubs(db, festivalId),
    replacedManualClubs: manualClubsToReplace(db, festivalId, valid).map((c) => c.clubName)
  }
}

/** Schreibt die gültigen Zeilen in den Vereinsstamm (Ersetzungslogik siehe Kopfkommentar). */
export function applyImport(festivalId: number, parsed: ParsedClubFile, db: Db = getDb()): ClubImportResult {
  requireFestival(db, festivalId)
  if (parsed.missingColumns.length > 0) {
    throw new Error(`Import nicht möglich: Es fehlen Pflichtspalten (${parsed.missingColumns.join(', ')}).`)
  }
  const valid = validRowsOf(parsed)
  if (valid.length === 0) throw new Error('Die Datei enthält keine gültigen Vereine. Es wurde nichts geändert.')

  return db.transaction((): ClubImportResult => {
    const imported = repo.listClubNamesBySource(db, festivalId, 'import')
    const manual = manualClubsToReplace(db, festivalId, valid)
    // Wiederverwendbare Datensätze je Vereinsname: erst bisher importierte, dann manuelle
    const reusable = new Map<string, number[]>()
    for (const c of [...imported, ...manual]) {
      const key = clubNameKey(c.clubName)
      reusable.set(key, [...(reusable.get(key) ?? []), c.id])
    }
    const reused = new Set<number>()
    for (const row of valid) {
      const values: ClubInput = {
        contactName: row.contactName,
        clubName: row.clubName,
        street: row.street,
        zip: row.zip,
        city: row.city,
        registeredPersons: row.registeredPersons ?? 0
      }
      const id = reusable.get(clubNameKey(row.clubName))?.shift()
      if (id !== undefined) {
        repo.replaceClubRow(db, id, values, 'import')
        reused.add(id)
      } else {
        repo.insertClub(db, festivalId, values, 'import')
      }
    }
    repo.deleteClubsByIds(
      db,
      [...imported, ...manual].map((c) => c.id).filter((id) => !reused.has(id))
    )
    return {
      imported: valid.length,
      skipped: parsed.totalRows - valid.length,
      removedImported: imported.length,
      removedManual: manual.length
    }
  })()
}

/** Liest die Datei erneut und ersetzt den importierten Vereinsstamm (eine Transaktion). */
export async function commitImport(festivalId: number, filePath: string, db: Db = getDb()): Promise<ClubImportResult> {
  requireFestival(db, festivalId)
  const parsed = await parseClubFile(filePath)
  return applyImport(festivalId, parsed, db)
}
