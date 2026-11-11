/**
 * Ablage der Rechnungs-PDFs im Dokumentenordner und Nachholen fehlender PDFs.
 *
 * Zuständig: Bereich „Abschluss & Druck“.
 *
 * Pfad: `<Dokumentenordner>/<Festname (Snapshot)>/Rechnungen/<Dateiname>.pdf`, Stornos unter `/Stornos/`.
 * - Abgelegte PDFs werden NIE überschrieben: existiert die Datei, wird „ (2)“, „ (3)“ … angehängt.
 * - Geschrieben wird atomar und exklusiv: erst vollständig in eine Temp-Datei im Zielordner, dann per
 *   Hardlink unter dem Zielnamen veröffentlicht (schlägt fehl, wenn der Name existiert). Wo Hardlinks
 *   nicht gehen (z. B. FAT/exFAT-Sticks), wird der Name exklusiv reserviert (`wx`) und die Temp-Datei
 *   per `rename` darübergelegt.
 */
import { randomBytes } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { buildPdfFileName, sanitizeFolderName } from '@shared/filename'
import { invoiceToRenderData } from '@shared/invoice-render'
import type { Invoice, InvoiceType } from '@shared/types'
import { getDb, nowIso, type Db } from '../db/connection'
import * as repo from '../db/repositories/invoices'
import { buildInvoiceHtml, renderHtmlToPdf } from './pdf'
import { getSettings } from './settings'

export const INVOICE_FOLDER = 'Rechnungen'
export const STORNO_FOLDER = 'Stornos'
/** Höchstzahl an Namensvarianten „ (2)“ … bevor aufgegeben wird */
const MAX_NAME_VARIANTS = 9999

export const NO_DOCUMENTS_DIR_MESSAGE = 'Bitte zuerst in den Einstellungen einen Dokumentenordner wählen.'

export interface PdfResult {
  ok: boolean
  path: string | null
  error?: string
}

/** Zielordner eines Belegs (ohne ihn anzulegen). */
export function filingDir(documentsDir: string, festivalName: string, type: InvoiceType): string {
  return join(documentsDir, sanitizeFolderName(festivalName), type === 'storno' ? STORNO_FOLDER : INVOICE_FOLDER)
}

/** Dateiname einer Variante: n = 1 → „081.pdf“, n = 2 → „081 (2).pdf“. */
export function variantFileName(baseName: string, n: number, ext = '.pdf'): string {
  return n <= 1 ? `${baseName}${ext}` : `${baseName} (${n})${ext}`
}

function isErrno(err: unknown, ...codes: string[]): boolean {
  return typeof err === 'object' && err !== null && codes.includes((err as NodeJS.ErrnoException).code ?? '')
}

function tryUnlink(path: string): void {
  try {
    unlinkSync(path)
  } catch {
    // ignorieren
  }
}

/** Prüft, ob der Dokumentenordner gesetzt ist und existiert. Liefert ihn oder wirft eine deutsche Meldung. */
export function requireDocumentsDir(documentsDir: string | null | undefined): string {
  if (!documentsDir || documentsDir.trim() === '') throw new Error(NO_DOCUMENTS_DIR_MESSAGE)
  let isDir = false
  try {
    isDir = statSync(documentsDir).isDirectory()
  } catch {
    isDir = false
  }
  if (!isDir) {
    throw new Error(
      `Der Dokumentenordner „${documentsDir}“ wurde nicht gefunden. Bitte in den Einstellungen prüfen ` +
        '(ist z. B. ein USB-Stick oder Netzlaufwerk getrennt?).'
    )
  }
  return documentsDir
}

/**
 * Schreibt `data` exklusiv nach `<dir>/<baseName>.pdf` bzw. „<baseName> (2).pdf“ … – überschreibt nie.
 * Legt `dir` an. Liefert den tatsächlich verwendeten Pfad.
 */
export function writeFileExclusive(dir: string, baseName: string, data: Buffer | Uint8Array, ext = '.pdf'): string {
  mkdirSync(dir, { recursive: true })
  const tmp = join(dir, `.${randomBytes(6).toString('hex')}.festbuero-tmp`)
  const fd = openSync(tmp, 'wx')
  try {
    let offset = 0
    while (offset < data.length) offset += writeSync(fd, data, offset, data.length - offset)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }

  let useLinks = true
  try {
    for (let n = 1; n <= MAX_NAME_VARIANTS; n++) {
      const target = join(dir, variantFileName(baseName, n, ext))
      if (useLinks) {
        try {
          linkSync(tmp, target)
          return target
        } catch (err) {
          if (isErrno(err, 'EEXIST')) continue
          if (!isErrno(err, 'EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV', 'EMLINK', 'EINVAL')) throw err
          useLinks = false // Dateisystem ohne Hardlinks → Reservieren + Umbenennen
        }
      }
      try {
        closeSync(openSync(target, 'wx'))
      } catch (err) {
        if (isErrno(err, 'EEXIST')) continue
        throw err
      }
      renameSync(tmp, target)
      return target
    }
    throw new Error(`Für „${baseName}${ext}“ konnte kein freier Dateiname gefunden werden.`)
  } finally {
    if (existsSync(tmp)) tryUnlink(tmp)
  }
}

/** Ist das PDF eines Belegs abgelegt und noch vorhanden? */
export function hasPdfFile(invoice: Pick<Invoice, 'pdfPath'>): boolean {
  return !!invoice.pdfPath && existsSync(invoice.pdfPath)
}

/** Dateiname (ohne Endung) eines Belegs nach dem Muster des Fests. */
export function pdfBaseName(invoice: Invoice, pattern: string): string {
  return buildPdfFileName(pattern, invoiceToRenderData(invoice))
}

/** Übersetzt typische Dateisystemfehler beim Ablegen in eine deutsche Meldung. */
export function describeFilingError(err: unknown, dir: string): string {
  const code = typeof err === 'object' && err !== null ? (err as NodeJS.ErrnoException).code : undefined
  switch (code) {
    case 'EACCES':
    case 'EPERM':
      return `Keine Schreibrechte im Ablageordner „${dir}“. Bitte den Dokumentenordner in den Einstellungen prüfen.`
    case 'EROFS':
      return `Der Ablageordner „${dir}“ ist schreibgeschützt.`
    case 'ENOSPC':
    case 'EDQUOT':
      return 'Auf dem Laufwerk des Dokumentenordners ist kein Speicherplatz mehr frei.'
    case 'ENOENT':
    case 'ENOTDIR':
      return `Der Ablageordner „${dir}“ ist nicht erreichbar.`
    case 'ENAMETOOLONG':
      return 'Der Pfad der PDF-Datei ist zu lang. Bitte einen kürzeren Festnamen oder ein kürzeres Dateinamensmuster wählen.'
    default:
      return err instanceof Error && err.message ? err.message : String(err)
  }
}

const inflight = new WeakMap<Db, Map<number, Promise<PdfResult>>>()

async function createAndFilePdf(id: number, db: Db): Promise<PdfResult> {
  const invoice = repo.findInvoice(db, id)
  if (!invoice) return { ok: false, path: null, error: 'Die Rechnung wurde nicht gefunden.' }
  if (hasPdfFile(invoice)) return { ok: true, path: invoice.pdfPath }
  let dir = ''
  try {
    const documentsDir = requireDocumentsDir(getSettings(db).documentsDir)
    const festival = repo.readFestival(db, invoice.festivalId)
    const baseName = pdfBaseName(invoice, festival?.filenamePattern ?? '{Rechnungsnummer}')
    dir = filingDir(documentsDir, invoice.festivalName, invoice.type)
    const pdf = await renderHtmlToPdf(buildInvoiceHtml(invoice))
    const path = writeFileExclusive(dir, baseName, pdf)
    repo.setPdf(db, id, path, nowIso())
    return { ok: true, path }
  } catch (err) {
    const message = describeFilingError(err, dir)
    console.error(`[pdf] Rechnung ${invoice.number}: ${message}`)
    return { ok: false, path: null, error: message }
  }
}

/**
 * Stellt sicher, dass das PDF eines Belegs abgelegt ist: fehlt es (Pfad leer oder Datei gelöscht),
 * wird es aus dem Snapshot erzeugt und abgelegt. Die Nummer bleibt. Wirft nicht.
 * Gleichzeitige Aufrufe für denselben Beleg teilen sich einen Job (keine doppelten Dateien).
 */
export function ensureInvoicePdf(id: number, db: Db = getDb()): Promise<PdfResult> {
  let byId = inflight.get(db)
  if (!byId) {
    byId = new Map()
    inflight.set(db, byId)
  }
  const running = byId.get(id)
  if (running) return running
  const job = createAndFilePdf(id, db).finally(() => byId.delete(id))
  byId.set(id, job)
  return job
}
