/**
 * Rechnungsnummern: Präfix + laufende Zahl mit führenden Nullen, z. B. "2025-" + "081".
 */

/** Zulässige Stellenzahl (entspricht dem CHECK in der Datenbank). */
export const MIN_NUMBER_DIGITS = 1
export const MAX_NUMBER_DIGITS = 10

/**
 * Formatiert eine Rechnungsnummer. Zahlen, die länger als `digits` sind, werden NICHT abgeschnitten
 * (`formatInvoiceNumber('2025-', 1234, 3)` → "2025-1234").
 */
export function formatInvoiceNumber(prefix: string, seq: number, digits: number): string {
  if (!Number.isSafeInteger(seq) || seq < 0) {
    throw new Error(`Ungültige laufende Nummer: ${String(seq)}.`)
  }
  const width = Number.isInteger(digits) ? Math.min(Math.max(digits, 0), MAX_NUMBER_DIGITS) : 0
  return `${prefix ?? ''}${String(seq).padStart(width, '0')}`
}

/** Standard-Präfix für ein Festdatum, z. B. "2025-" für 2025-06-01. */
export function defaultNumberPrefix(festivalDate: string | null | undefined): string {
  const year = festivalDate && /^\d{4}/.test(festivalDate) ? festivalDate.slice(0, 4) : String(new Date().getFullYear())
  return `${year}-`
}
