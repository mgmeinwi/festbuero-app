/**
 * SQL für den Vereinsstamm (Row ↔ Domänentyp). Zuständig: Bereich „Vereine“.
 *
 * `hasInvoice` wird abgeleitet: Es gibt eine abgeschlossene (nicht stornierte) Rechnung vom Typ
 * 'rechnung' des Fests, die diesem Verein zugeordnet ist. Zuordnung wie in der Auswertung
 * (`services/evaluation.ts#createClubResolver`), jede Rechnung zählt für genau einen Verein:
 *   1. gleiche ID (`invoice.club_id`) UND gleicher Vereinsname im Kunden-Snapshot,
 *   2. sonst gleicher Vereinsname (bei mehreren gleichnamigen Vereinen der erste nach Name,
 *      Ansprechpartner, ID).
 * Die ID allein genügt nicht: Nach Löschen/erneutem Import können IDs neu vergeben werden.
 * Vereinsnamen werden über `clubNameKey` verglichen (dieselbe Normalisierung wie beim Import).
 * Rechnungen tragen eigene Kopien der Kundendaten, deshalb gibt es keinen Fremdschlüssel –
 * Vereine dürfen auch mit Rechnungen gelöscht werden.
 */
import type { Club, ClubInput, ClubSource } from '@shared/types'
import { nowIso, type Db } from '../connection'

/* ------------------------------------------------------------------ */
/* Vereinsnamen vergleichen                                            */
/* ------------------------------------------------------------------ */

/** Entfernt Steuerzeichen, ersetzt geschützte Leerzeichen, fasst Leerraum zusammen und trimmt. */
export function cleanText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .normalize('NFC')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** ä → ae, ö → oe, ü → ue, ß → ss; übrige Akzente werden entfernt. */
export function transliterate(value: string): string {
  return value
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/**
 * Vergleichsschlüssel für Vereinsnamen (Namensgleichheit beim Import, Dubletten, `hasInvoice`):
 * Groß-/Kleinschreibung, Umlaute (ä = ae), ß = ss, Leerzeichen und Satzzeichen werden ignoriert.
 * „TSV Beispielstadt e. V.“ und „tsv beispielstadt e.V.“ gelten damit als gleich.
 */
export function clubNameKey(name: string): string {
  return transliterate(cleanText(name).toLowerCase()).replace(/[^\p{L}\p{N}]+/gu, '')
}

interface ClubRow {
  id: number
  festival_id: number
  contact_name: string
  club_name: string
  street: string
  zip: string
  city: string
  registered_persons: number
  source: ClubSource
}

const SELECT_CLUB = `
  SELECT c.id, c.festival_id, c.contact_name, c.club_name, c.street, c.zip, c.city,
         c.registered_persons, c.source
  FROM club c
`

export function mapClub(row: ClubRow, hasInvoice = false): Club {
  return {
    id: row.id,
    festivalId: row.festival_id,
    contactName: row.contact_name,
    clubName: row.club_name,
    street: row.street,
    zip: row.zip,
    city: row.city,
    registeredPersons: row.registered_persons,
    source: row.source,
    hasInvoice
  }
}

const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true })

/** Reihenfolge wie in der Auswertung: Vereinsname, Ansprechpartner, ID. */
function compareForResolve(a: Pick<Club, 'id' | 'clubName' | 'contactName'>, b: Pick<Club, 'id' | 'clubName' | 'contactName'>): number {
  return collator.compare(a.clubName, b.clubName) || collator.compare(a.contactName, b.contactName) || a.id - b.id
}

function parseSnapshot(json: string): { clubName: string; clubId: number | null } {
  try {
    const parsed = JSON.parse(json) as { clubName?: unknown; clubId?: unknown } | null
    return {
      clubName: typeof parsed?.clubName === 'string' ? parsed.clubName : '',
      clubId: typeof parsed?.clubId === 'number' ? parsed.clubId : null
    }
  } catch {
    return { clubName: '', clubId: null }
  }
}

/** IDs der Vereine eines Fests, denen eine nicht stornierte Rechnung zugeordnet ist (siehe Kopfkommentar). */
export function invoicedClubIds(
  db: Db,
  festivalId: number,
  clubs: Array<Pick<Club, 'id' | 'clubName' | 'contactName'>>
): Set<number> {
  const result = new Set<number>()
  if (clubs.length === 0) return result
  const refs = db
    .prepare(
      `SELECT club_id, customer_json FROM invoice
       WHERE festival_id = ? AND type = 'rechnung' AND status = 'abgeschlossen' AND customer_kind = 'verein'`
    )
    .all(festivalId) as Array<{ club_id: number | null; customer_json: string }>
  if (refs.length === 0) return result

  const byId = new Map(clubs.map((c) => [c.id, c]))
  const byKey = new Map<string, Pick<Club, 'id'>>()
  for (const club of [...clubs].sort(compareForResolve)) {
    const key = clubNameKey(club.clubName)
    if (key && !byKey.has(key)) byKey.set(key, club)
  }
  for (const ref of refs) {
    const snapshot = parseSnapshot(ref.customer_json)
    const key = clubNameKey(snapshot.clubName)
    const id = ref.club_id ?? snapshot.clubId
    const sameId = id !== null ? byId.get(id) : undefined
    if (sameId && key !== '' && clubNameKey(sameId.clubName) === key) {
      result.add(sameId.id)
      continue
    }
    const sameName = key ? byKey.get(key) : undefined
    if (sameName) result.add(sameName.id)
  }
  return result
}

export function festivalExists(db: Db, festivalId: number): boolean {
  return db.prepare('SELECT 1 FROM festival WHERE id = ?').get(festivalId) !== undefined
}

export function festivalName(db: Db, festivalId: number): string | null {
  const row = db.prepare('SELECT name FROM festival WHERE id = ?').get(festivalId) as { name: string } | undefined
  return row?.name ?? null
}

/** Alle Vereine eines Fests, alphabetisch nach Vereinsname, mit abgeleitetem `hasInvoice`. */
export function listClubs(db: Db, festivalId: number): Club[] {
  const rows = db
    .prepare(`${SELECT_CLUB} WHERE c.festival_id = ? ORDER BY c.club_name COLLATE NOCASE, c.id`)
    .all(festivalId) as ClubRow[]
  const clubs = rows.map((row) => mapClub(row))
  const invoiced = invoicedClubIds(db, festivalId, clubs)
  return invoiced.size === 0 ? clubs : clubs.map((c) => (invoiced.has(c.id) ? { ...c, hasInvoice: true } : c))
}

export function findClub(db: Db, id: number): Club | null {
  const row = db.prepare('SELECT festival_id FROM club WHERE id = ?').get(id) as { festival_id: number } | undefined
  if (!row) return null
  // `hasInvoice` hängt von allen Vereinen des Fests ab (gleichnamige Vereine)
  return listClubs(db, row.festival_id).find((c) => c.id === id) ?? null
}

export function insertClub(db: Db, festivalId: number, v: ClubInput, source: ClubSource): number {
  const now = nowIso()
  const result = db
    .prepare(
      `INSERT INTO club
        (festival_id, contact_name, club_name, street, zip, city, registered_persons, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(festivalId, v.contactName, v.clubName, v.street, v.zip, v.city, v.registeredPersons, source, now, now)
  return Number(result.lastInsertRowid)
}

const COLUMN_BY_FIELD: Record<keyof ClubInput, string> = {
  contactName: 'contact_name',
  clubName: 'club_name',
  street: 'street',
  zip: 'zip',
  city: 'city',
  registeredPersons: 'registered_persons'
}

/** Aktualisiert die angegebenen (bereits validierten) Felder. */
export function updateClubRow(db: Db, id: number, patch: Partial<ClubInput>): void {
  const sets: string[] = []
  const params: Array<string | number> = []
  for (const [field, value] of Object.entries(patch) as Array<[keyof ClubInput, string | number | undefined]>) {
    if (value === undefined) continue
    const column = COLUMN_BY_FIELD[field]
    if (!column) continue
    sets.push(`${column} = ?`)
    params.push(value)
  }
  if (sets.length === 0) return
  sets.push('updated_at = ?')
  params.push(nowIso())
  db.prepare(`UPDATE club SET ${sets.join(', ')} WHERE id = ?`).run(...params, id)
}

export function deleteClub(db: Db, id: number): number {
  return db.prepare('DELETE FROM club WHERE id = ?').run(id).changes
}

/** Löscht alle importierten Vereine eines Fests; liefert die Anzahl. */
export function deleteImportedClubs(db: Db, festivalId: number): number {
  return db.prepare("DELETE FROM club WHERE festival_id = ? AND source = 'import'").run(festivalId).changes
}

export function deleteClubsByIds(db: Db, ids: number[]): number {
  if (ids.length === 0) return 0
  const stmt = db.prepare('DELETE FROM club WHERE id = ?')
  let changes = 0
  for (const id of ids) changes += stmt.run(id).changes
  return changes
}

export function countImportedClubs(db: Db, festivalId: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM club WHERE festival_id = ? AND source = 'import'")
    .get(festivalId) as { n: number }
  return row.n
}

/** Vereine eines Fests mit der angegebenen Quelle (für die Ersetzungslogik beim Import). */
export function listClubNamesBySource(
  db: Db,
  festivalId: number,
  source: ClubSource
): Array<{ id: number; clubName: string }> {
  return db
    .prepare(
      'SELECT id, club_name AS clubName FROM club WHERE festival_id = ? AND source = ? ORDER BY club_name COLLATE NOCASE, id'
    )
    .all(festivalId, source) as Array<{ id: number; clubName: string }>
}

/**
 * Überschreibt alle Felder und die Quelle eines vorhandenen Vereins (Import ersetzt einen Verein
 * mit gleichem Namen). Die ID bleibt erhalten, damit Verweise aus Rechnungen (`club_id`) gültig bleiben.
 */
export function replaceClubRow(db: Db, id: number, v: ClubInput, source: ClubSource): void {
  db.prepare(
    `UPDATE club SET contact_name = ?, club_name = ?, street = ?, zip = ?, city = ?, registered_persons = ?,
       source = ?, updated_at = ?
     WHERE id = ?`
  ).run(v.contactName, v.clubName, v.street, v.zip, v.city, v.registeredPersons, source, nowIso(), id)
}
