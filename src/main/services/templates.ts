/**
 * Fachlogik Rechnungsvorlage: get, update (Schema-Prüfung mit zod), setLogo, getLogoDataUrl, resetToDefault.
 * Zuständig: Bereich „Vorlage“. Der Dateidialog (`pickLogo`) liegt im IPC-Modul.
 *
 * Logos: inhaltsadressiert unter `<userData>/logos/<sha256>.<ext>`; vorhandene Dateien werden nie
 * überschrieben und beim Entfernen nicht gelöscht (abgeschlossene Rechnungen können sie referenzieren).
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { z } from 'zod'
import { getDefaultTemplateConfig } from '@shared/invoice-render/default-template'
import { FONT_IDS } from '@shared/invoice-render/fonts-meta'
import { LOGO_POSITIONS, normalizeTemplateConfig, TEMPLATE_LIMITS, TEXT_ALIGNS } from '@shared/invoice-render/normalize'
import type { Template, TemplateConfig } from '@shared/types'
import { getDb, type Db } from '../db/connection'
import * as repo from '../db/repositories/templates'
import { getLogosDir } from '../env'

/** Erlaubte Bildformate für das Logo (Dateiendung → MIME-Typ). */
export const LOGO_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
  webp: 'image/webp'
}
export const LOGO_EXTENSIONS = Object.keys(LOGO_TYPES)
/** Höchstgröße einer Logodatei */
export const LOGO_MAX_BYTES = 5 * 1024 * 1024
/** Dateinamen im Logo-Ordner: `<sha256>.<ext>` (schützt vor Path-Traversal) */
const LOGO_FILE_RE = /^[a-f0-9]{64}\.(png|jpe?g|svg|webp)$/

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

const fontSize = z
  .number()
  .min(TEMPLATE_LIMITS.fontSizeMinPt, `Schriftgrößen müssen mindestens ${TEMPLATE_LIMITS.fontSizeMinPt} pt betragen.`)
  .max(TEMPLATE_LIMITS.fontSizeMaxPt, `Schriftgrößen dürfen höchstens ${TEMPLATE_LIMITS.fontSizeMaxPt} pt betragen.`)
const align = z.enum(TEXT_ALIGNS as [string, ...string[]])
const html = z.string().max(TEMPLATE_LIMITS.htmlMaxLength, 'Ein Textblock ist zu lang.')
const label = z.string().max(TEMPLATE_LIMITS.labelMaxLength, 'Eine Beschriftung ist zu lang.')

const richTextBlock = z.object({
  id: z.string().min(1).max(100),
  html,
  fontSizePt: fontSize.optional(),
  align: align.optional()
})
const blockList = (max: number) => z.array(richTextBlock).max(max, `Höchstens ${max} Textblöcke pro Bereich.`)

export const templateConfigSchema = z.object({
  version: z.literal(1),
  fontFamily: z.enum(FONT_IDS as [string, ...string[]], 'Unbekannte Schriftart.'),
  baseFontSizePt: fontSize,
  logo: z.object({
    enabled: z.boolean(),
    position: z.enum(LOGO_POSITIONS as [string, ...string[]]),
    widthMm: z
      .number()
      .min(TEMPLATE_LIMITS.logoWidthMinMm, `Das Logo muss mindestens ${TEMPLATE_LIMITS.logoWidthMinMm} mm breit sein.`)
      .max(TEMPLATE_LIMITS.logoWidthMaxMm, `Das Logo darf höchstens ${TEMPLATE_LIMITS.logoWidthMaxMm} mm breit sein.`)
  }),
  returnLine: richTextBlock,
  address: z.object({ fontSizePt: fontSize }),
  sender: richTextBlock,
  info: z.object({
    rows: z
      .array(z.object({ id: z.string().min(1).max(100), label, value: label }))
      .max(TEMPLATE_LIMITS.infoRowsMax, `Höchstens ${TEMPLATE_LIMITS.infoRowsMax} Infozeilen.`),
    fontSizePt: fontSize.optional()
  }),
  subject: richTextBlock,
  stornoSubject: richTextBlock,
  intro: richTextBlock,
  table: z.object({
    showZeroQuantity: z.boolean(),
    showVatColumn: z.boolean(),
    labels: z.object({ name: label, unitPrice: label, quantity: label, total: label, vat: label, grandTotal: label })
  }),
  slots: z.object({
    afterIntro: blockList(TEMPLATE_LIMITS.slotBlocksMax),
    notes: blockList(TEMPLATE_LIMITS.slotBlocksMax),
    afterPayment: blockList(TEMPLATE_LIMITS.slotBlocksMax)
  }),
  payment: z.object({ fontSizePt: fontSize.optional(), align: align.optional() }),
  taxNote: z.object({ fontSizePt: fontSize.optional(), align: align.optional() }).optional(),
  footer: z.object({
    columns: z
      .array(richTextBlock)
      .min(TEMPLATE_LIMITS.footerColumnsMin, 'Die Fußzeile braucht mindestens eine Spalte.')
      .max(TEMPLATE_LIMITS.footerColumnsMax, `Die Fußzeile hat höchstens ${TEMPLATE_LIMITS.footerColumnsMax} Spalten.`),
    fontSizePt: fontSize.optional()
  })
})

const germanErrors = z.locales.de().localeError

/** Prüft eine Vorlagenkonfiguration streng; wirft einen Fehler mit deutscher Meldung. */
export function validateTemplateConfig(input: unknown): TemplateConfig {
  const result = templateConfigSchema.safeParse(input, { error: germanErrors })
  if (!result.success) {
    const issue = result.error.issues[0]
    const where = issue && issue.path.length > 0 ? ` (Feld: ${issue.path.join('.')})` : ''
    throw new Error(`Die Vorlage ist ungültig: ${issue?.message ?? 'unbekannter Fehler'}${where}`)
  }
  // Normalisieren stellt eindeutige IDs und gerundete Werte sicher
  return normalizeTemplateConfig(result.data)
}

/* ------------------------------------------------------------------ */
/* Vorlage lesen/schreiben                                             */
/* ------------------------------------------------------------------ */

function parseConfig(json: string): TemplateConfig {
  try {
    return normalizeTemplateConfig(JSON.parse(json))
  } catch {
    return getDefaultTemplateConfig()
  }
}

function assertFestival(db: Db, festivalId: number): void {
  if (!Number.isInteger(festivalId) || !repo.festivalExists(db, festivalId)) {
    throw new Error('Das Gründungsfest wurde nicht gefunden.')
  }
}

/** Vorlage des Fests (legt die Standardvorlage an, falls sie fehlt). */
export function getTemplate(festivalId: number, db: Db = getDb()): Template {
  assertFestival(db, festivalId)
  let row = repo.findTemplateRow(db, festivalId)
  if (!row) {
    repo.insertTemplateIfMissing(db, festivalId, JSON.stringify(getDefaultTemplateConfig()))
    row = repo.findTemplateRow(db, festivalId)
    if (!row) throw new Error('Die Vorlage konnte nicht angelegt werden.')
  }
  return {
    id: row.id,
    festivalId: row.festival_id,
    config: parseConfig(row.config_json),
    logoFile: row.logo_file && LOGO_FILE_RE.test(row.logo_file) ? row.logo_file : null,
    updatedAt: row.updated_at
  }
}

/** Speichert die Vorlagenkonfiguration (nach Schema-Prüfung). */
export function updateTemplate(festivalId: number, config: TemplateConfig, db: Db = getDb()): Template {
  const valid = validateTemplateConfig(config)
  getTemplate(festivalId, db) // stellt sicher, dass Fest und Zeile existieren
  repo.updateTemplateConfig(db, festivalId, JSON.stringify(valid))
  return getTemplate(festivalId, db)
}

/** Setzt die Vorlage auf die Standard-Beispielvorlage zurück; das Logo bleibt erhalten. */
export function resetTemplate(festivalId: number, db: Db = getDb()): Template {
  getTemplate(festivalId, db)
  repo.updateTemplateConfig(db, festivalId, JSON.stringify(getDefaultTemplateConfig()))
  return getTemplate(festivalId, db)
}

/* ------------------------------------------------------------------ */
/* Logo                                                                */
/* ------------------------------------------------------------------ */

function detectImageType(buffer: Buffer, ext: string): boolean {
  if (ext === 'png') return buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (ext === 'jpg' || ext === 'jpeg') return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  if (ext === 'webp') return buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
  if (ext === 'svg') return /<svg[\s>]/i.test(buffer.toString('utf8', 0, Math.min(buffer.length, 4096)))
  return false
}

/**
 * Kopiert ein Bild inhaltsadressiert in den Logo-Ordner (nie überschreibend) und setzt es als Logo.
 * `null` entfernt nur die Referenz – die Datei bleibt erhalten.
 */
export function setLogo(
  festivalId: number,
  sourcePath: string | null,
  opts: { db?: Db; logosDir?: string } = {}
): Template {
  const db = opts.db ?? getDb()
  const current = getTemplate(festivalId, db)
  if (sourcePath === null) {
    repo.updateTemplateLogo(db, festivalId, null)
    return getTemplate(festivalId, db)
  }
  if (typeof sourcePath !== 'string' || sourcePath.trim() === '') throw new Error('Es wurde keine Bilddatei angegeben.')
  const ext = extname(sourcePath).slice(1).toLowerCase()
  if (!LOGO_TYPES[ext]) {
    throw new Error('Dieses Bildformat wird nicht unterstützt. Erlaubt sind PNG, JPG, SVG und WebP.')
  }
  let size: number
  try {
    size = statSync(sourcePath).size
  } catch {
    throw new Error('Die Bilddatei wurde nicht gefunden.')
  }
  if (size === 0) throw new Error('Die Bilddatei ist leer.')
  if (size > LOGO_MAX_BYTES) throw new Error('Die Bilddatei ist zu groß (höchstens 5 MB).')
  const buffer = readFileSync(sourcePath)
  if (!detectImageType(buffer, ext)) throw new Error('Die Datei ist kein gültiges Bild im angegebenen Format.')

  const normalizedExt = ext === 'jpeg' ? 'jpg' : ext
  const hash = createHash('sha256').update(buffer).digest('hex')
  const fileName = `${hash}.${normalizedExt}`
  const logosDir = opts.logosDir ?? getLogosDir()
  mkdirSync(logosDir, { recursive: true })
  const target = join(logosDir, fileName)
  if (!existsSync(target)) {
    try {
      writeFileSync(target, buffer, { flag: 'wx' })
    } catch (err) {
      // parallel angelegt → gleicher Inhalt (gleicher Hash), alles gut
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw new Error('Das Logo konnte nicht gespeichert werden.')
    }
  }
  // Logo nach dem Hochladen sichtbar machen
  const config = current.config.logo.enabled ? undefined : JSON.stringify({ ...current.config, logo: { ...current.config.logo, enabled: true } })
  repo.updateTemplateLogo(db, festivalId, fileName, config)
  return getTemplate(festivalId, db)
}

/** Logo als data:-URL; nur Dateinamen aus dem Logo-Ordner (kein Pfad). null, wenn nicht vorhanden. */
export function getLogoDataUrl(logoFile: string, logosDir: string = getLogosDir()): string | null {
  if (typeof logoFile !== 'string' || !LOGO_FILE_RE.test(logoFile)) return null
  const ext = logoFile.split('.').pop() ?? ''
  const mime = LOGO_TYPES[ext]
  if (!mime) return null
  const path = join(logosDir, logoFile)
  try {
    if (!existsSync(path)) return null
    return `data:${mime};base64,${readFileSync(path).toString('base64')}`
  } catch {
    return null
  }
}
