import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDefaultTemplateConfig } from '@shared/invoice-render/default-template'
import type { FestivalCreateInput } from '@shared/types'
import { openDatabase, type Db } from '../db/connection'
import {
  copyFestival,
  createFestival,
  DEFAULT_TAX_EXEMPT_TEXT,
  getFestival,
  listFestivals,
  NUMBER_START_LOCKED_MESSAGE,
  updateFestival
} from './festivals'
import { listPaymentMethods, updatePaymentMethod } from './payment-methods'
import { createProduct, listProducts, reorderProducts, updateProduct } from './products'

/** Fügt einen abgeschlossenen Beleg (optional mit Position zu einem Produkt) per SQL ein. */
function insertInvoice(db: Db, festivalId: number, number: string, productId: number | null = null): number {
  const now = new Date().toISOString()
  const result = db
    .prepare(
      `INSERT INTO invoice (festival_id, number, seq, type, status, customer_kind, customer_json, payment_kind,
        payment_label, payment_text, due_days, invoice_date, service_date, due_date, total_gross_cents,
        total_net_cents, total_vat_cents, totals_json, tax_exempt, tax_exempt_text, festival_name, template_json, created_at)
       VALUES (?, ?, 1, 'rechnung', 'abgeschlossen', 'einzel', '{}', 'bar', 'Bar', '', 7,
        '2025-06-01', '2025-06-01', '2025-06-08', 300, 300, 0, '{}', 1, '', 'x', '{}', ?)`
    )
    .run(festivalId, number, now)
  const invoiceId = Number(result.lastInsertRowid)
  if (productId !== null) {
    db.prepare(
      `INSERT INTO invoice_line (invoice_id, position, product_id, name, price_cents, vat_rate, quantity, line_total_cents)
       VALUES (?, 1, ?, 'Festzeichen', 300, 19, 1, 300)`
    ).run(invoiceId, productId)
  }
  return invoiceId
}

const INPUT: FestivalCreateInput = {
  name: '  100-jähriges Gründungsfest ',
  festivalDate: '2025-06-01',
  numberPrefix: '2025-',
  numberStart: 75,
  numberDigits: 3
}

describe('festivals service', () => {
  let db: Db
  beforeEach(() => {
    db = openDatabase(':memory:')
  })
  afterEach(() => db.close())

  it('legt ein Fest mit Standardwerten an', () => {
    const f = createFestival(INPUT, db)
    expect(f).toMatchObject({
      name: '100-jähriges Gründungsfest',
      festivalDate: '2025-06-01',
      numberPrefix: '2025-',
      numberStart: 75,
      numberNext: 75,
      numberDigits: 3,
      copies: 2,
      taxExempt: true,
      taxExemptText: DEFAULT_TAX_EXEMPT_TEXT,
      filenamePattern: '{Rechnungsnummer}',
      archived: false,
      hasInvoices: false
    })
  })

  it('legt in derselben Transaktion Zahlungsarten und Vorlage an', () => {
    const f = createFestival(INPUT, db)
    const pms = db
      .prepare('SELECT kind, label, text, due_days, is_default FROM payment_method WHERE festival_id = ? ORDER BY kind')
      .all(f.id) as Array<{ kind: string; label: string; text: string; due_days: number; is_default: number }>
    expect(pms).toHaveLength(2)
    expect(pms[0]).toMatchObject({ kind: 'bar', label: 'Bar', due_days: 7, is_default: 1 })
    expect(pms[0]!.text).toContain('Betrag bar erhalten')
    expect(pms[1]).toMatchObject({ kind: 'ueberweisung', label: 'Überweisung', due_days: 7, is_default: 0 })
    expect(pms[1]!.text).toContain('{Gesamtbetrag}')
    expect(pms[1]!.text).toContain('{Fälligkeitsdatum}')
    expect(pms[1]!.text).toContain('{Rechnungsnummer}')

    const tpl = db.prepare('SELECT config_json, logo_file FROM template WHERE festival_id = ?').get(f.id) as {
      config_json: string
      logo_file: string | null
    }
    expect(JSON.parse(tpl.config_json)).toEqual(getDefaultTemplateConfig())
    expect(tpl.logo_file).toBeNull()
  })

  it('validiert Eingaben mit deutschen Meldungen und speichert nichts', () => {
    expect(() => createFestival({ ...INPUT, name: ' ' }, db)).toThrow(/Namen/)
    expect(() => createFestival({ ...INPUT, festivalDate: '2025-02-30' }, db)).toThrow(/Festdatum/)
    expect(() => createFestival({ ...INPUT, numberDigits: 0 }, db)).toThrow(/Stellenzahl/)
    expect(() => createFestival({ ...INPUT, numberStart: -1 }, db)).toThrow(/Startnummer/)
    expect(() => createFestival({ ...INPUT, copies: 0 }, db)).toThrow(/Kopienzahl/)
    expect(() => createFestival({ ...INPUT, filenamePattern: '{Verein}' }, db)).toThrow(/Rechnungsnummer/)
    expect(listFestivals({ includeArchived: true }, db)).toHaveLength(0)
    expect(db.prepare('SELECT COUNT(*) AS n FROM payment_method').get()).toEqual({ n: 0 })
  })

  it('get wirft bei unbekannter ID', () => {
    expect(() => getFestival(999, db)).toThrow(/nicht gefunden/)
  })

  it('list blendet archivierte Feste aus', () => {
    const a = createFestival(INPUT, db)
    createFestival({ ...INPUT, name: 'Zweites Fest', festivalDate: '2026-07-01', numberPrefix: '2026-' }, db)
    updateFestival(a.id, { archived: true }, db)
    expect(listFestivals({}, db).map((f) => f.name)).toEqual(['Zweites Fest'])
    expect(listFestivals({ includeArchived: true }, db)).toHaveLength(2)
  })

  it('update ändert Felder und setzt die nächste Nummer mit der Startnummer', () => {
    const f = createFestival(INPUT, db)
    const u = updateFestival(f.id, { name: 'Neu', copies: 3, taxExempt: false, numberStart: 100 }, db)
    expect(u).toMatchObject({ name: 'Neu', copies: 3, taxExempt: false, numberStart: 100, numberNext: 100 })
    expect(() => updateFestival(f.id, { filenamePattern: 'ohne' }, db)).toThrow(/Rechnungsnummer/)
  })

  it('Startnummer nach erster Rechnung gesperrt (Service-Meldung)', () => {
    const f = createFestival(INPUT, db)
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO invoice (festival_id, number, seq, type, status, customer_kind, customer_json, payment_kind,
        payment_label, payment_text, due_days, invoice_date, service_date, due_date, total_gross_cents,
        total_net_cents, total_vat_cents, totals_json, tax_exempt, tax_exempt_text, festival_name, template_json, created_at)
       VALUES (?, '2025-075', 75, 'rechnung', 'abgeschlossen', 'einzel', '{}', 'bar', 'Bar', '', 7,
        '2025-06-01', '2025-06-01', '2025-06-08', 100, 100, 0, '{}', 1, '', 'x', '{}', ?)`
    ).run(f.id, now)
    expect(getFestival(f.id, db).hasInvoices).toBe(true)
    expect(() => updateFestival(f.id, { numberStart: 1 }, db)).toThrow(/Startnummer/)
    expect(updateFestival(f.id, { name: 'Weiter änderbar' }, db).name).toBe('Weiter änderbar')
  })

  it('Startnummer: Meldung verständlich, auch wenn der DB-Trigger greift', () => {
    const f = createFestival(INPUT, db)
    insertInvoice(db, f.id, '2025-075')
    expect(() => updateFestival(f.id, { numberStart: 80 }, db)).toThrow(NUMBER_START_LOCKED_MESSAGE)
    // gleiche Startnummer erneut senden ist erlaubt (keine Änderung)
    expect(updateFestival(f.id, { numberStart: 75, copies: 4 }, db)).toMatchObject({ numberStart: 75, copies: 4 })
    // zweite Absicherung: der DB-Trigger sperrt die Startnummer auch ohne Service
    expect(() => db.prepare('UPDATE festival SET number_start = 1 WHERE id = ?').run(f.id)).toThrow(/Startnummer/)
  })

  it('Startnummer ohne Belege: nächste Nummer wird mitgezogen, andere Felder lassen sie unverändert', () => {
    const f = createFestival(INPUT, db)
    expect(updateFestival(f.id, { numberStart: 5 }, db)).toMatchObject({ numberStart: 5, numberNext: 5 })
    expect(updateFestival(f.id, { numberPrefix: 'A-', numberDigits: 4 }, db)).toMatchObject({
      numberPrefix: 'A-',
      numberDigits: 4,
      numberStart: 5,
      numberNext: 5
    })
  })

  it('update validiert Name, Datum, Stellenzahl, Kopien, Dateinamensmuster und Steuerhinweis', () => {
    const f = createFestival(INPUT, db)
    expect(() => updateFestival(f.id, { name: '   ' }, db)).toThrow('Bitte einen Namen für das Gründungsfest angeben.')
    expect(() => updateFestival(f.id, { festivalDate: '2025-13-01' }, db)).toThrow('Bitte ein gültiges Festdatum angeben.')
    expect(() => updateFestival(f.id, { festivalDate: '' }, db)).toThrow(/Festdatum/)
    expect(() => updateFestival(f.id, { numberDigits: 0 }, db)).toThrow('Die Stellenzahl muss zwischen 1 und 10 liegen.')
    expect(() => updateFestival(f.id, { numberDigits: 11 }, db)).toThrow(/Stellenzahl/)
    expect(() => updateFestival(f.id, { numberDigits: 2.5 }, db)).toThrow(/Stellenzahl/)
    expect(() => updateFestival(f.id, { copies: 0 }, db)).toThrow('Die Kopienzahl muss zwischen 1 und 20 liegen.')
    expect(() => updateFestival(f.id, { copies: 21 }, db)).toThrow(/Kopienzahl/)
    expect(() => updateFestival(f.id, { filenamePattern: '' }, db)).toThrow(/darf nicht leer/)
    expect(() => updateFestival(f.id, { filenamePattern: '{Rechnungsnummer}_{Unbekannt}' }, db)).toThrow(/Unbekannter Platzhalter/)
    expect(() => updateFestival(f.id, { taxExemptText: '  ' }, db)).toThrow(/Hinweistext/)
    // ohne Steuerbefreiung darf der Text leer sein
    expect(updateFestival(f.id, { taxExempt: false, taxExemptText: '' }, db)).toMatchObject({ taxExempt: false, taxExemptText: '' })
    expect(() => updateFestival(f.id, { taxExempt: true }, db)).toThrow(/Hinweistext/)
    // Grenzen sind erlaubt; Muster wird getrimmt
    expect(
      updateFestival(f.id, { numberDigits: 10, copies: 20, filenamePattern: ' {Verein} {Rechnungsnummer} ' }, db)
    ).toMatchObject({ numberDigits: 10, copies: 20, filenamePattern: '{Verein} {Rechnungsnummer}' })
    expect(updateFestival(f.id, { numberDigits: 1, copies: 1 }, db)).toMatchObject({ numberDigits: 1, copies: 1 })
    expect(() => updateFestival(4711, { name: 'x' }, db)).toThrow(/nicht gefunden/)
  })

  it('archivieren und wiederherstellen', () => {
    const f = createFestival(INPUT, db)
    const archived = updateFestival(f.id, { archived: true }, db)
    expect(archived.archived).toBe(true)
    expect(listFestivals({}, db)).toHaveLength(0)
    expect(listFestivals({ includeArchived: true }, db).map((x) => x.id)).toEqual([f.id])
    expect(updateFestival(f.id, { archived: false }, db).archived).toBe(false)
    expect(listFestivals({}, db)).toHaveLength(1)
  })

  describe('copy', () => {
    function setupSource() {
      const source = createFestival(
        { ...INPUT, numberDigits: 4, copies: 3, taxExempt: false, taxExemptText: 'Eigener Hinweis', filenamePattern: '{Verein}-{Rechnungsnummer}' },
        db
      )
      const a = createProduct(source.id, { name: 'Festzeichen', priceCents: 300, vatRate: 19, mode: 'pro_person', defaultQuantity: 1 }, db)
      const b = createProduct(source.id, { name: 'Festschrift', priceCents: 1500, vatRate: 7, mode: 'feste_anzahl', defaultQuantity: 1 }, db)
      const c = createProduct(source.id, { name: 'Brotzeit', priceCents: 800, vatRate: 7, mode: 'pro_person', defaultQuantity: 0, active: false }, db)
      reorderProducts(source.id, [c.id, a.id, b.id], db)
      const [bar, transfer] = listPaymentMethods(source.id, db)
      updatePaymentMethod(transfer!.id, { label: 'Bank', text: '<p>Bitte bis {Fälligkeitsdatum}</p>', dueDays: 14, isDefault: true }, db)
      updatePaymentMethod(bar!.id, { text: '<p>Bar erhalten</p>' }, db)
      db.prepare("UPDATE template SET config_json = ?, logo_file = 'abc123.png' WHERE festival_id = ?").run(
        JSON.stringify({ ...getDefaultTemplateConfig(), baseFontSizePt: 12 }),
        source.id
      )
      db.prepare(
        "INSERT INTO club (festival_id, club_name, created_at, updated_at) VALUES (?, 'Musterverein e.V.', 'x', 'x')"
      ).run(source.id)
      insertInvoice(db, source.id, '2025-0075', a.id)
      return { source, a, b, c }
    }

    it('übernimmt Einstellungen, Produkte, Vorlage und Zahlungsarten – ohne Vereine und Rechnungen', () => {
      const { source } = setupSource()
      const copy = copyFestival(source.id, { name: ' Gründungsfest 2026 ', festivalDate: '2026-06-01', numberPrefix: '2026-', numberStart: 1 }, db)

      expect(copy.id).not.toBe(source.id)
      expect(copy).toMatchObject({
        name: 'Gründungsfest 2026',
        festivalDate: '2026-06-01',
        numberPrefix: '2026-',
        numberStart: 1,
        numberNext: 1,
        numberDigits: 4,
        copies: 3,
        taxExempt: false,
        taxExemptText: 'Eigener Hinweis',
        filenamePattern: '{Verein}-{Rechnungsnummer}',
        archived: false,
        hasInvoices: false
      })

      const strip = (p: { name: string; priceCents: number; vatRate: number; mode: string; defaultQuantity: number; sortOrder: number; active: boolean }) => ({
        name: p.name,
        priceCents: p.priceCents,
        vatRate: p.vatRate,
        mode: p.mode,
        defaultQuantity: p.defaultQuantity,
        sortOrder: p.sortOrder,
        active: p.active
      })
      const sourceProducts = listProducts(source.id, {}, db)
      const copiedProducts = listProducts(copy.id, {}, db)
      expect(copiedProducts.map(strip)).toEqual(sourceProducts.map(strip))
      expect(copiedProducts.map((p) => p.name)).toEqual(['Brotzeit', 'Festzeichen', 'Festschrift'])
      expect(copiedProducts.map((p) => p.active)).toEqual([false, true, true])
      expect(copiedProducts.every((p) => !p.usedInInvoices && p.festivalId === copy.id)).toBe(true)
      expect(sourceProducts.find((p) => p.name === 'Festzeichen')!.usedInInvoices).toBe(true)

      const pmStrip = (m: { kind: string; label: string; text: string; dueDays: number; isDefault: boolean }) => ({
        kind: m.kind,
        label: m.label,
        text: m.text,
        dueDays: m.dueDays,
        isDefault: m.isDefault
      })
      expect(listPaymentMethods(copy.id, db).map(pmStrip)).toEqual(listPaymentMethods(source.id, db).map(pmStrip))
      expect(listPaymentMethods(copy.id, db).find((m) => m.isDefault)!.kind).toBe('ueberweisung')

      const tpl = (id: number) =>
        db.prepare('SELECT config_json, logo_file FROM template WHERE festival_id = ?').get(id) as {
          config_json: string
          logo_file: string | null
        }
      expect(tpl(copy.id)).toEqual(tpl(source.id))
      expect(tpl(copy.id).logo_file).toBe('abc123.png')

      expect(db.prepare('SELECT COUNT(*) AS n FROM club WHERE festival_id = ?').get(copy.id)).toEqual({ n: 0 })
      expect(db.prepare('SELECT COUNT(*) AS n FROM invoice WHERE festival_id = ?').get(copy.id)).toEqual({ n: 0 })
      // Quelle unverändert
      expect(getFestival(source.id, db)).toMatchObject({ hasInvoices: true, numberPrefix: '2025-' })
      expect(db.prepare('SELECT COUNT(*) AS n FROM club WHERE festival_id = ?').get(source.id)).toEqual({ n: 1 })
    })

    it('Kopie ist unabhängig vom Original', () => {
      const { source } = setupSource()
      const copy = copyFestival(source.id, { name: 'Kopie', festivalDate: '2026-06-01', numberPrefix: '2026-', numberStart: 10 }, db)
      const copied = listProducts(copy.id, {}, db)
      updateProduct(copied[0]!.id, { name: 'Geändert' }, db)
      expect(listProducts(source.id, {}, db)[0]!.name).toBe('Brotzeit')
      expect(copy.numberNext).toBe(10)
    })

    it('validiert die Eingaben und legt bei Fehlern nichts an', () => {
      const { source } = setupSource()
      const before = listFestivals({ includeArchived: true }, db).length
      const products = db.prepare('SELECT COUNT(*) AS n FROM product').get()
      const ok = { name: 'Kopie', festivalDate: '2026-06-01', numberPrefix: '2026-', numberStart: 1 }
      expect(() => copyFestival(source.id, { ...ok, name: '' }, db)).toThrow(/Namen/)
      expect(() => copyFestival(source.id, { ...ok, festivalDate: '01.06.2026' }, db)).toThrow(/Festdatum/)
      expect(() => copyFestival(source.id, { ...ok, numberStart: -3 }, db)).toThrow(/Startnummer/)
      expect(() => copyFestival(source.id, { ...ok, numberPrefix: 'x'.repeat(21) }, db)).toThrow(/Präfix/)
      expect(() => copyFestival(999, ok, db)).toThrow(/nicht gefunden/)
      expect(listFestivals({ includeArchived: true }, db)).toHaveLength(before)
      expect(db.prepare('SELECT COUNT(*) AS n FROM product').get()).toEqual(products)
    })

    it('Transaktion: Fehler beim Kopieren hinterlässt keine halbe Kopie', () => {
      const { source } = setupSource()
      // Simulierter Fehler: Vorlagen-Kopie schlägt fehl
      db.exec(`CREATE TRIGGER fail_template BEFORE INSERT ON template BEGIN SELECT RAISE(ABORT, 'Test-Fehler'); END;`)
      const before = listFestivals({ includeArchived: true }, db).length
      expect(() =>
        copyFestival(source.id, { name: 'Kopie', festivalDate: '2026-06-01', numberPrefix: '2026-', numberStart: 1 }, db)
      ).toThrow('Test-Fehler')
      expect(listFestivals({ includeArchived: true }, db)).toHaveLength(before)
      expect(db.prepare('SELECT COUNT(*) AS n FROM product WHERE festival_id <> ?').get(source.id)).toEqual({ n: 0 })
      expect(db.prepare('SELECT COUNT(*) AS n FROM payment_method WHERE festival_id <> ?').get(source.id)).toEqual({ n: 0 })
    })
  })
})
