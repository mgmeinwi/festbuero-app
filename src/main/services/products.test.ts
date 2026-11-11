import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ProductInput } from '@shared/types'
import { openDatabase, type Db } from '../db/connection'
import { createFestival } from './festivals'
import { createProduct, deleteProduct, getProduct, listProducts, reorderProducts, updateProduct } from './products'

const FESTZEICHEN: ProductInput = { name: 'Festzeichen', priceCents: 300, vatRate: 19, mode: 'pro_person', defaultQuantity: 1 }
const FESTSCHRIFT: ProductInput = { name: 'Festschrift', priceCents: 1500, vatRate: 7, mode: 'feste_anzahl', defaultQuantity: 1 }
const BROTZEIT: ProductInput = { name: 'Brotzeit', priceCents: 800, vatRate: 7, mode: 'pro_person', defaultQuantity: 0 }

/** Abgeschlossene Rechnung mit einer Position zum Produkt per SQL (Schema aus migrations.ts). */
function insertInvoiceLine(db: Db, festivalId: number, productId: number, number = '2025-001'): void {
  const invoiceId = Number(
    db
      .prepare(
        `INSERT INTO invoice (festival_id, number, seq, type, status, customer_kind, customer_json, payment_kind,
          payment_label, payment_text, due_days, invoice_date, service_date, due_date, total_gross_cents,
          total_net_cents, total_vat_cents, totals_json, tax_exempt, tax_exempt_text, festival_name, template_json, created_at)
         VALUES (?, ?, 1, 'rechnung', 'abgeschlossen', 'einzel', '{}', 'bar', 'Bar', '', 7,
          '2025-06-01', '2025-06-01', '2025-06-08', 300, 300, 0, '{}', 1, '', 'x', '{}', 'x')`
      )
      .run(festivalId, number).lastInsertRowid
  )
  db.prepare(
    `INSERT INTO invoice_line (invoice_id, position, product_id, name, price_cents, vat_rate, quantity, line_total_cents)
     VALUES (?, 1, ?, 'Festzeichen', 300, 19, 1, 300)`
  ).run(invoiceId, productId)
}

describe('products service', () => {
  let db: Db
  let festivalId: number
  beforeEach(() => {
    db = openDatabase(':memory:')
    festivalId = createFestival(
      { name: 'Testfest', festivalDate: '2025-06-01', numberPrefix: '2025-', numberStart: 1, numberDigits: 3 },
      db
    ).id
  })
  afterEach(() => db.close())

  it('create hängt ans Ende an und liefert alle Felder', () => {
    const a = createProduct(festivalId, { ...FESTZEICHEN, name: '  Festzeichen  ' }, db)
    const b = createProduct(festivalId, FESTSCHRIFT, db)
    expect(a).toMatchObject({
      festivalId,
      name: 'Festzeichen',
      priceCents: 300,
      vatRate: 19,
      mode: 'pro_person',
      defaultQuantity: 1,
      sortOrder: 0,
      active: true,
      usedInInvoices: false
    })
    expect(b.sortOrder).toBe(1)
    reorderProducts(festivalId, [b.id, a.id], db)
    const c = createProduct(festivalId, { ...BROTZEIT, active: false }, db)
    expect(c).toMatchObject({ sortOrder: 2, active: false })
    expect(listProducts(festivalId, {}, db).map((p) => p.name)).toEqual(['Festschrift', 'Festzeichen', 'Brotzeit'])
  })

  it('list sortiert nach sort_order und filtert mit activeOnly', () => {
    const a = createProduct(festivalId, FESTZEICHEN, db)
    const b = createProduct(festivalId, FESTSCHRIFT, db)
    const c = createProduct(festivalId, BROTZEIT, db)
    updateProduct(b.id, { active: false }, db)
    reorderProducts(festivalId, [c.id, b.id, a.id], db)
    expect(listProducts(festivalId, {}, db).map((p) => p.id)).toEqual([c.id, b.id, a.id])
    expect(listProducts(festivalId, { activeOnly: true }, db).map((p) => p.id)).toEqual([c.id, a.id])
    // Produkte anderer Feste erscheinen nicht
    const other = createFestival({ name: 'Anderes', festivalDate: '2026-06-01', numberPrefix: '2026-', numberStart: 1, numberDigits: 3 }, db)
    createProduct(other.id, FESTZEICHEN, db)
    expect(listProducts(festivalId, {}, db)).toHaveLength(3)
    expect(() => listProducts(999, {}, db)).toThrow(/Gründungsfest wurde nicht gefunden/)
  })

  it('update ändert nur die angegebenen Felder', () => {
    const a = createProduct(festivalId, FESTZEICHEN, db)
    const u = updateProduct(a.id, { priceCents: 350, mode: 'feste_anzahl', defaultQuantity: 2, name: ' Neu ' }, db)
    expect(u).toMatchObject({ name: 'Neu', priceCents: 350, vatRate: 19, mode: 'feste_anzahl', defaultQuantity: 2, sortOrder: 0, active: true })
    expect(updateProduct(a.id, { active: false }, db).active).toBe(false)
    expect(() => updateProduct(12345, { name: 'x' }, db)).toThrow('Das Produkt wurde nicht gefunden.')
  })

  it('validiert mit deutschen Meldungen und speichert nichts', () => {
    expect(() => createProduct(festivalId, { ...FESTZEICHEN, name: ' ' }, db)).toThrow('Bitte eine Bezeichnung für das Produkt angeben.')
    expect(() => createProduct(festivalId, { ...FESTZEICHEN, priceCents: -1 }, db)).toThrow('Der Preis darf nicht negativ sein.')
    expect(() => createProduct(festivalId, { ...FESTZEICHEN, priceCents: 9.7 }, db)).toThrow(/Ungültiger Preis/)
    expect(() => createProduct(festivalId, { ...FESTZEICHEN, vatRate: 16 as never }, db)).toThrow('Der Mehrwertsteuersatz muss 7 % oder 19 % betragen.')
    expect(() => createProduct(festivalId, { ...FESTZEICHEN, mode: 'pauschal' as never }, db)).toThrow(/Ungültiger Modus/)
    expect(() => createProduct(festivalId, { ...FESTZEICHEN, defaultQuantity: -1 }, db)).toThrow('Die Standardanzahl muss eine ganze Zahl ab 0 sein.')
    expect(() => createProduct(festivalId, { ...FESTZEICHEN, defaultQuantity: 1.5 }, db)).toThrow(/Standardanzahl/)
    expect(() => createProduct(festivalId, { ...FESTZEICHEN, name: 'x'.repeat(121) }, db)).toThrow(/zu lang/)
    expect(() => createProduct(festivalId, { name: 'Ohne Preis' } as ProductInput, db)).toThrow(/Unvollständige/)
    expect(() => createProduct(999, FESTZEICHEN, db)).toThrow(/Gründungsfest wurde nicht gefunden/)
    expect(listProducts(festivalId, {}, db)).toHaveLength(0)

    const a = createProduct(festivalId, { ...FESTZEICHEN, priceCents: 0, defaultQuantity: 0 }, db)
    expect(a).toMatchObject({ priceCents: 0, defaultQuantity: 0 })
    expect(() => updateProduct(a.id, { name: '' }, db)).toThrow(/Bezeichnung/)
    expect(() => updateProduct(a.id, { priceCents: -5 }, db)).toThrow(/negativ/)
    expect(() => updateProduct(a.id, { vatRate: 0 as never }, db)).toThrow(/7 % oder 19 %/)
    expect(getProduct(a.id, db).name).toBe('Festzeichen')
  })

  it('reorder setzt die Reihenfolge in einer Transaktion und prüft die IDs', () => {
    const a = createProduct(festivalId, FESTZEICHEN, db)
    const b = createProduct(festivalId, FESTSCHRIFT, db)
    const c = createProduct(festivalId, BROTZEIT, db)
    const result = reorderProducts(festivalId, [c.id, a.id, b.id], db)
    expect(result.map((p) => [p.id, p.sortOrder])).toEqual([
      [c.id, 0],
      [a.id, 1],
      [b.id, 2]
    ])
    // fehlende IDs werden in bisheriger Reihenfolge hinten angehängt
    expect(reorderProducts(festivalId, [b.id], db).map((p) => p.id)).toEqual([b.id, c.id, a.id])

    const other = createFestival({ name: 'Anderes', festivalDate: '2026-06-01', numberPrefix: '2026-', numberStart: 1, numberDigits: 3 }, db)
    const foreign = createProduct(other.id, FESTZEICHEN, db)
    expect(() => reorderProducts(festivalId, [a.id, foreign.id], db)).toThrow(/nicht mehr aktuell/)
    expect(() => reorderProducts(festivalId, [a.id, a.id], db)).toThrow(/doppelt/)
    expect(() => reorderProducts(festivalId, 'x' as never, db)).toThrow(/Ungültige Reihenfolge/)
    // nach Fehlern unverändert
    expect(listProducts(festivalId, {}, db).map((p) => p.id)).toEqual([b.id, c.id, a.id])
  })

  it('delete löscht unbenutzte Produkte, verwendete nur deaktivierbar', () => {
    const a = createProduct(festivalId, FESTZEICHEN, db)
    const b = createProduct(festivalId, FESTSCHRIFT, db)
    insertInvoiceLine(db, festivalId, a.id)

    expect(getProduct(a.id, db).usedInInvoices).toBe(true)
    expect(getProduct(b.id, db).usedInInvoices).toBe(false)
    expect(() => deleteProduct(a.id, db)).toThrow(
      '„Festzeichen“ wurde bereits in Rechnungen verwendet und kann nur deaktiviert werden.'
    )
    expect(getProduct(a.id, db)).toBeTruthy()
    expect(updateProduct(a.id, { active: false }, db)).toMatchObject({ active: false, usedInInvoices: true })

    deleteProduct(b.id, db)
    expect(() => getProduct(b.id, db)).toThrow(/nicht gefunden/)
    expect(() => deleteProduct(b.id, db)).toThrow(/nicht gefunden/)
    expect(listProducts(festivalId, {}, db).map((p) => p.id)).toEqual([a.id])
  })
})
