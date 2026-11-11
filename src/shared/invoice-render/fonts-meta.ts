/**
 * Metadaten der gebündelten Rechnungsschriften (ohne Schriftdaten) – für Editor-Auswahl, Normalisierung
 * und Main-Prozess. Die eingebetteten Schriftdateien selbst liegen in `fonts.ts`.
 *
 * Zuständig: Bereich „Vorlage“.
 */
import type { FontId } from '../types'

export interface FontMeta {
  id: FontId
  /** Anzeige im Editor */
  label: string
  /** Originalname der Schrift */
  family: string
  /** Systemschriften, falls ein Zeichen fehlt */
  fallback: string
}

export const FONT_META: Record<FontId, FontMeta> = {
  arimo: { id: 'arimo', label: 'Arimo (wie Arial)', family: 'Arimo', fallback: 'Arial, Helvetica, sans-serif' },
  tinos: { id: 'tinos', label: 'Tinos (wie Times New Roman)', family: 'Tinos', fallback: "'Times New Roman', Times, serif" },
  inter: { id: 'inter', label: 'Inter', family: 'Inter', fallback: 'Arial, Helvetica, sans-serif' },
  roboto: { id: 'roboto', label: 'Roboto', family: 'Roboto', fallback: 'Arial, Helvetica, sans-serif' },
  'open-sans': { id: 'open-sans', label: 'Open Sans', family: 'Open Sans', fallback: 'Arial, Helvetica, sans-serif' },
  lato: { id: 'lato', label: 'Lato', family: 'Lato', fallback: 'Arial, Helvetica, sans-serif' },
  'source-sans-3': { id: 'source-sans-3', label: 'Source Sans 3', family: 'Source Sans 3', fallback: 'Arial, Helvetica, sans-serif' }
}

/** Reihenfolge für die Auswahl im Editor. */
export const FONT_IDS: readonly FontId[] = ['arimo', 'tinos', 'inter', 'roboto', 'open-sans', 'lato', 'source-sans-3']

export const DEFAULT_FONT_ID: FontId = 'arimo'

export function isFontId(value: unknown): value is FontId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(FONT_META, value)
}

function meta(id: FontId): FontMeta {
  return FONT_META[isFontId(id) ? id : DEFAULT_FONT_ID]
}

/** CSS-Familienname im erzeugten HTML (mit Anführungszeichen), z. B. `"FB Arimo"`. */
export function fontFamilyName(id: FontId): string {
  return `"FB ${meta(id).family}"`
}

/** Vollständiger `font-family`-Wert inkl. Ersatzschriften. */
export function fontFamilyCss(id: FontId): string {
  return `${fontFamilyName(id)}, ${meta(id).fallback}`
}
