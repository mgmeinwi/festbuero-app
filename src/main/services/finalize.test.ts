import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultTemplateConfig } from '@shared/invoice-render/default-template'
import type { InvoiceDraft } from '@shared/types'
import * as repo from '../db/repositories/invoices'
import {
  buildDraft,
  countInvoices,
  countLines,
  insertClub,
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
  return {
    ...actual,
    renderHtmlToPdf: vi.fn(async (html: string) => Buffer.from(`%PDF-1.4\n% Unit-Test ${html.length}\n%%EOF\n`))
  }
})

import { renderHtmlToPdf } from './pdf'
import { createInvoiceRecord, finalizeInvoice, getInvoice, listInvoices, nextNumberPreview, numberCollisionMessage } from './finalize'
import { ensureInvoicePdf } from './filing'
import { updateSettings } from './settings'

const renderMock = vi.mocked(renderHtmlToPdf)

function dryRunLog(ctx: TestContext): Array<Record<string, unknown>> {
  const path = join(ctx.userData, 'print-dry-run.log')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
}

describe('Abschluss: Nummernvergabe', () => {
  let ctx: TestContext
  beforeEach(() => {
    ctx = setupTestContext()
    renderMock.mockClear()
  })
  afterEach(() => ctx.cleanup())

  it('vergibt fortlaufende Nummern mit Präfix und Stellenzahl und erhöht den Zähler', () => {
    const f = insertFestival(ctx.db, { numberPrefix: '2025-', numberStart: 81, numberDigits: 3 })
    const products = insertProducts(ctx.db, f)
    expect(nextNumberPreview(f, ctx.db)).toBe('2025-081')

    const a = createInvoiceRecord(buildDraft(f, products), ctx.db)
    const b = createInvoiceRecord(buildDraft(f, products), ctx.db)
    expect(a.number).toBe('2025-081')
    expect(b.number).toBe('2025-082')
    expect(repo.findInvoice(ctx.db, a.id)!.seq).toBe(81)
    expect(repo.findInvoice(ctx.db, b.id)!.seq).toBe(82)
    expect(numberNext(ctx.db, f)).toBe(83)
    expect(nextNumberPreview(f, ctx.db)).toBe('2025-083')
  })

  it('berücksichtigt Startnummer und Stellenzahl (ohne abzuschneiden)', () => {
    const f1 = insertFestival(ctx.db, { numberPrefix: 'A-', numberStart: 7, numberDigits: 5 })
    const p1 = insertProducts(ctx.db, f1)
    expect(createInvoiceRecord(buildDraft(f1, p1), ctx.db).number).toBe('A-00007')

    const f2 = insertFestival(ctx.db, { numberPrefix: '', numberStart: 9, numberDigits: 1 })
    const p2 = insertProducts(ctx.db, f2)
    expect(createInvoiceRecord(buildDraft(f2, p2), ctx.db).number).toBe('9')
    expect(createInvoiceRecord(buildDraft(f2, p2), ctx.db).number).toBe('10')
  })

  it('Kollision mit einer Nummer eines anderen Fests: nichts gespeichert, Zähler unverändert', () => {
    const a = insertFestival(ctx.db, { name: 'Fest A', numberPrefix: '2025-', numberStart: 81 })
    const b = insertFestival(ctx.db, { name: 'Fest B', numberPrefix: '2025-', numberStart: 81 })
    const pa = insertProducts(ctx.db, a)
    const pb = insertProducts(ctx.db, b)
    createInvoiceRecord(buildDraft(a, pa), ctx.db)
    const invoicesBefore = countInvoices(ctx.db)
    const linesBefore = countLines(ctx.db)

    expect(() => createInvoiceRecord(buildDraft(b, pb), ctx.db)).toThrow(
      'Die Rechnungsnummer 2025-081 existiert bereits (anderes Fest?). Bitte Präfix oder Startnummer prüfen.'
    )
    expect(numberCollisionMessage('2025-081')).toContain('anderes Fest?')
    expect(countInvoices(ctx.db)).toBe(invoicesBefore)
    expect(countLines(ctx.db)).toBe(linesBefore)
    expect(numberNext(ctx.db, b)).toBe(81)
    expect(numberNext(ctx.db, a)).toBe(82)
  })

  it('finalize bei Kollision wirft und erzeugt weder PDF noch Druck', async () => {
    const a = insertFestival(ctx.db, { name: 'Fest A' })
    const b = insertFestival(ctx.db, { name: 'Fest B' })
    await finalizeInvoice(buildDraft(a, insertProducts(ctx.db, a)), {}, ctx.db)
    renderMock.mockClear()
    await expect(finalizeInvoice(buildDraft(b, insertProducts(ctx.db, b)), {}, ctx.db)).rejects.toThrow('existiert bereits')
    expect(renderMock).not.toHaveBeenCalled()
    expect(dryRunLog(ctx)).toHaveLength(1)
  })
})

describe('Abschluss: Validierung', () => {
  let ctx: TestContext
  let f: number
  let products: number[]
  beforeEach(() => {
    ctx = setupTestContext()
    f = insertFestival(ctx.db)
    products = insertProducts(ctx.db, f)
  })
  afterEach(() => ctx.cleanup())

  function expectRejected(draft: InvoiceDraft, message: string | RegExp): void {
    expect(() => createInvoiceRecord(draft, ctx.db)).toThrow(message)
    expect(countInvoices(ctx.db)).toBe(0)
    expect(countLines(ctx.db)).toBe(0)
    expect(numberNext(ctx.db, f)).toBe(81)
  }

  it('sperrt Rechnungen mit Endbetrag 0 €', () => {
    expectRejected(buildDraft(f, products, {}, [0, 0, 0, 0, 0, 0, 0, 0]), 'Endbetrag 0 €')
    const freeLines = buildDraft(f, products)
    freeLines.lines = freeLines.lines.map((l) => ({ ...l, priceCents: 0 }))
    expectRejected(freeLines, 'Endbetrag 0 €')
  })

  it('verlangt einen Dokumentenordner', () => {
    updateSettings({ documentsDir: null }, ctx.db)
    expectRejected(buildDraft(f, products), 'Bitte zuerst in den Einstellungen einen Dokumentenordner wählen.')
    updateSettings({ documentsDir: join(ctx.root, 'gibt-es-nicht') }, ctx.db)
    expectRejected(buildDraft(f, products), /Dokumentenordner .* wurde nicht gefunden/)
  })

  it('prüft Fest und Archivierung', () => {
    expectRejected(buildDraft(9999, products), 'Das Gründungsfest wurde nicht gefunden.')
    ctx.db.prepare('UPDATE festival SET archived = 1 WHERE id = ?').run(f)
    expectRejected(buildDraft(f, products), /archiviert/)
  })

  it('prüft die Zahlungsart', () => {
    expectRejected(buildDraft(f, products, { paymentKind: 'karte' as never }), 'gültige Zahlungsart')
    ctx.db.prepare("DELETE FROM payment_method WHERE festival_id = ? AND kind = 'ueberweisung'").run(f)
    expectRejected(buildDraft(f, products, { paymentKind: 'ueberweisung' }), /Überweisung.*nicht eingerichtet/)
  })

  it('prüft Daten auf gültige ISO-Daten', () => {
    expectRejected(buildDraft(f, products, { invoiceDate: '2025-02-30' }), 'gültiges Rechnungsdatum')
    expectRejected(buildDraft(f, products, { invoiceDate: '01.06.2025' }), 'gültiges Rechnungsdatum')
    expectRejected(buildDraft(f, products, { serviceDate: '' }), 'gültiges Leistungsdatum')
  })

  it('prüft Mengen, Preise, Steuersätze, Bezeichnungen und Produkt-IDs', () => {
    const variants: Array<[(d: InvoiceDraft) => void, RegExp]> = [
      [(d) => (d.lines[2]!.quantity = -1), /Festzeichen.*Menge muss eine ganze Zahl ab 0/],
      [(d) => (d.lines[2]!.quantity = 1.5), /Menge muss eine ganze Zahl ab 0/],
      [(d) => (d.lines[2]!.priceCents = -300), /Preis muss ein Betrag ab 0/],
      [(d) => (d.lines[2]!.priceCents = 2.5), /Preis muss ein Betrag ab 0/],
      [(d) => (d.lines[2]!.vatRate = 16 as never), /MwSt-Satz muss 7 % oder 19 %/],
      [(d) => (d.lines[2]!.name = '   '), /Position 3: Die Bezeichnung fehlt/],
      [(d) => (d.lines[2]!.productId = 424242), /gehört nicht zu diesem Fest/],
      [(d) => (d.lines = []), /keine Positionen/]
    ]
    for (const [mutate, message] of variants) {
      const draft = buildDraft(f, products)
      mutate(draft)
      expectRejected(draft, message)
    }
  })

  it('lehnt Produkte eines anderen Fests ab', () => {
    const other = insertFestival(ctx.db, { name: 'Anderes Fest', numberPrefix: 'X-' })
    const otherProducts = insertProducts(ctx.db, other)
    const draft = buildDraft(f, products)
    draft.lines[3]!.productId = otherProducts[3]!
    expectRejected(draft, /Festessen.*gehört nicht zu diesem Fest/)
  })

  it('prüft Kunde und Personen', () => {
    expectRejected(buildDraft(f, products, { customer: null as never }), /Kunden wählen/)
    const noClub = buildDraft(f, products)
    noClub.customer = { ...noClub.customer, clubName: '  ' }
    expectRejected(noClub, 'Bitte einen Verein auswählen.')
    expectRejected(buildDraft(f, products, { persons: -3 }), /Personenzahl/)
  })

  it('erlaubt freie Zusatzpositionen (productId null)', () => {
    const draft = buildDraft(f, products)
    draft.lines.push({ productId: null, name: 'Zusatzposition', priceCents: 150, vatRate: 19, quantity: 2 })
    const { id } = createInvoiceRecord(draft, ctx.db)
    const invoice = repo.findInvoice(ctx.db, id)!
    expect(invoice.lines.at(-1)).toMatchObject({ productId: null, name: 'Zusatzposition', lineTotalCents: 300, position: 9 })
    expect(invoice.totals.grossCents).toBe(SAMPLE_TOTAL_CENTS + 300)
  })
})

describe('Abschluss: Snapshot und Summen', () => {
  let ctx: TestContext
  beforeEach(() => {
    ctx = setupTestContext()
  })
  afterEach(() => ctx.cleanup())

  it('rechnet Zeilensummen und Summen neu (Beispielrechnung = 670,20 €)', () => {
    const f = insertFestival(ctx.db)
    const products = insertProducts(ctx.db, f)
    const draft = buildDraft(f, products)
    // Werte aus dem Renderer dürfen nie übernommen werden
    ;(draft.lines[2] as unknown as Record<string, unknown>).lineTotalCents = 1
    ;(draft as unknown as Record<string, unknown>).totals = { grossCents: 1 }
    const { id } = createInvoiceRecord(draft, ctx.db)
    const invoice = repo.findInvoice(ctx.db, id)!
    expect(invoice.totals.grossCents).toBe(SAMPLE_TOTAL_CENTS)
    expect(invoice.lines.map((l) => l.lineTotalCents)).toEqual([0, 0, 13500, 26100, 0, 13000, 1500, 12920])
    expect(invoice.lines).toHaveLength(8)
    const row = ctx.db.prepare('SELECT total_gross_cents, total_net_cents, total_vat_cents FROM invoice WHERE id = ?').get(id)
    expect(row).toEqual({
      total_gross_cents: 67020,
      total_net_cents: invoice.totals.netCents,
      total_vat_cents: invoice.totals.vatCents
    })
  })

  it('speichert Steueraufschlüsselung pro Satz (ohne Steuerbefreiung)', () => {
    const f = insertFestival(ctx.db, { taxExempt: false })
    const { id } = createInvoiceRecord(buildDraft(f, insertProducts(ctx.db, f)), ctx.db)
    const invoice = repo.findInvoice(ctx.db, id)!
    expect(invoice.taxExempt).toBe(false)
    expect(invoice.totals.byRate.map((b) => b.rate)).toEqual([7, 19])
    // 7 %: 26100 + 13000 + 1500 = 40600 brutto; 19 %: 13500 + 12920 = 26420 brutto
    expect(invoice.totals.byRate[0]).toEqual({ rate: 7, grossCents: 40600, netCents: 37944, vatCents: 2656 })
    expect(invoice.totals.byRate[1]).toEqual({ rate: 19, grossCents: 26420, netCents: 22202, vatCents: 4218 })
  })

  it('Snapshots sind unabhängig von späteren Produkt-, Vorlagen-, Vereins- und Feständerungen', () => {
    const template = getDefaultTemplateConfig()
    const f = insertFestival(ctx.db, { name: 'Musterfest', template, logoFile: 'abc.png' })
    const products = insertProducts(ctx.db, f)
    const clubId = insertClub(ctx.db, f)
    const draft = buildDraft(f, products, { paymentKind: 'ueberweisung' })
    draft.customer.clubId = clubId
    const { id } = createInvoiceRecord(draft, ctx.db)
    const before = repo.findInvoice(ctx.db, id)!

    // Stammdaten ändern
    ctx.db.prepare('UPDATE product SET name = ?, price_cents = 9999, vat_rate = 7 WHERE festival_id = ?').run('Geändert', f)
    const changedTemplate = { ...template, subject: { ...template.subject, html: '<p>Neu</p>' } }
    ctx.db
      .prepare('UPDATE template SET config_json = ?, logo_file = ? WHERE festival_id = ?')
      .run(JSON.stringify(changedTemplate), 'neu.png', f)
    ctx.db.prepare("UPDATE club SET club_name = 'Umbenannt', city = 'Anderswo' WHERE id = ?").run(clubId)
    ctx.db.prepare("UPDATE payment_method SET text = 'Neuer Text', label = 'Neu', due_days = 30 WHERE festival_id = ?").run(f)
    ctx.db.prepare("UPDATE festival SET name = 'Neuer Name', tax_exempt = 0, tax_exempt_text = 'x' WHERE id = ?").run(f)

    const after = repo.findInvoice(ctx.db, id)!
    expect(after).toEqual(before)
    expect(after.customer).toMatchObject({ clubId, clubName: 'Musterverein Beispielhausen e.V.', city: 'Beispielhausen' })
    expect(after.lines[3]).toMatchObject({ name: 'Festessen', priceCents: 1450, vatRate: 7 })
    expect(after.template).toEqual(template)
    expect(after.logoFile).toBe('abc.png')
    expect(after.paymentLabel).toBe('Überweisung')
    expect(after.paymentText).toContain('{Gesamtbetrag}')
    expect(after.dueDays).toBe(14)
    expect(after.dueDate).toBe('2025-06-15')
    expect(after.festivalName).toBe('Musterfest')
    expect(after.taxExempt).toBe(true)
  })

  it('Einzelrechnung ohne Personen und ohne Vereinsbezug', () => {
    const f = insertFestival(ctx.db)
    const products = insertProducts(ctx.db, f)
    const draft = buildDraft(f, products, {
      customer: { kind: 'einzel', clubId: 5, contactName: '', clubName: '', street: '', zip: '', city: '', registeredPersons: 3 },
      persons: 12
    })
    const { id } = createInvoiceRecord(draft, ctx.db)
    const invoice = repo.findInvoice(ctx.db, id)!
    expect(invoice.customer).toMatchObject({ kind: 'einzel', clubId: null, registeredPersons: null })
    expect(invoice.persons).toBeNull()
    expect(repo.listInvoices(ctx.db, f)[0]!.customerLabel).toBe('Einzelrechnung')
  })

  it('Rechnungen sind unveränderlich (Trigger)', () => {
    const f = insertFestival(ctx.db)
    const { id } = createInvoiceRecord(buildDraft(f, insertProducts(ctx.db, f)), ctx.db)
    expect(() => ctx.db.prepare('UPDATE invoice SET total_gross_cents = 1 WHERE id = ?').run(id)).toThrow(/unveränderlich/)
    expect(() => ctx.db.prepare('DELETE FROM invoice WHERE id = ?').run(id)).toThrow(/nicht gelöscht/)
    // erlaubte Updates
    repo.setPdf(ctx.db, id, '/x.pdf', '2025-06-01T10:00:00.000Z')
    repo.setPrintError(ctx.db, id, 'Fehler')
    repo.setPrinted(ctx.db, id, '2025-06-01T10:00:00.000Z')
    expect(repo.findInvoice(ctx.db, id)).toMatchObject({ pdfPath: '/x.pdf', printed: true, printError: null })
  })
})

describe('Abschluss: PDF, Ablage und Druck', () => {
  let ctx: TestContext
  beforeEach(() => {
    ctx = setupTestContext()
    renderMock.mockClear()
  })
  afterEach(() => ctx.cleanup())

  it('finalize: PDF unter <Fest>/Rechnungen/<Nummer>.pdf, Druck mit Kopienzahl des Fests', async () => {
    const f = insertFestival(ctx.db, { name: 'Testfest 2025', copies: 2 })
    const result = await finalizeInvoice(buildDraft(f, insertProducts(ctx.db, f)), {}, ctx.db)
    const expected = join(ctx.documentsDir, 'Testfest 2025', 'Rechnungen', '2025-081.pdf')
    expect(result.pdf).toEqual({ ok: true, path: expected })
    expect(existsSync(expected)).toBe(true)
    expect(readFileSync(expected, 'utf8')).toMatch(/^%PDF-1\.4/)
    expect(result.print).toMatchObject({ ok: true, dryRun: true, printer: 'Testdrucker', copies: 2 })
    expect(result.invoice).toMatchObject({ number: '2025-081', pdfPath: expected, printed: true, printError: null })
    expect(result.invoice.printedAt).toBeTruthy()
    expect(result.invoice.pdfCreatedAt).toBeTruthy()
    expect(dryRunLog(ctx)).toEqual([expect.objectContaining({ file: expected, printer: 'Testdrucker', copies: 2, ok: true })])
    // HTML kommt aus dem Snapshot
    expect(renderMock).toHaveBeenCalledTimes(1)
    expect(renderMock.mock.calls[0]![0]).toContain('2025-081')
  })

  it('opts.printer hat Vorrang vor dem Standarddrucker', async () => {
    const f = insertFestival(ctx.db)
    const result = await finalizeInvoice(buildDraft(f, insertProducts(ctx.db, f)), { printer: 'Anderer Drucker' }, ctx.db)
    expect(result.print.printer).toBe('Anderer Drucker')
    expect(dryRunLog(ctx)[0]).toMatchObject({ printer: 'Anderer Drucker' })
  })

  it('ohne Drucker: Druckfehler, Rechnung und PDF bleiben gültig', async () => {
    updateSettings({ defaultPrinter: null }, ctx.db)
    const f = insertFestival(ctx.db)
    const result = await finalizeInvoice(buildDraft(f, insertProducts(ctx.db, f)), {}, ctx.db)
    expect(result.pdf.ok).toBe(true)
    expect(result.print).toMatchObject({ ok: false, printer: null })
    expect(result.print.error).toMatch(/^Kein Drucker ausgewählt/)
    expect(result.invoice).toMatchObject({ number: '2025-081', printed: false, status: 'abgeschlossen' })
    expect(result.invoice.printError).toMatch(/^Kein Drucker ausgewählt/)
    expect(dryRunLog(ctx)).toHaveLength(0)
  })

  it('simulierter Druckfehler: Rechnung bleibt gültig, print_error gesetzt', async () => {
    process.env.FESTBUERO_FAKE_PRINT_FAIL = '1'
    try {
      const f = insertFestival(ctx.db)
      const result = await finalizeInvoice(buildDraft(f, insertProducts(ctx.db, f)), {}, ctx.db)
      expect(result.print).toMatchObject({ ok: false, dryRun: true })
      expect(result.invoice).toMatchObject({ printed: false, status: 'abgeschlossen' })
      expect(result.invoice.printError).toContain('simulierter Druckfehler')
      expect(numberNext(ctx.db, f)).toBe(82)
    } finally {
      delete process.env.FESTBUERO_FAKE_PRINT_FAIL
    }
  })

  it('PDF-Fehler: Rechnung bleibt gültig, kein Druck, Nachholen bei get', async () => {
    renderMock.mockRejectedValueOnce(new Error('PDF konnte nicht erzeugt werden: Test'))
    const f = insertFestival(ctx.db)
    const result = await finalizeInvoice(buildDraft(f, insertProducts(ctx.db, f)), {}, ctx.db)
    expect(result.pdf).toEqual({ ok: false, path: null, error: 'PDF konnte nicht erzeugt werden: Test' })
    expect(result.invoice).toMatchObject({ number: '2025-081', pdfPath: null, printed: false })
    expect(result.print.ok).toBe(false)
    expect(result.print.error).toMatch(/Kein PDF vorhanden/)
    expect(renderMock).toHaveBeenCalledTimes(1) // kein zweiter Versuch im Druckschritt
    expect(dryRunLog(ctx)).toHaveLength(0)

    const fetched = await getInvoice(result.invoice.id, ctx.db)
    expect(fetched.number).toBe('2025-081')
    expect(fetched.pdfPath).toBe(join(ctx.documentsDir, 'Testfest 2025', 'Rechnungen', '2025-081.pdf'))
    expect(existsSync(fetched.pdfPath!)).toBe(true)
    expect(numberNext(ctx.db, f)).toBe(82)
  })

  it('gelöschtes PDF wird bei get neu erzeugt, vorhandenes nicht', async () => {
    const f = insertFestival(ctx.db)
    const { invoice } = await finalizeInvoice(buildDraft(f, insertProducts(ctx.db, f)), {}, ctx.db)
    renderMock.mockClear()
    await getInvoice(invoice.id, ctx.db)
    expect(renderMock).not.toHaveBeenCalled()
    rmSync(invoice.pdfPath!)
    const again = await getInvoice(invoice.id, ctx.db)
    expect(renderMock).toHaveBeenCalledTimes(1)
    expect(again.pdfPath).toBe(invoice.pdfPath)
    expect(existsSync(again.pdfPath!)).toBe(true)
  })

  it('überschreibt nie: vorhandene Datei → „ (2)“', async () => {
    const f = insertFestival(ctx.db)
    const dir = join(ctx.documentsDir, 'Testfest 2025', 'Rechnungen')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '2025-081.pdf'), 'ALT')
    const result = await finalizeInvoice(buildDraft(f, insertProducts(ctx.db, f)), {}, ctx.db)
    expect(result.pdf.path).toBe(join(dir, '2025-081 (2).pdf'))
    expect(readFileSync(join(dir, '2025-081.pdf'), 'utf8')).toBe('ALT')
  })

  it('Dateinamensmuster mit unzulässigen Zeichen und Festname als Ordner', async () => {
    const f = insertFestival(ctx.db, { name: 'Fest: 100/Jahre?', filenamePattern: '{Rechnungsnummer} {Verein}' })
    const draft = buildDraft(f, insertProducts(ctx.db, f))
    draft.customer.clubName = 'Verein "A/B" <Test>'
    const result = await finalizeInvoice(draft, {}, ctx.db)
    expect(result.pdf.path).toBe(join(ctx.documentsDir, 'Fest_ 100_Jahre_', 'Rechnungen', '2025-081 Verein _A_B_ _Test_.pdf'))
  })

  it('gleichzeitige ensurePdf-Aufrufe erzeugen nur eine Datei', async () => {
    renderMock.mockRejectedValueOnce(new Error('PDF konnte nicht erzeugt werden: Test'))
    const f = insertFestival(ctx.db)
    const { invoice } = await finalizeInvoice(buildDraft(f, insertProducts(ctx.db, f)), {}, ctx.db)
    renderMock.mockClear()
    const [a, b] = await Promise.all([ensureInvoicePdf(invoice.id, ctx.db), ensureInvoicePdf(invoice.id, ctx.db)])
    expect(a).toEqual(b)
    expect(renderMock).toHaveBeenCalledTimes(1)
    expect(readdirSync(join(ctx.documentsDir, 'Testfest 2025', 'Rechnungen'))).toEqual(['2025-081.pdf'])
  })

  it('ensurePdf ohne Dokumentenordner liefert eine verständliche Meldung', async () => {
    renderMock.mockRejectedValueOnce(new Error('PDF konnte nicht erzeugt werden: Test'))
    const f = insertFestival(ctx.db)
    const { invoice } = await finalizeInvoice(buildDraft(f, insertProducts(ctx.db, f)), {}, ctx.db)
    updateSettings({ documentsDir: null }, ctx.db)
    expect(await ensureInvoicePdf(invoice.id, ctx.db)).toEqual({
      ok: false,
      path: null,
      error: 'Bitte zuerst in den Einstellungen einen Dokumentenordner wählen.'
    })
    expect(await ensureInvoicePdf(424242, ctx.db)).toMatchObject({ ok: false, error: 'Die Rechnung wurde nicht gefunden.' })
  })

  it('Liste: Mapping und Kundenbezeichnung', async () => {
    const f = insertFestival(ctx.db)
    const products = insertProducts(ctx.db, f)
    await finalizeInvoice(buildDraft(f, products), {}, ctx.db)
    const named = buildDraft(f, products, {
      customer: { kind: 'einzel', clubId: null, contactName: 'Max Muster', clubName: '', street: '', zip: '', city: '', registeredPersons: null },
      persons: null,
      paymentKind: 'ueberweisung'
    })
    await finalizeInvoice(named, {}, ctx.db)
    const list = listInvoices(f, ctx.db)
    expect(list.map((i) => i.number)).toEqual(['2025-082', '2025-081'])
    expect(list[0]).toMatchObject({
      customerLabel: 'Max Muster',
      customerKind: 'einzel',
      paymentKind: 'ueberweisung',
      paymentLabel: 'Überweisung',
      dueDate: '2025-06-15',
      totalGrossCents: SAMPLE_TOTAL_CENTS,
      printed: true,
      type: 'rechnung',
      status: 'abgeschlossen',
      originalNumber: null,
      stornoNumber: null
    })
    expect(list[1]).toMatchObject({ customerLabel: 'Musterverein Beispielhausen e.V.', persons: 45, dueDate: '2025-06-08' })
    expect(repo.customerLabel({ clubName: ' ', contactName: ' ' })).toBe('Einzelrechnung')
  })

  it('get wirft bei unbekannter Rechnung', async () => {
    await expect(getInvoice(4711, ctx.db)).rejects.toThrow('Die Rechnung wurde nicht gefunden.')
  })
})
