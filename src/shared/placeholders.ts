/**
 * Platzhalter in Vorlagen-, Zahlungs- und Dateinamentexten.
 *
 * Syntax:
 * - `{Feld}`, z. B. `{Rechnungsnummer}`, `{Verein}` (Groß-/Kleinschreibung egal, „ß/ä/ö/ü“ auch als
 *   „ss/ae/oe/ue“ zulässig).
 * - Datumsfelder mit Variante: `{Rechnungsdatum_Lang}`, `{Rechnungsdatum_DE}`, `{Rechnungsdatum_ISO}`,
 *   `{Rechnungsdatum_Kurz}` oder ein freies date-fns-Muster, z. B. `{Rechnungsdatum_dd.MM.yyyy}`,
 *   `{Heute_EEEE, d. MMMM}`. Ohne Variante = Lang („1. Juni 2025“).
 * - Unbekannte Platzhalter bleiben unverändert stehen.
 *
 * Im HTML (TipTap) können Platzhalter auch als Baustein vorkommen:
 * `<span data-placeholder="Rechnungsnummer">{Rechnungsnummer}</span>` – ersetzt wird der Text `{…}`.
 */
import { formatDate, type DateVariant } from './dates'
import { formatEuro } from './money'
import type { InvoiceRenderData } from './types'

export type PlaceholderGroup = 'Rechnung' | 'Datum' | 'Kunde' | 'Fest'

export interface PlaceholderDefinition {
  /** Einzufügender Text, z. B. "{Rechnungsdatum_DE}" */
  token: string
  /** Feldname ohne Klammern und ohne Variante, z. B. "Rechnungsdatum" */
  field: PlaceholderField
  /** Variante bei Datumsfeldern (undefined = Standard) */
  variant?: DateVariant
  /** Deutsche Beschriftung für „Feld einfügen“ */
  label: string
  group: PlaceholderGroup
  /** Beispielwert (Editor-Hilfe) */
  example: string
}

export const DATE_FIELDS = ['Rechnungsdatum', 'Leistungsdatum', 'Heute', 'Fälligkeitsdatum'] as const
export type DateField = (typeof DATE_FIELDS)[number]

export const TEXT_FIELDS = [
  'Rechnungsnummer',
  'Gesamtbetrag',
  'Verein',
  'Name',
  'Straße',
  'PLZ',
  'Ort',
  'Personen',
  'Zahlart',
  'Festname',
  'Originalrechnung',
  'Stornogrund'
] as const
export type TextField = (typeof TEXT_FIELDS)[number]

export type PlaceholderField = DateField | TextField

/** Text für die Rechnungsnummer, solange im Entwurf noch keine Nummer vergeben ist. */
export const NUMBER_PENDING_TEXT = '(wird vergeben)'

const DATE_EXAMPLES: Record<DateField, string> = {
  Rechnungsdatum: '2025-06-01',
  Leistungsdatum: '2025-06-01',
  Heute: '2025-06-01',
  Fälligkeitsdatum: '2025-06-08'
}

const DATE_LABELS: Record<DateField, string> = {
  Rechnungsdatum: 'Rechnungsdatum',
  Leistungsdatum: 'Leistungsdatum',
  Heute: 'Heutiges Datum',
  Fälligkeitsdatum: 'Fälligkeitsdatum'
}

const VARIANT_LABELS: Record<'Lang' | 'DE' | 'ISO', string> = {
  Lang: 'ausgeschrieben',
  DE: 'TT.MM.JJJJ',
  ISO: 'JJJJ-MM-TT'
}

function dateDefinitions(field: DateField): PlaceholderDefinition[] {
  const iso = DATE_EXAMPLES[field]
  const defs: PlaceholderDefinition[] = [
    { token: `{${field}}`, field, label: DATE_LABELS[field], group: 'Datum', example: formatDate(iso, 'Lang') }
  ]
  for (const variant of ['Lang', 'DE', 'ISO'] as const) {
    defs.push({
      token: `{${field}_${variant}}`,
      field,
      variant,
      label: `${DATE_LABELS[field]} (${VARIANT_LABELS[variant]})`,
      group: 'Datum',
      example: formatDate(iso, variant)
    })
  }
  return defs
}

/** Alle Platzhalter für den Button „Feld einfügen“ (Reihenfolge = Anzeige-Reihenfolge). */
export const PLACEHOLDERS: readonly PlaceholderDefinition[] = [
  { token: '{Rechnungsnummer}', field: 'Rechnungsnummer', label: 'Rechnungsnummer', group: 'Rechnung', example: '2025-081' },
  { token: '{Gesamtbetrag}', field: 'Gesamtbetrag', label: 'Gesamtbetrag', group: 'Rechnung', example: '670,20 €' },
  { token: '{Zahlart}', field: 'Zahlart', label: 'Zahlart', group: 'Rechnung', example: 'Bar' },
  {
    token: '{Originalrechnung}',
    field: 'Originalrechnung',
    label: 'Originalrechnung (nur Storno)',
    group: 'Rechnung',
    example: '2025-080'
  },
  {
    token: '{Stornogrund}',
    field: 'Stornogrund',
    label: 'Grund der Stornierung (nur Storno)',
    group: 'Rechnung',
    example: 'Falsche Personenzahl'
  },
  ...DATE_FIELDS.flatMap(dateDefinitions),
  { token: '{Verein}', field: 'Verein', label: 'Verein', group: 'Kunde', example: 'Musterverein e.V.' },
  { token: '{Name}', field: 'Name', label: 'Name (Ansprechpartner)', group: 'Kunde', example: 'Max Mustermann' },
  { token: '{Straße}', field: 'Straße', label: 'Straße', group: 'Kunde', example: 'Musterstraße 1' },
  { token: '{PLZ}', field: 'PLZ', label: 'PLZ', group: 'Kunde', example: '12345' },
  { token: '{Ort}', field: 'Ort', label: 'Ort', group: 'Kunde', example: 'Musterstadt' },
  { token: '{Personen}', field: 'Personen', label: 'Personen (kommend)', group: 'Kunde', example: '45' },
  { token: '{Festname}', field: 'Festname', label: 'Festname', group: 'Fest', example: '100-jähriges Gründungsfest' }
]

export const PLACEHOLDER_GROUPS: readonly PlaceholderGroup[] = ['Rechnung', 'Datum', 'Kunde', 'Fest']

/* ------------------------------------------------------------------ */
/* Werte & Ersetzung                                                   */
/* ------------------------------------------------------------------ */

/** Normalisiert Feldnamen für den toleranten Vergleich. */
function normalizeFieldName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
}

const FIELD_LOOKUP = new Map<string, PlaceholderField>(
  [...DATE_FIELDS, ...TEXT_FIELDS].map((f) => [normalizeFieldName(f), f])
)

/** Kanonischer Feldname zu einer (tolerant geschriebenen) Eingabe oder null. */
export function resolvePlaceholderField(name: string): PlaceholderField | null {
  return FIELD_LOOKUP.get(normalizeFieldName(name)) ?? null
}

export function isDateField(field: PlaceholderField): field is DateField {
  return (DATE_FIELDS as readonly string[]).includes(field)
}

export interface PlaceholderValues {
  /** Textfelder, fertig formatiert */
  text: Record<TextField, string>
  /** Datumsfelder als ISO-Datum */
  dates: Record<DateField, string>
}

/** Rohwerte für alle Platzhalter einer Rechnung. */
export function buildPlaceholderValues(data: InvoiceRenderData): PlaceholderValues {
  const c = data.customer
  return {
    text: {
      Rechnungsnummer: data.number ?? NUMBER_PENDING_TEXT,
      Gesamtbetrag: formatEuro(data.totals.grossCents),
      Verein: c.clubName ?? '',
      Name: c.contactName ?? '',
      Straße: c.street ?? '',
      PLZ: c.zip ?? '',
      Ort: c.city ?? '',
      Personen: data.persons === null || data.persons === undefined ? '' : String(data.persons),
      Zahlart: data.paymentLabel ?? '',
      Festname: data.festivalName ?? '',
      Originalrechnung: data.originalNumber ?? '',
      Stornogrund: data.stornoReason ?? ''
    },
    dates: {
      Rechnungsdatum: data.invoiceDate,
      Leistungsdatum: data.serviceDate,
      Heute: data.today,
      Fälligkeitsdatum: data.dueDate
    }
  }
}

export interface ReplaceOptions {
  /** true: Text ist HTML – eingesetzte Werte werden HTML-escaped, Entities in Varianten dekodiert. */
  html: boolean
  /** Variante für Datumsfelder ohne Angabe (Standard 'Lang'). Dateinamen nutzen z. B. 'ISO'. */
  defaultDateVariant?: DateVariant
}

/** `{Feld}` oder `{Feld_Variante}`; Feldname aus Buchstaben, Variante beliebig ohne Klammern. */
const PLACEHOLDER_RE = /\{([A-Za-zÄÖÜäöüß]+)(?:_([^{}]+))?\}/g

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Wert eines einzelnen Platzhalters oder null, wenn unbekannt. */
export function resolvePlaceholder(
  fieldName: string,
  variant: string | undefined,
  values: PlaceholderValues,
  defaultDateVariant: DateVariant = 'Lang'
): string | null {
  const field = resolvePlaceholderField(fieldName)
  if (!field) return null
  if (isDateField(field)) {
    const iso = values.dates[field]
    if (!iso) return ''
    return formatDate(iso, variant ?? defaultDateVariant)
  }
  if (variant !== undefined) return null // Textfelder haben keine Varianten
  return values.text[field]
}

/**
 * Ersetzt alle bekannten Platzhalter. Unbekannte bleiben unverändert stehen.
 * Bei `html: true` werden eingesetzte Werte HTML-escaped.
 */
export function replacePlaceholders(
  text: string,
  data: InvoiceRenderData | PlaceholderValues,
  options: ReplaceOptions = { html: false }
): string {
  if (!text) return ''
  const values = 'text' in data && 'dates' in data ? (data as PlaceholderValues) : buildPlaceholderValues(data as InvoiceRenderData)
  return text.replace(PLACEHOLDER_RE, (match, field: string, rawVariant: string | undefined) => {
    const variant = rawVariant === undefined ? undefined : options.html ? decodeBasicEntities(rawVariant) : rawVariant
    const value = resolvePlaceholder(field, variant, values, options.defaultDateVariant)
    if (value === null) return match
    return options.html ? escapeHtml(value) : value
  })
}

/** Liefert alle im Text vorkommenden Platzhalter-Tokens (inkl. unbekannter). */
export function findPlaceholders(text: string): Array<{ token: string; field: string; variant?: string; known: boolean }> {
  const result: Array<{ token: string; field: string; variant?: string; known: boolean }> = []
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    const field = m[1] ?? ''
    const variant = m[2]
    const resolved = resolvePlaceholderField(field)
    const known = resolved !== null && (variant === undefined || isDateField(resolved))
    result.push({ token: m[0], field, ...(variant !== undefined ? { variant } : {}), known })
  }
  return result
}
