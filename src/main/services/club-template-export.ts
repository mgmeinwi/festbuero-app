/**
 * Anmelde-Vorlage (.xlsx) für den Vereinsstamm. Zuständig: Bereich „Vereine“.
 *
 * Die Vorlage kann z. B. an den Vorstand geschickt werden, der darin die Anmeldungen sammelt. Die
 * ausgefüllte Datei lässt sich unverändert wieder importieren (Rundreise, siehe Tests).
 *
 * - Blatt „Anmeldungen“: Kopfzeile `Name | Verein | Straße | PLZ | Ort | ang. Personen` (fett, fixiert,
 *   Autofilter), PLZ-Spalte im Textformat `@`, Datenüberprüfung „ganze Zahl ≥ 0“ für Personen,
 *   vorformatierte Zeilen. Optional mit den aktuellen Vereinen vorausgefüllt.
 * - Blatt „Hinweise“: kurze Ausfüllanleitung.
 *
 * Der Speichern-Dialog wird hereingereicht (`chooseSavePath`), damit dieser Dienst ohne Electron
 * testbar bleibt; `ipc/clubs.ts` übergibt `dialog.showSaveDialog`.
 */
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { formatDate, todayIso } from '@shared/dates'
import { sanitizeFileName } from '@shared/filename'
import type { Club } from '@shared/types'
import { getDb, type Db } from '../db/connection'
import * as repo from '../db/repositories/clubs'
import { COLUMN_LABELS, COLUMN_ORDER, type ClubField } from './club-import'

export const TEMPLATE_SHEET_NAME = 'Anmeldungen'
export const HINTS_SHEET_NAME = 'Hinweise'
/** Mindestzahl vorformatierter Datenzeilen (PLZ als Text, Datenüberprüfung, Rahmen). */
export const TEMPLATE_MIN_ROWS = 300
/** Zusätzliche leere, vorformatierte Zeilen unter vorausgefüllten Vereinen. */
export const TEMPLATE_EXTRA_ROWS = 100

const COLUMN_WIDTHS: Record<ClubField, number> = {
  contactName: 28,
  clubName: 36,
  street: 30,
  zip: 10,
  city: 24,
  registeredPersons: 15
}

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF5' } }
const GRID_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFD5DCE4' } },
  left: { style: 'thin', color: { argb: 'FFD5DCE4' } },
  bottom: { style: 'thin', color: { argb: 'FFD5DCE4' } },
  right: { style: 'thin', color: { argb: 'FFD5DCE4' } }
}

const PERSONS_VALIDATION: ExcelJS.DataValidation = {
  type: 'whole',
  operator: 'greaterThanOrEqual',
  allowBlank: true,
  formulae: [0],
  showErrorMessage: true,
  errorStyle: 'stop',
  errorTitle: 'Ungültige Personenzahl',
  error: 'Bitte eine ganze Zahl ab 0 eingeben, z. B. 25 (ohne Zusätze wie „ca.“).',
  showInputMessage: true,
  promptTitle: 'ang. Personen',
  prompt: 'Anzahl der angemeldeten Personen als ganze Zahl.'
}

/** `worksheet.dataValidations` existiert in exceljs, fehlt aber in den Typdefinitionen. */
function dataValidationsOf(ws: ExcelJS.Worksheet): { add(address: string, validation: ExcelJS.DataValidation): void } {
  return (ws as unknown as { dataValidations: { add(address: string, validation: ExcelJS.DataValidation): void } })
    .dataValidations
}

function columnLetter(col: number): string {
  return String.fromCharCode('A'.charCodeAt(0) + col - 1)
}

export interface TemplateOptions {
  festivalName: string
  /** Vereine zum Vorausfüllen (leer/undefiniert = leere Vorlage) */
  clubs?: Club[]
  /** für deterministische Tests */
  now?: Date
}

/** Dateiname-Vorschlag „Anmeldung <Festname>.xlsx“. */
export function templateFileName(festivalName: string): string {
  const name = sanitizeFileName(`Anmeldung ${festivalName.trim()}`.trim())
  return `${name}.xlsx`
}

function buildRegistrationSheet(wb: ExcelJS.Workbook, clubs: Club[]): void {
  const ws = wb.addWorksheet(TEMPLATE_SHEET_NAME, {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1, topLeftCell: 'A2', activeCell: 'A2' }],
    properties: { defaultRowHeight: 18 },
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 }
  })
  ws.columns = COLUMN_ORDER.map((field) => ({
    key: field,
    width: COLUMN_WIDTHS[field],
    style: field === 'zip' ? { numFmt: '@' } : field === 'registeredPersons' ? { numFmt: '0' } : {}
  }))

  const header = ws.getRow(1)
  COLUMN_ORDER.forEach((field, i) => {
    const cell = header.getCell(i + 1)
    cell.value = COLUMN_LABELS[field]
    cell.font = { bold: true }
    cell.fill = HEADER_FILL
    cell.border = { ...GRID_BORDER, bottom: { style: 'medium', color: { argb: 'FF8796A8' } } }
    cell.alignment = { vertical: 'middle', horizontal: field === 'registeredPersons' ? 'right' : 'left' }
  })
  header.height = 22
  ws.pageSetup.printTitlesRow = '1:1'

  const sorted = [...clubs].sort((a, b) => a.clubName.localeCompare(b.clubName, 'de', { sensitivity: 'base' }))
  const rowCount = Math.max(TEMPLATE_MIN_ROWS, sorted.length + TEMPLATE_EXTRA_ROWS)
  const zipCol = COLUMN_ORDER.indexOf('zip') + 1
  const personsCol = COLUMN_ORDER.indexOf('registeredPersons') + 1

  for (let i = 0; i < rowCount; i++) {
    const r = i + 2
    const row = ws.getRow(r)
    const club = sorted[i]
    if (club) {
      row.getCell(1).value = club.contactName || null
      row.getCell(2).value = club.clubName
      row.getCell(3).value = club.street || null
      row.getCell(zipCol).value = club.zip || null // Text, führende Nullen bleiben erhalten
      row.getCell(5).value = club.city || null
      row.getCell(personsCol).value = club.registeredPersons
    }
    for (let c = 1; c <= COLUMN_ORDER.length; c++) row.getCell(c).border = GRID_BORDER
    const zipCell = row.getCell(zipCol)
    zipCell.numFmt = '@'
    const personsCell = row.getCell(personsCol)
    personsCell.numFmt = '0'
    personsCell.alignment = { horizontal: 'right' }
  }

  // Datenüberprüfung als EIN Bereich: exceljs fasst Einzelzellen-Regeln fehlerhaft zu überlappenden
  // Bereichen zusammen (F10:F301 + F2:F301), was Excel als beschädigte Datei meldet.
  const personsLetter = columnLetter(personsCol)
  dataValidationsOf(ws).add(`${personsLetter}2:${personsLetter}${rowCount + 1}`, PERSONS_VALIDATION)

  ws.autoFilter = `A1:${columnLetter(COLUMN_ORDER.length)}${rowCount + 1}`
}

function buildHintsSheet(wb: ExcelJS.Workbook, festivalName: string, prefilled: number, now: Date): void {
  const ws = wb.addWorksheet(HINTS_SHEET_NAME, { properties: { defaultRowHeight: 18 } })
  ws.getColumn(1).width = 100

  const lines: Array<{ text: string; style?: 'title' | 'heading' | 'muted' }> = [
    { text: `Anmeldung zum ${festivalName}`.trim(), style: 'title' },
    { text: '' },
    { text: 'So füllen Sie die Liste aus', style: 'heading' },
    { text: `1. Tragen Sie im Blatt „${TEMPLATE_SHEET_NAME}“ jeden Verein in eine eigene Zeile ein.` },
    { text: '2. Name: Ansprechpartnerin bzw. Ansprechpartner des Vereins (erscheint auf der Rechnung).' },
    { text: '3. Verein: vollständiger Vereinsname – Pflichtfeld.' },
    { text: '4. Straße, PLZ, Ort: Rechnungsanschrift des Vereins. Die PLZ bitte mit führender Null eingeben, z. B. 01067.' },
    { text: '5. ang. Personen: Anzahl der angemeldeten Personen als ganze Zahl, ohne Zusätze wie „ca.“ – Pflichtfeld.' },
    { text: '' },
    { text: 'Bitte beachten', style: 'heading' },
    { text: '• Die Spaltenüberschriften in Zeile 1 bitte nicht ändern und keine Spalten löschen.' },
    { text: '• Zusätzliche Spalten (z. B. Bemerkungen) dürfen rechts angefügt werden, sie werden beim Einlesen ignoriert.' },
    { text: '• Leere Zeilen sind kein Problem. Bitte keine Summenzeile eintragen.' },
    { text: '• Die Datei als Excel-Arbeitsmappe (.xlsx) speichern und an das Festbüro zurückschicken.' }
  ]
  if (prefilled > 0) {
    lines.push(
      { text: '' },
      {
        text: `Die Liste enthält bereits ${prefilled === 1 ? 'einen bekannten Verein' : `${prefilled} bekannte Vereine`}. Bitte prüfen, korrigieren und ergänzen.`
      }
    )
  }
  lines.push({ text: '' }, { text: `Erstellt am ${formatDate(todayIso(now), 'DE')} mit der Festbüro-App.`, style: 'muted' })

  lines.forEach((line, i) => {
    const cell = ws.getCell(i + 1, 1)
    cell.value = line.text || null
    cell.alignment = { wrapText: true, vertical: 'top' }
    if (line.style === 'title') cell.font = { bold: true, size: 16 }
    else if (line.style === 'heading') cell.font = { bold: true, size: 12 }
    else if (line.style === 'muted') cell.font = { italic: true, color: { argb: 'FF6B7785' } }
  })
  ws.getRow(1).height = 26
}

/** Baut die Arbeitsmappe der Anmelde-Vorlage. */
export function buildTemplateWorkbook(opts: TemplateOptions): ExcelJS.Workbook {
  const now = opts.now ?? new Date()
  const clubs = opts.clubs ?? []
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Festbüro'
  wb.lastModifiedBy = 'Festbüro'
  wb.title = `Anmeldung ${opts.festivalName}`.trim()
  wb.created = now
  wb.modified = now
  buildRegistrationSheet(wb, clubs)
  buildHintsSheet(wb, opts.festivalName, clubs.length, now)
  wb.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 0, visibility: 'visible' }]
  return wb
}

/** Schreibt die Vorlage nach `filePath` (deutsche Fehlermeldungen). */
export async function writeTemplateFile(filePath: string, opts: TemplateOptions): Promise<void> {
  const wb = buildTemplateWorkbook(opts)
  try {
    await wb.xlsx.writeFile(filePath)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
      throw new Error(
        'Die Datei konnte nicht gespeichert werden. Ist sie noch in Excel geöffnet oder fehlt die Schreibberechtigung?'
      )
    }
    if (code === 'ENOENT') throw new Error('Der Zielordner existiert nicht.')
    throw new Error('Die Anmelde-Vorlage konnte nicht gespeichert werden.')
  }
}

export interface ExportTemplateDeps {
  /** Speichern-Dialog: liefert den gewählten Pfad oder null bei Abbruch */
  chooseSavePath: (suggestion: { defaultPath: string; fileName: string }) => Promise<string | null>
  /** Ordner für den Dateinamensvorschlag (z. B. Dokumentenordner) */
  defaultDir?: string | null
  db?: Db
}

/**
 * Öffnet den Speichern-Dialog (Vorschlag „Anmeldung <Festname>.xlsx“) und schreibt die Vorlage.
 * Liefert den Pfad oder null bei Abbruch.
 */
export async function exportTemplate(
  festivalId: number,
  opts: { prefill?: boolean } | undefined,
  deps: ExportTemplateDeps
): Promise<string | null> {
  const db = deps.db ?? getDb()
  const name = Number.isInteger(festivalId) ? repo.festivalName(db, festivalId) : null
  if (name === null) throw new Error('Das Gründungsfest wurde nicht gefunden.')
  const clubs = opts?.prefill ? repo.listClubs(db, festivalId) : []

  const fileName = templateFileName(name)
  const defaultPath = deps.defaultDir ? join(deps.defaultDir, fileName) : fileName
  let target = await deps.chooseSavePath({ defaultPath, fileName })
  if (!target) return null
  if (!/\.xlsx$/i.test(target)) target = `${target}.xlsx`

  await writeTemplateFile(target, { festivalName: name, clubs })
  return target
}
