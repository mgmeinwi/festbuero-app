/**
 * Geldbeträge: immer Cent als Ganzzahl. Formatierung im deutschen Format `1.234,56 €`.
 * Plattformneutral (keine Node-/DOM-Abhängigkeiten).
 */
import type { Cents } from './types'

/** Geschütztes Leerzeichen zwischen Betrag und Währungszeichen. */
export const NBSP = ' '
/** Darstellung von Nullbeträgen in der Rechnung: „– €“ (Halbgeviertstrich). */
export const EURO_DASH = `–${NBSP}€`

function assertCents(cents: number): void {
  if (!Number.isSafeInteger(cents)) {
    throw new Error(`Ungültiger Betrag: ${String(cents)} (erwartet: Cent als Ganzzahl).`)
  }
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** Betrag ohne Währungszeichen, z. B. 123456 → "1.234,56", -13500 → "-135,00". */
export function formatAmount(cents: Cents): string {
  assertCents(cents)
  const negative = cents < 0
  const abs = Math.abs(cents)
  const euros = Math.floor(abs / 100)
  const rest = abs % 100
  const text = `${groupThousands(String(euros))},${String(rest).padStart(2, '0')}`
  return negative ? `-${text}` : text
}

/** 123456 → "1.234,56 €" (geschütztes Leerzeichen vor €), -13500 → "-135,00 €". */
export function formatEuro(cents: Cents): string {
  return `${formatAmount(cents)}${NBSP}€`
}

/** Wie `formatEuro`, aber 0 → "– €" (Darstellung von Nullbeträgen in der Rechnung). */
export function formatEuroOrDash(cents: Cents): string {
  assertCents(cents)
  return cents === 0 ? EURO_DASH : formatEuro(cents)
}

/**
 * Wandelt eine Benutzereingabe in Cent um. Akzeptiert u. a. „9,70“, „9,7“, „9.70“, „1.234,56“,
 * „1234,56“, „12“, „12 €“, „€ 12,50“, „-5,00“, „1,234.56“ (englisch).
 * Mehr als zwei Nachkommastellen oder sonst ungültige Eingaben → `null`.
 */
export function parseEuroToCents(input: string | number | null | undefined): Cents | null {
  if (input === null || input === undefined) return null
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null
    const cents = Math.round(input * 100)
    return Number.isSafeInteger(cents) ? cents : null
  }

  let s = input.replace(/€|EUR/gi, '').replace(/[\s  ']/g, '')
  if (s === '') return null

  let sign = 1
  if (s.startsWith('-') || s.startsWith('+')) {
    if (s.startsWith('-')) sign = -1
    s = s.slice(1)
  }
  // Minus hinter dem Betrag („5,00-“) wird ebenfalls toleriert
  if (s.endsWith('-')) {
    sign = -1
    s = s.slice(0, -1)
  }
  if (s === '' || !/^[\d.,]+$/.test(s)) return null

  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  let intPart: string
  let fracPart = ''

  if (lastComma >= 0 && lastDot >= 0) {
    // Beide Trennzeichen: das letzte ist das Dezimaltrennzeichen, das andere Tausendertrennzeichen
    const decimalSep = lastComma > lastDot ? ',' : '.'
    const thousandSep = decimalSep === ',' ? '.' : ','
    const idx = s.lastIndexOf(decimalSep)
    intPart = s.slice(0, idx)
    fracPart = s.slice(idx + 1)
    if (intPart.includes(decimalSep)) return null
    if (!isGrouped(intPart, thousandSep)) return null
    intPart = intPart.split(thousandSep).join('')
  } else if (lastComma >= 0) {
    const parts = s.split(',')
    if (parts.length !== 2) return null
    ;[intPart, fracPart] = parts as [string, string]
  } else if (lastDot >= 0) {
    const parts = s.split('.')
    if (parts.length > 2) {
      // „1.234.567“ → Tausendertrennzeichen
      if (!isGrouped(s, '.')) return null
      intPart = parts.join('')
    } else {
      const [a, b] = parts as [string, string]
      if (b.length === 3 && a.length > 0 && a !== '0') {
        // „1.234“ → deutsches Tausendertrennzeichen
        intPart = a + b
      } else {
        intPart = a
        fracPart = b
      }
    }
  } else {
    intPart = s
  }

  if (intPart === '' && fracPart === '') return null
  if (intPart !== '' && !/^\d+$/.test(intPart)) return null
  if (fracPart !== '' && !/^\d{1,2}$/.test(fracPart)) return null

  const euros = intPart === '' ? 0 : Number(intPart)
  const cents = euros * 100 + (fracPart === '' ? 0 : Number(fracPart.padEnd(2, '0')))
  if (!Number.isSafeInteger(cents)) return null
  return sign * cents === 0 ? 0 : sign * cents
}

function isGrouped(value: string, sep: string): boolean {
  if (!value.includes(sep)) return /^\d+$/.test(value)
  const escaped = sep === '.' ? '\\.' : sep
  return new RegExp(`^\\d{1,3}(${escaped}\\d{3})+$`).test(value)
}
