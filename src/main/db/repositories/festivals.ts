/**
 * SQL für Gründungsfeste (Row ↔ Domänentyp).
 *
 * Basis-Version (Bereich „Basis“); wird vom Bereich „Fest-Einstellungen“ übernommen und erweitert.
 * Enthält vorerst auch die Anlage der Standard-Zahlungsarten und der Vorlagen-Zeile beim Anlegen
 * eines Fests (bis die Repositories `payment-methods.ts` / `templates.ts` existieren).
 */
import type { Festival, FestivalUpdateInput, PaymentKind, TemplateConfig } from '@shared/types'
import { nowIso, type Db } from '../connection'

interface FestivalRow {
  id: number
  name: string
  festival_date: string
  number_prefix: string
  number_start: number
  number_next: number
  number_digits: number
  copies: number
  tax_exempt: number
  tax_exempt_text: string
  filename_pattern: string
  archived: number
  created_at: string
  updated_at: string
  has_invoices: number
}

const SELECT_FESTIVAL = `
  SELECT f.*, EXISTS (SELECT 1 FROM invoice i WHERE i.festival_id = f.id) AS has_invoices
  FROM festival f
`

export function mapFestival(row: FestivalRow): Festival {
  return {
    id: row.id,
    name: row.name,
    festivalDate: row.festival_date,
    numberPrefix: row.number_prefix,
    numberStart: row.number_start,
    numberNext: row.number_next,
    numberDigits: row.number_digits,
    copies: row.copies,
    taxExempt: row.tax_exempt === 1,
    taxExemptText: row.tax_exempt_text,
    filenamePattern: row.filename_pattern,
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hasInvoices: row.has_invoices === 1
  }
}

export function listFestivals(db: Db, opts: { includeArchived?: boolean } = {}): Festival[] {
  const where = opts.includeArchived ? '' : 'WHERE f.archived = 0'
  const rows = db
    .prepare(`${SELECT_FESTIVAL} ${where} ORDER BY f.archived ASC, f.festival_date DESC, f.id DESC`)
    .all() as FestivalRow[]
  return rows.map(mapFestival)
}

export function findFestival(db: Db, id: number): Festival | null {
  const row = db.prepare(`${SELECT_FESTIVAL} WHERE f.id = ?`).get(id) as FestivalRow | undefined
  return row ? mapFestival(row) : null
}

export interface FestivalInsertValues {
  name: string
  festivalDate: string
  numberPrefix: string
  numberStart: number
  numberDigits: number
  copies: number
  taxExempt: boolean
  taxExemptText: string
  filenamePattern: string
}

export function insertFestival(db: Db, v: FestivalInsertValues): number {
  const now = nowIso()
  const result = db
    .prepare(
      `INSERT INTO festival
        (name, festival_date, number_prefix, number_start, number_next, number_digits, copies,
         tax_exempt, tax_exempt_text, filename_pattern, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(
      v.name,
      v.festivalDate,
      v.numberPrefix,
      v.numberStart,
      v.numberStart,
      v.numberDigits,
      v.copies,
      v.taxExempt ? 1 : 0,
      v.taxExemptText,
      v.filenamePattern,
      now,
      now
    )
  return Number(result.lastInsertRowid)
}

const COLUMN_BY_FIELD: Record<keyof FestivalUpdateInput, string> = {
  name: 'name',
  festivalDate: 'festival_date',
  numberPrefix: 'number_prefix',
  numberStart: 'number_start',
  numberDigits: 'number_digits',
  copies: 'copies',
  taxExempt: 'tax_exempt',
  taxExemptText: 'tax_exempt_text',
  filenamePattern: 'filename_pattern',
  archived: 'archived'
}

/** Aktualisiert die angegebenen Felder (bereits validiert). `extra` erlaubt z. B. `number_next`. */
export function updateFestivalRow(
  db: Db,
  id: number,
  patch: FestivalUpdateInput,
  extra: Record<string, string | number | null> = {}
): void {
  const sets: string[] = []
  const params: Array<string | number | null> = []
  for (const [field, value] of Object.entries(patch) as Array<[keyof FestivalUpdateInput, unknown]>) {
    if (value === undefined) continue
    const column = COLUMN_BY_FIELD[field]
    if (!column) continue
    sets.push(`${column} = ?`)
    params.push(typeof value === 'boolean' ? (value ? 1 : 0) : (value as string | number))
  }
  for (const [column, value] of Object.entries(extra)) {
    sets.push(`${column} = ?`)
    params.push(value)
  }
  if (sets.length === 0) return
  sets.push('updated_at = ?')
  params.push(nowIso())
  db.prepare(`UPDATE festival SET ${sets.join(', ')} WHERE id = ?`).run(...params, id)
}

export interface PaymentMethodInsertValues {
  kind: PaymentKind
  label: string
  text: string
  dueDays: number
  isDefault: boolean
}

export function insertPaymentMethodRow(db: Db, festivalId: number, v: PaymentMethodInsertValues): number {
  const result = db
    .prepare(
      `INSERT INTO payment_method (festival_id, kind, label, text, due_days, is_default)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(festivalId, v.kind, v.label, v.text, v.dueDays, v.isDefault ? 1 : 0)
  return Number(result.lastInsertRowid)
}

export function insertTemplateRow(db: Db, festivalId: number, config: TemplateConfig, logoFile: string | null): number {
  const result = db
    .prepare('INSERT INTO template (festival_id, config_json, logo_file, updated_at) VALUES (?, ?, ?, ?)')
    .run(festivalId, JSON.stringify(config), logoFile, nowIso())
  return Number(result.lastInsertRowid)
}
