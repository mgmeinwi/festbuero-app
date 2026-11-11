import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Tailwind-Klassen zusammenführen (shadcn/ui-Konvention). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** Fehlermeldung aus einem unbekannten Fehlerwert. */
export function errorMessage(err: unknown, fallback = 'Unbekannter Fehler.'): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err) return err
  return fallback
}

/** true auf macOS (für Tastenkürzel-Anzeige ⌘ vs. Strg). */
export const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent)

/** Anzeige des Modifiers für Tastenkürzel, z. B. `${modKey}+Enter`. */
export const modKey = isMac ? '⌘' : 'Strg'
