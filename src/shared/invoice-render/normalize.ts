/**
 * Tolerantes Vervollständigen einer Vorlagenkonfiguration: fehlende oder ungültige Felder werden aus der
 * Standardvorlage ergänzt, Zahlen auf sinnvolle Bereiche begrenzt. So rendern auch ältere Snapshots
 * (abgeschlossene Rechnungen) oder teilweise gespeicherte Vorlagen immer vollständig.
 *
 * Die strenge Prüfung beim Speichern (`templates.update`) übernimmt der Main-Prozess (zod-Schema);
 * die Grenzen stehen hier, damit Editor und Main dieselben Werte verwenden.
 */
import type { InfoRow, LogoPosition, RichTextBlock, TemplateConfig, TextAlign } from '../types'
import { getDefaultTemplateConfig } from './default-template'
import { DEFAULT_FONT_ID, isFontId } from './fonts-meta'

export const TEMPLATE_LIMITS = {
  fontSizeMinPt: 5,
  fontSizeMaxPt: 48,
  logoWidthMinMm: 10,
  logoWidthMaxMm: 120,
  footerColumnsMin: 1,
  footerColumnsMax: 4,
  slotBlocksMax: 20,
  infoRowsMax: 10,
  /** Länge eines Rich-Text-Blocks (HTML) */
  htmlMaxLength: 20_000,
  /** Beschriftungen, Infozeilen */
  labelMaxLength: 200
} as const

export const TEXT_ALIGNS: readonly TextAlign[] = ['left', 'center', 'right', 'justify']
export const LOGO_POSITIONS: readonly LogoPosition[] = ['left', 'center', 'right']

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown, fallback: string, max: number = TEMPLATE_LIMITS.htmlMaxLength): string {
  return typeof value === 'string' ? value.slice(0, max) : fallback
}

export function clampFontSize(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const rounded = Math.round(value * 2) / 2
  return Math.min(TEMPLATE_LIMITS.fontSizeMaxPt, Math.max(TEMPLATE_LIMITS.fontSizeMinPt, rounded))
}

function align(value: unknown): TextAlign | undefined {
  return typeof value === 'string' && (TEXT_ALIGNS as readonly string[]).includes(value) ? (value as TextAlign) : undefined
}

function block(value: unknown, fallback: RichTextBlock, idFallback: string = fallback.id): RichTextBlock {
  if (!isObject(value)) return { ...fallback }
  const result: RichTextBlock = {
    id: typeof value.id === 'string' && value.id.trim() !== '' ? value.id.slice(0, 100) : idFallback,
    html: str(value.html, '')
  }
  const size = value.fontSizePt === undefined ? undefined : clampFontSize(value.fontSizePt)
  if (size !== undefined) result.fontSizePt = size
  const a = align(value.align)
  if (a) result.align = a
  return result
}

function blockList(value: unknown, fallback: RichTextBlock[], prefix: string, max: number): RichTextBlock[] {
  if (!Array.isArray(value)) return fallback.map((b) => ({ ...b }))
  const seen = new Set<string>()
  return value.slice(0, max).map((item, index) => {
    const b = block(item, { id: `${prefix}-${index + 1}`, html: '' }, `${prefix}-${index + 1}`)
    // IDs eindeutig halten (Sortierung im Editor)
    let id = b.id
    let n = 2
    while (seen.has(id)) id = `${b.id}-${n++}`
    seen.add(id)
    return { ...b, id }
  })
}

function infoRows(value: unknown, fallback: InfoRow[]): InfoRow[] {
  if (!Array.isArray(value)) return fallback.map((r) => ({ ...r }))
  const seen = new Set<string>()
  return value
    .filter(isObject)
    .slice(0, TEMPLATE_LIMITS.infoRowsMax)
    .map((row, index) => {
      let id = typeof row.id === 'string' && row.id.trim() !== '' ? row.id.slice(0, 100) : `info-${index + 1}`
      let n = 2
      while (seen.has(id)) id = `${id}-${n++}`
      seen.add(id)
      return {
        id,
        label: str(row.label, '', TEMPLATE_LIMITS.labelMaxLength),
        value: str(row.value, '', TEMPLATE_LIMITS.labelMaxLength)
      }
    })
}

function fmt(value: unknown, fallback: { fontSizePt?: number; align?: TextAlign } | undefined) {
  const src = isObject(value) ? value : (fallback ?? {})
  const result: { fontSizePt?: number; align?: TextAlign } = {}
  const size = clampFontSize(src.fontSizePt)
  if (size !== undefined) result.fontSizePt = size
  const a = align(src.align)
  if (a) result.align = a
  return result
}

/** Vervollständigt eine (evtl. unvollständige/ältere) Vorlagenkonfiguration. Wirft nie. */
export function normalizeTemplateConfig(input: unknown): TemplateConfig {
  const d = getDefaultTemplateConfig()
  if (!isObject(input)) return d
  const c = input

  const logo = isObject(c.logo) ? c.logo : {}
  const logoWidth =
    typeof logo.widthMm === 'number' && Number.isFinite(logo.widthMm)
      ? Math.min(TEMPLATE_LIMITS.logoWidthMaxMm, Math.max(TEMPLATE_LIMITS.logoWidthMinMm, Math.round(logo.widthMm)))
      : d.logo.widthMm
  const table = isObject(c.table) ? c.table : {}
  const labels = isObject(table.labels) ? table.labels : {}
  const slots = isObject(c.slots) ? c.slots : {}
  const info = isObject(c.info) ? c.info : {}
  const footer = isObject(c.footer) ? c.footer : {}
  const address = isObject(c.address) ? c.address : {}

  let footerColumns = blockList(footer.columns, d.footer.columns, 'footer', TEMPLATE_LIMITS.footerColumnsMax)
  if (footerColumns.length < TEMPLATE_LIMITS.footerColumnsMin) footerColumns = [{ id: 'footer-1', html: '' }]

  const label = (key: keyof TemplateConfig['table']['labels']): string =>
    str(labels[key], d.table.labels[key], TEMPLATE_LIMITS.labelMaxLength)

  const result: TemplateConfig = {
    version: 1,
    fontFamily: isFontId(c.fontFamily) ? c.fontFamily : DEFAULT_FONT_ID,
    baseFontSizePt: clampFontSize(c.baseFontSizePt) ?? d.baseFontSizePt,
    logo: {
      enabled: typeof logo.enabled === 'boolean' ? logo.enabled : d.logo.enabled,
      position:
        typeof logo.position === 'string' && (LOGO_POSITIONS as readonly string[]).includes(logo.position)
          ? (logo.position as LogoPosition)
          : d.logo.position,
      widthMm: logoWidth
    },
    returnLine: block(c.returnLine, d.returnLine),
    address: { fontSizePt: clampFontSize(address.fontSizePt) ?? d.address.fontSizePt },
    sender: block(c.sender, d.sender),
    info: {
      rows: infoRows(info.rows, d.info.rows),
      ...(clampFontSize(info.fontSizePt) !== undefined ? { fontSizePt: clampFontSize(info.fontSizePt) } : {})
    },
    subject: block(c.subject, d.subject),
    stornoSubject: block(c.stornoSubject, d.stornoSubject),
    intro: block(c.intro, d.intro),
    table: {
      showZeroQuantity: typeof table.showZeroQuantity === 'boolean' ? table.showZeroQuantity : d.table.showZeroQuantity,
      showVatColumn: typeof table.showVatColumn === 'boolean' ? table.showVatColumn : d.table.showVatColumn,
      labels: {
        name: label('name'),
        unitPrice: label('unitPrice'),
        quantity: label('quantity'),
        total: label('total'),
        vat: label('vat'),
        grandTotal: label('grandTotal')
      }
    },
    slots: {
      afterIntro: blockList(slots.afterIntro, d.slots.afterIntro, 'after-intro', TEMPLATE_LIMITS.slotBlocksMax),
      notes: blockList(slots.notes, d.slots.notes, 'note', TEMPLATE_LIMITS.slotBlocksMax),
      afterPayment: blockList(slots.afterPayment, d.slots.afterPayment, 'after-payment', TEMPLATE_LIMITS.slotBlocksMax)
    },
    payment: fmt(c.payment, d.payment),
    taxNote: fmt(c.taxNote, d.taxNote),
    footer: {
      columns: footerColumns,
      ...(clampFontSize(footer.fontSizePt) !== undefined ? { fontSizePt: clampFontSize(footer.fontSizePt) } : {})
    }
  }
  return result
}
