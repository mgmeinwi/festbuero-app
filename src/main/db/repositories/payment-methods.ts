/**
 * SQL für Zahlungsarten (Row ↔ Domänentyp). Zuständig: Bereich „Fest-Einstellungen“.
 */
import type { PaymentKind, PaymentMethod } from '@shared/types'
import type { Db } from '../connection'

interface PaymentMethodRow {
  id: number
  festival_id: number
  kind: string
  label: string
  text: string
  due_days: number
  is_default: number
}

/** Anzeige-Reihenfolge: Bar vor Überweisung. */
const ORDER_BY_KIND = `CASE kind WHEN 'bar' THEN 0 WHEN 'ueberweisung' THEN 1 ELSE 2 END, id`

export function mapPaymentMethod(row: PaymentMethodRow): PaymentMethod {
  return {
    id: row.id,
    festivalId: row.festival_id,
    kind: row.kind as PaymentKind,
    label: row.label,
    text: row.text,
    dueDays: row.due_days,
    isDefault: row.is_default === 1
  }
}

export function listPaymentMethods(db: Db, festivalId: number): PaymentMethod[] {
  const rows = db
    .prepare(`SELECT * FROM payment_method WHERE festival_id = ? ORDER BY ${ORDER_BY_KIND}`)
    .all(festivalId) as PaymentMethodRow[]
  return rows.map(mapPaymentMethod)
}

export function findPaymentMethod(db: Db, id: number): PaymentMethod | null {
  const row = db.prepare('SELECT * FROM payment_method WHERE id = ?').get(id) as PaymentMethodRow | undefined
  return row ? mapPaymentMethod(row) : null
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

export interface PaymentMethodUpdateValues {
  label?: string
  text?: string
  dueDays?: number
  isDefault?: boolean
}

const COLUMN_BY_FIELD: Record<keyof PaymentMethodUpdateValues, string> = {
  label: 'label',
  text: 'text',
  dueDays: 'due_days',
  isDefault: 'is_default'
}

/** Aktualisiert die angegebenen Felder (bereits validiert). */
export function updatePaymentMethodRow(db: Db, id: number, patch: PaymentMethodUpdateValues): void {
  const sets: string[] = []
  const params: Array<string | number> = []
  for (const [field, value] of Object.entries(patch) as Array<[keyof PaymentMethodUpdateValues, unknown]>) {
    if (value === undefined) continue
    const column = COLUMN_BY_FIELD[field]
    if (!column) continue
    sets.push(`${column} = ?`)
    params.push(typeof value === 'boolean' ? (value ? 1 : 0) : (value as string | number))
  }
  if (sets.length === 0) return
  db.prepare(`UPDATE payment_method SET ${sets.join(', ')} WHERE id = ?`).run(...params, id)
}

/** Setzt `is_default` für alle Zahlungsarten des Fests außer `exceptId` zurück. */
export function clearDefaultPaymentMethods(db: Db, festivalId: number, exceptId: number): void {
  db.prepare('UPDATE payment_method SET is_default = 0 WHERE festival_id = ? AND id <> ?').run(festivalId, exceptId)
}

/** Kopiert alle Zahlungsarten (Art, Anzeigename, Text, Frist, Standard) in ein anderes Fest. */
export function copyPaymentMethods(db: Db, sourceFestivalId: number, targetFestivalId: number): number {
  const result = db
    .prepare(
      `INSERT INTO payment_method (festival_id, kind, label, text, due_days, is_default)
       SELECT ?, kind, label, text, due_days, is_default
       FROM payment_method WHERE festival_id = ? ORDER BY ${ORDER_BY_KIND}`
    )
    .run(targetFestivalId, sourceFestivalId)
  return result.changes
}
