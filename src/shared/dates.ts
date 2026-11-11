/**
 * Datumsfunktionen. Datumswerte sind ISO-Strings `YYYY-MM-DD` (lokales Kalenderdatum, ohne Zeitzone).
 * Formatierung über date-fns mit deutscher Locale.
 */
import { addDays as dfAddDays, format as dfFormat, isValid } from 'date-fns'
import { de } from 'date-fns/locale'
import type { IsoDate } from './types'

/** Vordefinierte Varianten für Datums-Platzhalter, z. B. `{Rechnungsdatum_DE}`. */
export type DateVariant = 'Lang' | 'DE' | 'ISO' | 'Kurz'

export const DATE_VARIANTS: Record<DateVariant, { pattern: string; label: string; example: string }> = {
  Lang: { pattern: 'd. MMMM yyyy', label: 'ausgeschrieben', example: '1. Juni 2025' },
  DE: { pattern: 'dd.MM.yyyy', label: 'TT.MM.JJJJ', example: '01.06.2025' },
  ISO: { pattern: 'yyyy-MM-dd', label: 'ISO 8601', example: '2025-06-01' },
  Kurz: { pattern: 'd.M.yyyy', label: 'kurz', example: '1.6.2025' }
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Liefert die kanonische Variante (Groß-/Kleinschreibung egal) oder null. */
export function resolveDateVariant(value: string): DateVariant | null {
  const lower = value.trim().toLowerCase()
  for (const key of Object.keys(DATE_VARIANTS) as DateVariant[]) {
    if (key.toLowerCase() === lower) return key
  }
  return null
}

/** Formatiert ein `Date` als ISO-Datum in lokaler Zeit. */
export function toIsoDate(date: Date): IsoDate {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${String(y).padStart(4, '0')}-${m}-${d}`
}

/** Heutiges Datum (lokale Zeit) als `YYYY-MM-DD`. */
export function todayIso(now: Date = new Date()): IsoDate {
  return toIsoDate(now)
}

/** Prüft, ob ein String ein gültiges ISO-Datum `YYYY-MM-DD` ist (inkl. Kalenderprüfung). */
export function isValidIsoDate(value: unknown): value is IsoDate {
  return typeof value === 'string' && parseIsoDate(value) !== null
}

/** ISO-Datum → lokales `Date` (Mitternacht) oder null bei ungültiger Eingabe. */
export function parseIsoDate(iso: string): Date | null {
  const m = ISO_RE.exec(iso?.trim() ?? '')
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const date = new Date(y, mo - 1, d)
  date.setFullYear(y) // Jahre < 100 korrekt behandeln
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null
  return date
}

/** Addiert `days` Tage auf ein ISO-Datum. Ungültiges Datum → Fehler. */
export function addDays(iso: IsoDate, days: number): IsoDate {
  const date = parseIsoDate(iso)
  if (!date) throw new Error(`Ungültiges Datum: „${iso}“.`)
  if (!Number.isInteger(days)) throw new Error(`Ungültige Anzahl Tage: ${String(days)}.`)
  return toIsoDate(dfAddDays(date, days))
}

/**
 * Wandelt gängige, nicht date-fns-konforme Muster in date-fns-Muster um, z. B.
 * „DD.MM.YYYY“ / „TT.MM.JJJJ“ → „dd.MM.yyyy“; „dd.mm.yyyy“ → „dd.MM.yyyy“ (ohne Uhrzeit sind
 * Minuten sinnlos). Text in einfachen Anführungszeichen bleibt unverändert.
 */
export function normalizeDatePattern(pattern: string): string {
  const hasHour = /[HhKk]/.test(pattern.replace(/'[^']*'/g, ''))
  return pattern
    .split(/('[^']*'?)/)
    .map((part) => {
      if (part.startsWith("'")) return part
      let p = part
        .replace(/J{4}|Y{4}/g, 'yyyy')
        .replace(/J{2}|Y{2}/g, 'yy')
        .replace(/T{1,2}|D{1,2}/g, (m) => 'd'.repeat(m.length))
      if (!hasHour) p = p.replace(/m+/g, (m) => 'M'.repeat(m.length))
      return p
    })
    .join('')
}

/**
 * Formatiert ein ISO-Datum.
 * - `variant` = 'Lang' (Standard) → „1. Juni 2025“, 'DE' → „01.06.2025“, 'ISO' → „2025-06-01“,
 *   'Kurz' → „1.6.2025“ (Groß-/Kleinschreibung egal),
 * - oder ein beliebiges date-fns-Muster, z. B. „dd.MM.yy“, „d. MMMM yyyy“, „EEEE, d. MMMM“.
 * Ungültiges Muster → Fallback 'Lang' (keine Exception). Ungültiges Datum → Eingabe unverändert.
 */
export function formatDate(iso: IsoDate, variant: DateVariant | string = 'Lang'): string {
  const date = parseIsoDate(iso)
  if (!date || !isValid(date)) return iso ?? ''

  const known = resolveDateVariant(variant)
  if (known) return dfFormat(date, DATE_VARIANTS[known].pattern, { locale: de })

  const pattern = normalizeDatePattern(variant)
  if (pattern.trim() === '') return dfFormat(date, DATE_VARIANTS.Lang.pattern, { locale: de })
  try {
    return dfFormat(date, pattern, { locale: de })
  } catch {
    return dfFormat(date, DATE_VARIANTS.Lang.pattern, { locale: de })
  }
}

/** Zeitpunkt (ISO 8601) als „01.06.2025, 14:30“ in lokaler Zeit; ungültig → Eingabe. */
export function formatDateTime(isoDateTime: string | null | undefined): string {
  if (!isoDateTime) return ''
  const date = new Date(isoDateTime)
  if (!isValid(date)) return isoDateTime
  return dfFormat(date, 'dd.MM.yyyy, HH:mm', { locale: de })
}
