/**
 * Fachlogik Produkte: list, create (ans Ende), update, delete (nur unbenutzte), reorder.
 * Zuständig: Bereich „Fest-Einstellungen“.
 */
import { formatEuro } from '@shared/money'
import type { Product, ProductInput, ProductMode, VatRate } from '@shared/types'
import { getDb, type Db } from '../db/connection'
import * as repo from '../db/repositories/products'
import { getFestival } from './festivals'

export const PRODUCT_MODES: readonly ProductMode[] = ['pro_person', 'feste_anzahl']
export const MAX_PRODUCT_NAME_LENGTH = 120
/** Plausibilitätsgrenze gegen Tippfehler: 100.000,00 € */
export const MAX_PRODUCT_PRICE_CENTS = 10_000_000
export const MAX_DEFAULT_QUANTITY = 100_000

/** Prüft die angegebenen Produktfelder und wirft bei Fehlern eine deutsche Meldung. */
export function validateProductFields(fields: Partial<ProductInput>): void {
  if (fields.name !== undefined) {
    if (typeof fields.name !== 'string' || fields.name.trim() === '') {
      throw new Error('Bitte eine Bezeichnung für das Produkt angeben.')
    }
    if (fields.name.trim().length > MAX_PRODUCT_NAME_LENGTH) {
      throw new Error(`Die Bezeichnung ist zu lang (höchstens ${MAX_PRODUCT_NAME_LENGTH} Zeichen).`)
    }
  }
  if (fields.priceCents !== undefined) {
    if (!Number.isSafeInteger(fields.priceCents)) {
      throw new Error('Ungültiger Preis. Bitte einen Betrag wie „9,70“ eingeben.')
    }
    if (fields.priceCents < 0) throw new Error('Der Preis darf nicht negativ sein.')
    if (fields.priceCents > MAX_PRODUCT_PRICE_CENTS) {
      throw new Error(`Der Preis ist zu hoch (höchstens ${formatEuro(MAX_PRODUCT_PRICE_CENTS)}).`)
    }
  }
  if (fields.vatRate !== undefined && fields.vatRate !== 7 && fields.vatRate !== 19) {
    throw new Error('Der Mehrwertsteuersatz muss 7 % oder 19 % betragen.')
  }
  if (fields.mode !== undefined && !PRODUCT_MODES.includes(fields.mode)) {
    throw new Error('Ungültiger Modus. Erlaubt sind „pro Person“ und „feste Anzahl“.')
  }
  if (fields.defaultQuantity !== undefined) {
    if (!Number.isInteger(fields.defaultQuantity) || fields.defaultQuantity < 0) {
      throw new Error('Die Standardanzahl muss eine ganze Zahl ab 0 sein.')
    }
    if (fields.defaultQuantity > MAX_DEFAULT_QUANTITY) {
      throw new Error(`Die Standardanzahl ist zu hoch (höchstens ${MAX_DEFAULT_QUANTITY.toLocaleString('de-DE')}).`)
    }
  }
  if (fields.active !== undefined && typeof fields.active !== 'boolean') {
    throw new Error('Ungültiger Wert für „aktiv“.')
  }
}

function requireFestivalId(festivalId: number, db: Db): void {
  getFestival(festivalId, db)
}

export function listProducts(festivalId: number, opts: { activeOnly?: boolean } = {}, db: Db = getDb()): Product[] {
  requireFestivalId(festivalId, db)
  return repo.listProducts(db, festivalId, { activeOnly: opts?.activeOnly === true })
}

export function getProduct(id: number, db: Db = getDb()): Product {
  const product = Number.isInteger(id) ? repo.findProduct(db, id) : null
  if (!product) throw new Error('Das Produkt wurde nicht gefunden.')
  return product
}

/** Legt ein Produkt an und hängt es ans Ende der Liste an. */
export function createProduct(festivalId: number, input: ProductInput, db: Db = getDb()): Product {
  if (!input || typeof input !== 'object') throw new Error('Ungültige Angaben zum Produkt.')
  requireFestivalId(festivalId, db)
  for (const key of ['name', 'priceCents', 'vatRate', 'mode', 'defaultQuantity'] as const) {
    if (input[key] === undefined || input[key] === null) {
      throw new Error('Unvollständige Angaben zum Produkt (Bezeichnung, Preis, Steuersatz, Modus, Standardanzahl).')
    }
  }
  const values = {
    name: (input.name ?? '').trim(),
    priceCents: input.priceCents,
    vatRate: input.vatRate as VatRate,
    mode: input.mode,
    defaultQuantity: input.defaultQuantity,
    active: input.active ?? true
  }
  validateProductFields(values)
  const id = db.transaction(() =>
    repo.insertProduct(db, festivalId, { ...values, sortOrder: repo.nextSortOrder(db, festivalId) })
  )()
  return getProduct(id, db)
}

export function updateProduct(id: number, patch: Partial<ProductInput>, db: Db = getDb()): Product {
  if (!patch || typeof patch !== 'object') throw new Error('Ungültige Änderungen am Produkt.')
  getProduct(id, db)
  const clean: repo.ProductUpdateValues = {
    name: typeof patch.name === 'string' ? patch.name.trim() : patch.name,
    priceCents: patch.priceCents,
    vatRate: patch.vatRate,
    mode: patch.mode,
    defaultQuantity: patch.defaultQuantity,
    active: patch.active
  }
  validateProductFields(clean)
  repo.updateProductRow(db, id, clean)
  return getProduct(id, db)
}

/** Löscht ein Produkt. In Rechnungen verwendete Produkte lassen sich nur deaktivieren. */
export function deleteProduct(id: number, db: Db = getDb()): void {
  const product = getProduct(id, db)
  db.transaction(() => {
    if (repo.isProductUsedInInvoices(db, id)) {
      throw new Error(`„${product.name}“ wurde bereits in Rechnungen verwendet und kann nur deaktiviert werden.`)
    }
    repo.deleteProductRow(db, id)
  })()
}

/**
 * Neue Reihenfolge in EINER Transaktion. `orderedIds` muss zu diesem Fest gehören und darf keine
 * Duplikate enthalten; nicht genannte Produkte (z. B. zwischenzeitlich angelegte) werden in ihrer
 * bisherigen Reihenfolge hinten angehängt.
 */
export function reorderProducts(festivalId: number, orderedIds: number[], db: Db = getDb()): Product[] {
  requireFestivalId(festivalId, db)
  if (!Array.isArray(orderedIds)) throw new Error('Ungültige Reihenfolge der Produkte.')
  const current = repo.listProducts(db, festivalId)
  const known = new Set(current.map((p) => p.id))
  const seen = new Set<number>()
  for (const id of orderedIds) {
    if (!Number.isInteger(id) || !known.has(id)) {
      throw new Error('Die Produktliste ist nicht mehr aktuell. Bitte die Seite neu laden und erneut sortieren.')
    }
    if (seen.has(id)) throw new Error('Ungültige Reihenfolge: Ein Produkt ist doppelt enthalten.')
    seen.add(id)
  }
  const finalOrder = [...orderedIds, ...current.filter((p) => !seen.has(p.id)).map((p) => p.id)]
  db.transaction(() => {
    finalOrder.forEach((id, index) => repo.setProductSortOrder(db, id, index))
  })()
  return repo.listProducts(db, festivalId)
}
