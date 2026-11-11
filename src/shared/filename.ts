/**
 * Datei- und Ordnernamen für die PDF-Ablage (`<Dokumentenordner>/<Festname>/Rechnungen/<Dateiname>.pdf`).
 * Unzulässige Zeichen für Windows und macOS werden ersetzt.
 */
import { findPlaceholders, replacePlaceholders, resolvePlaceholderField } from './placeholders'
import type { InvoiceRenderData } from './types'

/** Standard-Dateinamensmuster eines Fests. */
export const DEFAULT_FILENAME_PATTERN = '{Rechnungsnummer}'

/** Maximale Länge eines Datei-/Ordnernamens (ohne Endung) – Reserve für Pfad und „.pdf“ unter Windows. */
export const MAX_FILE_NAME_LENGTH = 120

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i
const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001F\u007F]/g

export type FilenamePatternValidation = { valid: true } | { valid: false; error: string }

/**
 * Prüft ein Dateinamensmuster: nicht leer, enthält `{Rechnungsnummer}` (damit Dateinamen eindeutig
 * bleiben), keine unbekannten Platzhalter, sinnvolle Länge.
 */
export function validateFilenamePattern(pattern: string): FilenamePatternValidation {
  const p = (pattern ?? '').trim()
  if (p === '') return { valid: false, error: 'Das Dateinamensmuster darf nicht leer sein.' }
  if (p.length > 200) return { valid: false, error: 'Das Dateinamensmuster ist zu lang (höchstens 200 Zeichen).' }
  const found = findPlaceholders(p)
  const unknown = found.filter((f) => !f.known)
  if (unknown.length > 0) {
    return {
      valid: false,
      error: `Unbekannter Platzhalter im Dateinamensmuster: ${unknown.map((u) => u.token).join(', ')}`
    }
  }
  const hasNumber = found.some((f) => resolvePlaceholderField(f.field) === 'Rechnungsnummer' && f.variant === undefined)
  if (!hasNumber) {
    return {
      valid: false,
      error: 'Das Dateinamensmuster muss {Rechnungsnummer} enthalten, damit Dateinamen eindeutig bleiben.'
    }
  }
  return { valid: true }
}

function truncate(value: string, maxLength: number): string {
  const chars = Array.from(value)
  return chars.length > maxLength ? chars.slice(0, maxLength).join('') : value
}

function cleanName(name: string, fallback: string, maxLength: number, replacement: string): string {
  let s = (name ?? '').normalize('NFC').replace(INVALID_CHARS, replacement)
  s = s.replace(/\s+/g, ' ').trim()
  // Keine führenden Punkte (versteckte Dateien unter macOS)
  s = s.replace(/^\.+/, '').trim()
  s = truncate(s, maxLength)
  // Keine Punkte/Leerzeichen am Ende (Windows)
  s = s.replace(/[. ]+$/, '')
  if (s === '' || /^[_\s.]*$/.test(s)) s = fallback
  const base = s.split('.')[0] ?? s
  if (WINDOWS_RESERVED.test(base.trim())) s = `_${s}`
  return s
}

/**
 * Macht einen beliebigen Text zum gültigen Dateinamen (ohne Endung) für Windows und macOS:
 * ersetzt `<>:"/\|?*` und Steuerzeichen, vermeidet reservierte Namen (CON, NUL, …),
 * entfernt Punkte/Leerzeichen am Ende und begrenzt die Länge.
 */
export function sanitizeFileName(name: string, replacement = '_'): string {
  return cleanName(name, 'Rechnung', MAX_FILE_NAME_LENGTH, replacement)
}

/** Wie `sanitizeFileName`, für Ordnernamen (z. B. den Festnamen). */
export function sanitizeFolderName(name: string, replacement = '_'): string {
  return cleanName(name, 'Gründungsfest', MAX_FILE_NAME_LENGTH, replacement)
}

/**
 * Dateiname (OHNE Endung) aus Muster und Rechnungsdaten. Datumsfelder ohne Variante werden als ISO
 * (`2025-06-01`) eingesetzt, damit Dateinamen sortierbar und frei von Sonderzeichen sind.
 */
export function buildPdfFileName(pattern: string, data: InvoiceRenderData): string {
  const effective = (pattern ?? '').trim() || DEFAULT_FILENAME_PATTERN
  const raw = replacePlaceholders(effective, data, { html: false, defaultDateVariant: 'ISO' })
  return sanitizeFileName(raw)
}
