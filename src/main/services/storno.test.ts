import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultTemplateConfig } from '@shared/invoice-render/default-template'
import { todayIso } from '@shared/dates'
import * as repo from '../db/repositories/invoices'
import {
  buildDraft,
  countInvoices,
  countLines,
  insertFestival,
  insertProducts,
  numberNext,
  SAMPLE_TOTAL_CENTS,
  setupTestContext,
  type TestContext
} from './invoice-test-utils'

vi.mock('electron', async () => (await import('./invoice-test-utils')).electronMock())
vi.mock('./pdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pdf')>()
  return { ...actual, renderHtmlToPdf: vi.fn(async () => Buffer.from('%PDF-1.4\n% Storno-Test\n%%EOF\n')) }
})

import { createInvoiceRecord, finalizeInvoice, listInvoices } from './finalize'
import { createStornoRecord, stornoInvoice } from './storno'

describe('Storno', () => {
  let ctx: TestContext
  beforeEach(() => {
    ctx = setupTestContext()
  })
  afterEach(() => ctx.cleanup())

  it('negiert Mengen, Zeilensummen und Summen exakt (Einzelpreise gleich)', () => {
    const f = insertFestival(ctx.db, { taxExempt: false })
    const products = insertProducts(ctx.db, f)
    const { id } = createInvoiceRecord(buildDraft(f, products), ctx.db)
    const original = repo.findInvoice(ctx.db, id)!

    const storno = repo.findInvoice(ctx.db, createStornoRecord(id, 'Falsche Personenzahl', ctx.db).id)!
    expect(storno.lines).toHaveLength(original.lines.length)
    storno.lines.forEach((line, i) => {
      const o = original.lines[i]!
      expect(line.name).toBe(o.name)
      expect(line.productId).toBe(o.productId)
      expect(line.priceCents).toBe(o.priceCents)
      expect(line.vatRate).toBe(o.vatRate)
      expect(line.quantity).toBe(o.quantity === 0 ? 0 : -o.quantity)
      expect(Object.is(line.quantity, -0)).toBe(false)
      expect(line.lineTotalCents).toBe(o.lineTotalCents === 0 ? 0 : -o.lineTotalCents)
    })
    expect(storno.totals.grossCents).toBe(-SAMPLE_TOTAL_CENTS)
    expect(storno.totals.netCents).toBe(-original.totals.netCents)
    expect(storno.totals.vatCents).toBe(-original.totals.vatCents)
    expect(storno.totals.byRate).toEqual(
      original.totals.byRate.map((b) => ({ rate: b.rate, grossCents: -b.grossCents, netCents: -b.netCents, vatCents: -b.vatCents }))
    )
  })

  it('Negation bleibt exakt bei Rundungsgrenzen (x,5 Cent)', () => {
    const f = insertFestival(ctx.db, { taxExempt: false })
    // 107 × 0,05 € → 5,35 € brutto bei 7 % → netto genau 5,00 €; 19 %: 0,01 € → netto 0,0084 → 0,01
    const products = insertProducts(ctx.db, f, [
      { name: 'Kleinteil', priceCents: 5, vatRate: 7, mode: 'feste_anzahl', defaultQuantity: 0 },
      { name: 'Cent', priceCents: 1, vatRate: 19, mode: 'feste_anzahl', defaultQuantity: 0 },
      { name: 'Halber', priceCents: 119, vatRate: 19, mode: 'feste_anzahl', defaultQuantity: 0 }
    ])
    const draft = buildDraft(f, products)
    draft.lines = [
      { productId: products[0]!, name: 'Kleinteil', priceCents: 5, vatRate: 7, quantity: 107 },
      { productId: products[1]!, name: 'Cent', priceCents: 1, vatRate: 19, quantity: 1 },
      { productId: products[2]!, name: 'Halber', priceCents: 119, vatRate: 19, quantity: 3 }
    ]
    const { id } = createInvoiceRecord(draft, ctx.db)
    const original = repo.findInvoice(ctx.db, id)!
    const storno = repo.findInvoice(ctx.db, createStornoRecord(id, 'Test', ctx.db).id)!
    expect(storno.totals.grossCents + original.totals.grossCents).toBe(0)
    expect(storno.totals.netCents + original.totals.netCents).toBe(0)
    expect(storno.totals.vatCents + original.totals.vatCents).toBe(0)
  })

  it('Nummer aus derselben Reihe, Status und Verknüpfung', () => {
    const f = insertFestival(ctx.db, { numberStart: 81 })
    const products = insertProducts(ctx.db, f)
    const { id } = createInvoiceRecord(buildDraft(f, products), ctx.db)
    const s = createStornoRecord(id, '  Doppelt erfasst  ', ctx.db)
    expect(s.number).toBe('2025-082')
    expect(createInvoiceRecord(buildDraft(f, products), ctx.db).number).toBe('2025-083')
    expect(numberNext(ctx.db, f)).toBe(84)

    const original = repo.findInvoice(ctx.db, id)!
    const storno = repo.findInvoice(ctx.db, s.id)!
    expect(original).toMatchObject({ status: 'storniert', stornoInvoiceId: s.id, stornoNumber: '2025-082', type: 'rechnung' })
    expect(storno).toMatchObject({
      type: 'storno',
      status: 'abgeschlossen',
      seq: 82,
      originalInvoiceId: id,
      originalNumber: '2025-081',
      stornoReason: 'Doppelt erfasst',
      stornoInvoiceId: null
    })
    const list = listInvoices(f, ctx.db)
    expect(list.find((i) => i.id === id)).toMatchObject({ status: 'storniert', stornoNumber: '2025-082' })
    expect(list.find((i) => i.id === s.id)).toMatchObject({ type: 'storno', originalNumber: '2025-081', totalGrossCents: -SAMPLE_TOTAL_CENTS })
  })

  it('übernimmt Kunde, Zahlart, Leistungsdatum und Personen (positiv); Rechnungsdatum heute; aktuelle Vorlage', () => {
    const template = getDefaultTemplateConfig()
    const f = insertFestival(ctx.db, { template, logoFile: 'alt.png' })
    const products = insertProducts(ctx.db, f)
    const { id } = createInvoiceRecord(
      buildDraft(f, products, { paymentKind: 'ueberweisung', invoiceDate: '2025-05-30', serviceDate: '2025-06-01', persons: 40 }),
      ctx.db
    )
    const original = repo.findInvoice(ctx.db, id)!
    const newTemplate = { ...template, stornoSubject: { ...template.stornoSubject, html: '<p>Storno {Rechnungsnummer}</p>' } }
    ctx.db.prepare('UPDATE template SET config_json = ?, logo_file = ? WHERE festival_id = ?').run(JSON.stringify(newTemplate), 'neu.png', f)
    ctx.db.prepare("UPDATE payment_method SET label = 'Geändert' WHERE festival_id = ?").run(f)

    const now = new Date(2025, 5, 3, 12, 0, 0)
    const storno = repo.findInvoice(ctx.db, createStornoRecord(id, 'Test', ctx.db, now).id)!
    expect(storno.customer).toEqual(original.customer)
    expect(storno.persons).toBe(40)
    expect(storno.paymentKind).toBe('ueberweisung')
    expect(storno.paymentLabel).toBe('Überweisung')
    expect(storno.paymentText).toBe(original.paymentText)
    expect(storno.serviceDate).toBe('2025-06-01')
    expect(storno.invoiceDate).toBe('2025-06-03')
    expect(storno.dueDate).toBe('2025-06-17')
    expect(storno.template).toEqual(newTemplate)
    expect(storno.logoFile).toBe('neu.png')
    expect(storno.festivalName).toBe(original.festivalName)
    expect(storno.taxExempt).toBe(original.taxExempt)
    expect(storno.createdAt).toBe(now.toISOString())
  })

  it('Rechnungsdatum ist standardmäßig heute', () => {
    const f = insertFestival(ctx.db)
    const { id } = createInvoiceRecord(buildDraft(f, insertProducts(ctx.db, f)), ctx.db)
    expect(repo.findInvoice(ctx.db, createStornoRecord(id, 'Test', ctx.db).id)!.invoiceDate).toBe(todayIso())
  })

  it('nur einmal möglich, Stornobelege nicht stornierbar, Grund Pflicht – jeweils ohne Speichern', () => {
    const f = insertFestival(ctx.db)
    const { id } = createInvoiceRecord(buildDraft(f, insertProducts(ctx.db, f)), ctx.db)

    for (const reason of ['', '   ', null as unknown as string]) {
      expect(() => createStornoRecord(id, reason, ctx.db)).toThrow('Bitte einen Grund für das Storno angeben.')
    }
    expect(countInvoices(ctx.db)).toBe(1)

    const s = createStornoRecord(id, 'Fehler', ctx.db)
    const invoices = countInvoices(ctx.db)
    const lines = countLines(ctx.db)
    const next = numberNext(ctx.db, f)
    expect(() => createStornoRecord(id, 'Nochmal', ctx.db)).toThrow('Die Rechnung 2025-081 wurde bereits storniert (Stornobeleg 2025-082).')
    expect(() => createStornoRecord(s.id, 'Storno vom Storno', ctx.db)).toThrow('Ein Stornobeleg kann nicht storniert werden.')
    expect(() => createStornoRecord(999, 'x', ctx.db)).toThrow('Die Rechnung wurde nicht gefunden.')
    expect(countInvoices(ctx.db)).toBe(invoices)
    expect(countLines(ctx.db)).toBe(lines)
    expect(numberNext(ctx.db, f)).toBe(next)
  })

  it('Unique-Index verhindert ein zweites Storno auch auf DB-Ebene', () => {
    const f = insertFestival(ctx.db)
    const { id } = createInvoiceRecord(buildDraft(f, insertProducts(ctx.db, f)), ctx.db)
    createStornoRecord(id, 'Fehler', ctx.db)
    const row = ctx.db.prepare('SELECT * FROM invoice WHERE original_invoice_id = ?').get(id) as Record<string, unknown>
    const copy: Record<string, unknown> = { ...row, number: 'X-1' }
    delete copy.id
    const cols = Object.keys(copy)
    expect(() =>
      ctx.db.prepare(`INSERT INTO invoice (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => copy[c]))
    ).toThrow(/UNIQUE constraint failed: invoice\.original_invoice_id/)
  })

  it('Nummernkollision beim Storno: nichts gespeichert, Original bleibt abgeschlossen', () => {
    const a = insertFestival(ctx.db, { name: 'A', numberStart: 81 })
    const b = insertFestival(ctx.db, { name: 'B', numberStart: 82 })
    const { id } = createInvoiceRecord(buildDraft(a, insertProducts(ctx.db, a)), ctx.db)
    createInvoiceRecord(buildDraft(b, insertProducts(ctx.db, b)), ctx.db) // belegt 2025-082
    expect(() => createStornoRecord(id, 'Test', ctx.db)).toThrow('Die Rechnungsnummer 2025-082 existiert bereits (anderes Fest?)')
    expect(repo.findInvoice(ctx.db, id)!.status).toBe('abgeschlossen')
    expect(numberNext(ctx.db, a)).toBe(82)
  })

  it('stornoInvoice: PDF unter Stornos/, Druck wie eine Rechnung', async () => {
    const f = insertFestival(ctx.db, { name: 'Testfest 2025', copies: 3 })
    const { invoice } = await finalizeInvoice(buildDraft(f, insertProducts(ctx.db, f)), {}, ctx.db)
    const result = await stornoInvoice(invoice.id, 'Falscher Verein', { printer: 'Storno-Drucker' }, ctx.db)
    const expected = join(ctx.documentsDir, 'Testfest 2025', 'Stornos', '2025-082.pdf')
    expect(result.pdf).toEqual({ ok: true, path: expected })
    expect(existsSync(expected)).toBe(true)
    expect(result.print).toMatchObject({ ok: true, printer: 'Storno-Drucker', copies: 3, dryRun: true })
    expect(result.invoice).toMatchObject({ type: 'storno', number: '2025-082', printed: true, pdfPath: expected })
    expect(repo.findInvoice(ctx.db, invoice.id)!.status).toBe('storniert')
  })
})
