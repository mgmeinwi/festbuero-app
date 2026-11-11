/**
 * Reine Listenlogik der Vereinsseite: Suche, Sortierung, Kennzahlen, Texte.
 * Keine React-/DOM-Abhängigkeiten (Unit-Tests in `club-list.test.ts`).
 */
import type { Club, ClubImportPreview, ClubImportResult } from '@shared/types'

export type ClubSortKey = 'clubName' | 'contactName' | 'place' | 'registeredPersons' | 'status'
export type SortDirection = 'asc' | 'desc'
export interface ClubSort {
  key: ClubSortKey
  dir: SortDirection
}

export const DEFAULT_SORT: ClubSort = { key: 'clubName', dir: 'asc' }

const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true })

/** Für Suche und Namensvergleich: Kleinbuchstaben, ß = ss, ä = ae …, Akzente und Satzzeichen weg. */
export function foldText(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

function searchKey(value: string): string {
  return foldText(value).replace(/[^\p{L}\p{N}]+/gu, '')
}

/** Vergleichsschlüssel eines Vereinsnamens (wie im Main-Prozess: Satzzeichen/Leerzeichen egal). */
export function clubNameKey(name: string): string {
  return searchKey(name)
}

/** „PLZ Ort“ für die Anzeige. */
export function formatPlace(club: Pick<Club, 'zip' | 'city'>): string {
  return [club.zip, club.city].filter(Boolean).join(' ')
}

/**
 * Filtert über Verein, Ansprechpartner, Ort, PLZ und Straße. Jeder Suchbegriff (durch Leerzeichen
 * getrennt) muss in einem der Felder vorkommen; Groß-/Kleinschreibung, Umlaute und Satzzeichen egal.
 */
export function filterClubs(clubs: Club[], query: string): Club[] {
  const terms = query
    .split(/\s+/)
    .map(searchKey)
    .filter(Boolean)
  if (terms.length === 0) return clubs
  return clubs.filter((club) => {
    const fields = [club.clubName, club.contactName, club.city, club.zip, club.street].map(searchKey)
    return terms.every((term) => fields.some((field) => field.includes(term)))
  })
}

function compareBy(key: ClubSortKey, a: Club, b: Club): number {
  switch (key) {
    case 'clubName':
      return collator.compare(a.clubName, b.clubName)
    case 'contactName':
      return collator.compare(a.contactName, b.contactName)
    case 'place':
      return collator.compare(formatPlace(a), formatPlace(b))
    case 'registeredPersons':
      return a.registeredPersons - b.registeredPersons
    case 'status':
      return Number(b.hasInvoice) - Number(a.hasInvoice) || collator.compare(a.source, b.source)
  }
}

function isEmptyFor(key: ClubSortKey, club: Club): boolean {
  if (key === 'contactName') return club.contactName === ''
  if (key === 'place') return formatPlace(club) === ''
  return false
}

/** Sortiert stabil; leere Ansprechpartner/Orte stehen immer am Ende, Gleichstand nach Vereinsname. */
export function sortClubs(clubs: Club[], sort: ClubSort): Club[] {
  const factor = sort.dir === 'asc' ? 1 : -1
  return [...clubs].sort((a, b) => {
    const emptyA = isEmptyFor(sort.key, a)
    const emptyB = isEmptyFor(sort.key, b)
    if (emptyA !== emptyB) return emptyA ? 1 : -1
    return factor * compareBy(sort.key, a, b) || collator.compare(a.clubName, b.clubName) || a.id - b.id
  })
}

/** Klick auf eine Spaltenüberschrift: gleiche Spalte → Richtung wechseln, sonst aufsteigend. */
export function toggleSort(current: ClubSort, key: ClubSortKey): ClubSort {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: key === 'registeredPersons' || key === 'status' ? 'desc' : 'asc' }
}

export interface ClubStats {
  count: number
  persons: number
  imported: number
  manual: number
  withInvoice: number
}

export function clubStats(clubs: Club[]): ClubStats {
  return clubs.reduce<ClubStats>(
    (s, c) => ({
      count: s.count + 1,
      persons: s.persons + c.registeredPersons,
      imported: s.imported + (c.source === 'import' ? 1 : 0),
      manual: s.manual + (c.source === 'manual' ? 1 : 0),
      withInvoice: s.withInvoice + (c.hasInvoice ? 1 : 0)
    }),
    { count: 0, persons: 0, imported: 0, manual: 0, withInvoice: 0 }
  )
}

const numberFormat = new Intl.NumberFormat('de-DE')

export function formatNumber(n: number): string {
  return numberFormat.format(n)
}

/** „1 Verein“ / „3 Vereine“ */
export function plural(n: number, singular: string, pluralForm: string): string {
  return `${formatNumber(n)} ${n === 1 ? singular : pluralForm}`
}

/** Angemeldete Personen aus einem Eingabefeld: leer = 0, sonst ganze Zahl ≥ 0 (oder null = ungültig). */
export function parsePersonsInput(value: string): number | null {
  const t = value.trim()
  if (t === '') return 0
  if (!/^\d{1,6}$/.test(t)) return null
  return Number(t)
}

/** Dateiname aus einem Pfad (macOS und Windows). */
export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

/** Muss vor dem Import bestätigt werden? Nur wenn dabei Vereine ersetzt/gelöscht werden. */
export function importNeedsConfirmation(preview: ClubImportPreview): boolean {
  return preview.existingImportedCount > 0 || preview.replacedManualClubs.length > 0
}

/** Toast-Texte nach dem Import. */
export function importResultMessage(result: ClubImportResult): { title: string; description?: string } {
  const title = `${plural(result.imported, 'Verein', 'Vereine')} importiert`
  const parts: string[] = []
  const replaced = result.removedImported + result.removedManual
  if (replaced > 0) parts.push(`${plural(replaced, 'bisheriger Verein', 'bisherige Vereine')} ersetzt`)
  if (result.skipped > 0) parts.push(`${plural(result.skipped, 'fehlerhafte Zeile', 'fehlerhafte Zeilen')} übersprungen`)
  return parts.length > 0 ? { title, description: parts.join(' · ') } : { title }
}
