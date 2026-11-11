/**
 * SQL für Produkte (Row ↔ Domänentyp). Zuständig: Bereich „Fest-Einstellungen“.
 * `usedInInvoices` wird per Subquery auf `invoice_line.product_id` abgeleitet.
 */
import type { Product, ProductMode, VatRate } from '@shared/types'
import type { Db } from '../connection'

interface ProductRow {
  id: number
  festival_id: number
  name: string
  price_cents: number
  vat_rate: number
  mode: string
  default_quantity: number
  sort_order: number
  active: number
  used_in_invoices: number
}

const SELECT_PRODUCT = `
  SELECT p.*, EXISTS (SELECT 1 FROM invoice_line l WHERE l.product_id = p.id) AS used_in_invoices
  FROM product p
`

export function mapProduct(row: ProductRow): Product {
  return {
    id: row.id,
    festivalId: row.festival_id,
    name: row.name,
    priceCents: row.price_cents,
    vatRate: row.vat_rate as VatRate,
    mode: row.mode as ProductMode,
    defaultQuantity: row.default_quantity,
    sortOrder: row.sort_order,
    active: row.active === 1,
    usedInInvoices: row.used_in_invoices === 1
  }
}

export function listProducts(db: Db, festivalId: number, opts: { activeOnly?: boolean } = {}): Product[] {
  const where = opts.activeOnly ? 'WHERE p.festival_id = ? AND p.active = 1' : 'WHERE p.festival_id = ?'
  const rows = db.prepare(`${SELECT_PRODUCT} ${where} ORDER BY p.sort_order ASC, p.id ASC`).all(festivalId) as ProductRow[]
  return rows.map(mapProduct)
}

export function findProduct(db: Db, id: number): Product | null {
  const row = db.prepare(`${SELECT_PRODUCT} WHERE p.id = ?`).get(id) as ProductRow | undefined
  return row ? mapProduct(row) : null
}

/** Nächste freie Sortierposition (ans Ende anhängen). */
export function nextSortOrder(db: Db, festivalId: number): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM product WHERE festival_id = ?')
    .get(festivalId) as { next: number }
  return row.next
}

export interface ProductInsertValues {
  name: string
  priceCents: number
  vatRate: VatRate
  mode: ProductMode
  defaultQuantity: number
  sortOrder: number
  active: boolean
}

export function insertProduct(db: Db, festivalId: number, v: ProductInsertValues): number {
  const result = db
    .prepare(
      `INSERT INTO product (festival_id, name, price_cents, vat_rate, mode, default_quantity, sort_order, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(festivalId, v.name, v.priceCents, v.vatRate, v.mode, v.defaultQuantity, v.sortOrder, v.active ? 1 : 0)
  return Number(result.lastInsertRowid)
}

export interface ProductUpdateValues {
  name?: string
  priceCents?: number
  vatRate?: VatRate
  mode?: ProductMode
  defaultQuantity?: number
  active?: boolean
}

const COLUMN_BY_FIELD: Record<keyof ProductUpdateValues, string> = {
  name: 'name',
  priceCents: 'price_cents',
  vatRate: 'vat_rate',
  mode: 'mode',
  defaultQuantity: 'default_quantity',
  active: 'active'
}

/** Aktualisiert die angegebenen Felder (bereits validiert). */
export function updateProductRow(db: Db, id: number, patch: ProductUpdateValues): void {
  const sets: string[] = []
  const params: Array<string | number> = []
  for (const [field, value] of Object.entries(patch) as Array<[keyof ProductUpdateValues, unknown]>) {
    if (value === undefined) continue
    const column = COLUMN_BY_FIELD[field]
    if (!column) continue
    sets.push(`${column} = ?`)
    params.push(typeof value === 'boolean' ? (value ? 1 : 0) : (value as string | number))
  }
  if (sets.length === 0) return
  db.prepare(`UPDATE product SET ${sets.join(', ')} WHERE id = ?`).run(...params, id)
}

export function setProductSortOrder(db: Db, id: number, sortOrder: number): void {
  db.prepare('UPDATE product SET sort_order = ? WHERE id = ?').run(sortOrder, id)
}

export function deleteProductRow(db: Db, id: number): void {
  db.prepare('DELETE FROM product WHERE id = ?').run(id)
}

/** true, wenn mindestens eine Rechnungsposition auf das Produkt verweist. */
export function isProductUsedInInvoices(db: Db, id: number): boolean {
  const row = db.prepare('SELECT EXISTS (SELECT 1 FROM invoice_line WHERE product_id = ?) AS used').get(id) as {
    used: number
  }
  return row.used === 1
}

/**
 * Kopiert alle Produkte (inkl. inaktiver, mit Reihenfolge und Aktiv-Status) in ein anderes Fest.
 * Liefert die Anzahl kopierter Produkte.
 */
export function copyProducts(db: Db, sourceFestivalId: number, targetFestivalId: number): number {
  const result = db
    .prepare(
      `INSERT INTO product (festival_id, name, price_cents, vat_rate, mode, default_quantity, sort_order, active)
       SELECT ?, name, price_cents, vat_rate, mode, default_quantity, sort_order, active
       FROM product WHERE festival_id = ? ORDER BY sort_order ASC, id ASC`
    )
    .run(targetFestivalId, sourceFestivalId)
  return result.changes
}
