/**
 * Fachlogik Vereinsstamm (CRUD). Zuständig: Bereich „Vereine“.
 *
 * - Vereinsname ist Pflicht, angemeldete Personen sind eine ganze Zahl ≥ 0, die PLZ ist immer Text.
 * - Löschen ist auch erlaubt, wenn es Rechnungen gibt: Rechnungen tragen eigene Kopien der Daten.
 * - Import und Vorlagen-Export: `club-import.ts`, `club-template-export.ts`.
 */
import type { Club, ClubInput } from '@shared/types'
import { getDb, type Db } from '../db/connection'
import * as repo from '../db/repositories/clubs'
import { cleanText, clubNameKey, transliterate } from '../db/repositories/clubs'

export const MAX_TEXT_LENGTH = 200
export const MAX_ZIP_LENGTH = 20
export const MAX_PERSONS = 100_000

// Namensvergleich liegt im Repository (wird dort für `hasInvoice` gebraucht)
export { cleanText, clubNameKey, transliterate }

function checkLength(value: string, label: string, max = MAX_TEXT_LENGTH): void {
  if (value.length > max) throw new Error(`${label} ist zu lang (höchstens ${max} Zeichen).`)
}

/**
 * Bereinigt und prüft Vereinsangaben. Bei `partial` werden nur die angegebenen Felder geprüft.
 * Wirft `Error` mit deutscher Meldung.
 */
export function normalizeClubInput(input: Partial<ClubInput>, partial: true): Partial<ClubInput>
export function normalizeClubInput(input: Partial<ClubInput>, partial?: false): ClubInput
export function normalizeClubInput(input: Partial<ClubInput>, partial = false): Partial<ClubInput> {
  if (!input || typeof input !== 'object') throw new Error('Ungültige Angaben zum Verein.')
  const out: Partial<ClubInput> = {}

  if (!partial || input.clubName !== undefined) {
    const clubName = cleanText(input.clubName)
    if (!clubName) throw new Error('Bitte den Vereinsnamen angeben.')
    checkLength(clubName, 'Der Vereinsname')
    out.clubName = clubName
  }
  for (const [field, label] of [
    ['contactName', 'Der Name des Ansprechpartners'],
    ['street', 'Die Straße'],
    ['city', 'Der Ort']
  ] as const) {
    if (!partial || input[field] !== undefined) {
      const value = cleanText(input[field])
      checkLength(value, label)
      out[field] = value
    }
  }
  if (!partial || input.zip !== undefined) {
    // PLZ immer als Text (führende Nullen bleiben erhalten)
    const zip = cleanText(input.zip)
    checkLength(zip, 'Die PLZ', MAX_ZIP_LENGTH)
    out.zip = zip
  }
  if (!partial || input.registeredPersons !== undefined) {
    const raw = input.registeredPersons as unknown
    const persons = typeof raw === 'string' && /^\s*\d+\s*$/.test(raw) ? Number(raw) : raw
    if (typeof persons !== 'number' || !Number.isInteger(persons) || persons < 0) {
      throw new Error('Die angemeldeten Personen müssen eine ganze Zahl ab 0 sein.')
    }
    if (persons > MAX_PERSONS) throw new Error(`Die angemeldeten Personen dürfen höchstens ${MAX_PERSONS} sein.`)
    out.registeredPersons = persons
  }
  return out
}

function requireFestival(db: Db, festivalId: number): void {
  if (!Number.isInteger(festivalId) || !repo.festivalExists(db, festivalId)) {
    throw new Error('Das Gründungsfest wurde nicht gefunden.')
  }
}

export function listClubs(festivalId: number, db: Db = getDb()): Club[] {
  requireFestival(db, festivalId)
  return repo.listClubs(db, festivalId)
}

export function getClub(id: number, db: Db = getDb()): Club {
  const club = Number.isInteger(id) ? repo.findClub(db, id) : null
  if (!club) throw new Error('Der Verein wurde nicht gefunden.')
  return club
}

/** Legt einen Verein manuell an (`source = 'manual'`). */
export function createClub(festivalId: number, input: ClubInput, db: Db = getDb()): Club {
  requireFestival(db, festivalId)
  const values = normalizeClubInput(input)
  const id = repo.insertClub(db, festivalId, values, 'manual')
  return getClub(id, db)
}

/** Ändert einen Verein. Die Quelle (Import/Manuell) bleibt erhalten. */
export function updateClub(id: number, patch: Partial<ClubInput>, db: Db = getDb()): Club {
  getClub(id, db)
  const values = normalizeClubInput(patch ?? {}, true)
  repo.updateClubRow(db, id, values)
  return getClub(id, db)
}

/** Löscht einen Verein – auch wenn Rechnungen existieren (diese tragen eigene Kopien). */
export function deleteClub(id: number, db: Db = getDb()): void {
  getClub(id, db)
  repo.deleteClub(db, id)
}
