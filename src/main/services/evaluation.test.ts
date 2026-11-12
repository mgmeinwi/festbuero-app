import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { calculateTotals } from '@shared/tax'
import type { VatBreakdown } from '@shared/types'
import { openDatabase, type Db } from '../db/connection'
import { listClubs } from '../db/repositories/clubs'
import {
  buildClubReport,
  createClubResolver,
  getEvaluation,
  loadEvaluationSource,
  openTransfers,
  summarizePayments
} from './evaluation'
import { EINZEL, insertClub, insertFestival, insertInvoice, insertStorno, seedScenario, verein } from './evaluation-fixtures'

describe('Auswertung', () => {
  let db: Db
  beforeEach(() => {
    db = openDatabase(':memory:')
  })
  afterEach(() => db.close())

  it('liefert für ein Fest ohne Belege leere Werte', () => {
    const festivalId = insertFestival(db, { taxExempt: true })
    insertClub(db, festivalId, { clubName: 'Musterverein e.V.', registeredPersons: 12 })
    const e = getEvaluation(festivalId, db)
    expect(e).toMatchObject({
      festivalId,
      invoiceCount: 0,
      stornoCount: 0,
      totalGrossCents: 0,
      cashCents: 0,
      transferCents: 0,
      persons: 0,
      products: [],
      taxRates: [],
      perDay: [],
      showTaxRates: false
    })
    expect(e.clubsWithoutInvoice.map((c) => c.clubName)).toEqual(['Musterverein e.V.'])
    expect(e.clubsWithoutInvoice[0]!.hasInvoice).toBe(false)
  })

  it('wirft bei unbekanntem Fest eine deutsche Meldung', () => {
    expect(() => getEvaluation(4711, db)).toThrow('Das Gründungsfest wurde nicht gefunden.')
  })

  it('berechnet Kennzahlen mit Storno-Gegenrechnung', () => {
    const s = seedScenario(db)
    const e = getEvaluation(s.festivalId, db)
    expect(e.invoiceCount).toBe(5) // inkl. stornierter R002
    expect(e.stornoCount).toBe(1)
    // 320,00 + 167,00 + 13,00 − 167,00 + 140,00 + 67,50
    expect(e.totalGrossCents).toBe(54050)
    expect(e.cashCents).toBe(32000 + 1300 + 6750)
    expect(e.transferCents).toBe(14000)
    expect(e.cashCents + e.transferCents).toBe(e.totalGrossCents)
    // 18 + 12 − 12 (Storno, persons positiv gespeichert) + 10 + 5
    expect(e.persons).toBe(33)
  })

  it('fasst Produkte über die Produkt-ID zusammen, sortiert wie die Produktreihenfolge, Zusatzpositionen am Ende', () => {
    const s = seedScenario(db)
    // Produkt umbenennen: aktueller Name gilt, Gruppierung bleibt über die ID
    db.prepare('UPDATE product SET name = ? WHERE id = ?').run('Festessen (Menü)', s.products.essen)
    // Reihenfolge ändern: Festschrift nach vorne
    db.prepare('UPDATE product SET sort_order = -1 WHERE id = ?').run(s.products.schrift)
    const e = getEvaluation(s.festivalId, db)
    expect(e.products).toEqual([
      { name: 'Festschrift', quantity: 2, grossCents: 1000, productId: s.products.schrift },
      { name: 'Festessen (Menü)', quantity: 33, grossCents: 44550, productId: s.products.essen },
      { name: 'Getränkemarke', quantity: 40, grossCents: 8000, productId: s.products.marke },
      { name: 'Kaffee', quantity: 2, grossCents: 500, productId: null }
    ])
    expect(e.products.reduce((sum, p) => sum + p.grossCents, 0)).toBe(e.totalGrossCents)
  })

  it('gruppiert Zusatzpositionen ohne Produkt über die Bezeichnung', () => {
    const festivalId = insertFestival(db)
    const base = { festivalId, customer: EINZEL, persons: null, paymentKind: 'bar' as const, invoiceDate: '2025-06-01' }
    insertInvoice(db, { ...base, seq: 1, lines: [{ productId: null, name: 'Kaffee', priceCents: 250, vatRate: 19, quantity: 1 }] })
    insertInvoice(db, { ...base, seq: 2, lines: [{ productId: null, name: ' kaffee ', priceCents: 250, vatRate: 19, quantity: 3 }] })
    insertInvoice(db, { ...base, seq: 3, lines: [{ productId: null, name: 'Kuchen', priceCents: 180, vatRate: 7, quantity: 2 }] })
    const e = getEvaluation(festivalId, db)
    expect(e.products).toEqual([
      { name: 'Kaffee', quantity: 4, grossCents: 1000, productId: null },
      { name: 'Kuchen', quantity: 2, grossCents: 360, productId: null }
    ])
  })

  it('summiert die Steuersätze aus den gespeicherten Belegsummen (pro Beleg gerundet)', () => {
    const s = seedScenario(db)
    const e = getEvaluation(s.festivalId, db)
    expect(e.showTaxRates).toBe(true)
    expect(e.taxRates.map((t) => t.rate)).toEqual([7, 19])

    // 7 %: viermal 5,00 € (R001, R002, −S004, R005) → je netto 4,67 → 9,34 (nicht 9,35 aus 10,00 €)
    expect(e.taxRates[0]).toEqual({ rate: 7, grossCents: 1000, netCents: 934, vatCents: 66 })

    // 19 %: Summe der byRate-Werte der einzelnen Belege
    const source = loadEvaluationSource(s.festivalId, db)
    const expected19 = source.invoices
      .flatMap((inv) => calculateTotals(inv.lines).byRate)
      .filter((b) => b.rate === 19)
      .reduce<VatBreakdown>(
        (acc, b) => ({
          rate: 19,
          grossCents: acc.grossCents + b.grossCents,
          netCents: acc.netCents + b.netCents,
          vatCents: acc.vatCents + b.vatCents
        }),
        { rate: 19, grossCents: 0, netCents: 0, vatCents: 0 }
      )
    expect(e.taxRates[1]).toEqual(expected19)
    expect(e.taxRates[1]!.grossCents).toBe(53050)
    expect(e.taxRates.reduce((sum, t) => sum + t.grossCents, 0)).toBe(e.totalGrossCents)
    for (const t of e.taxRates) expect(t.netCents + t.vatCents).toBe(t.grossCents)
  })

  it('blendet Steuersätze bei Steuerbefreiung aus; steuerbefreite Belege weisen keine MwSt aus', () => {
    const s = seedScenario(db, { taxExempt: true })
    db.prepare('UPDATE festival SET tax_exempt = 1 WHERE id = ?').run(s.festivalId)
    const e = getEvaluation(s.festivalId, db)
    expect(e.showTaxRates).toBe(false)
    for (const t of e.taxRates) {
      expect(t.vatCents).toBe(0)
      expect(t.netCents).toBe(t.grossCents)
    }
  })

  it('zeigt Steuersätze bei Steuerbefreiung, wenn es Belege mit Steuer gibt', () => {
    const s = seedScenario(db) // Belege mit Steuer
    db.prepare('UPDATE festival SET tax_exempt = 1 WHERE id = ?').run(s.festivalId)
    expect(getEvaluation(s.festivalId, db).showTaxRates).toBe(true)
  })

  it('rechnet Umsatz pro Tag nach Rechnungsdatum (Stornos am Storno-Tag)', () => {
    const s = seedScenario(db)
    const e = getEvaluation(s.festivalId, db)
    expect(e.perDay).toEqual([
      { date: '2025-06-01', invoiceCount: 2, grossCents: 32000 + 16700 },
      { date: '2025-06-02', invoiceCount: 3, grossCents: 1300 - 16700 + 14000 + 6750 }
    ])
  })

  it('listet Vereine ohne nicht stornierte Rechnung', () => {
    const s = seedScenario(db)
    const e = getEvaluation(s.festivalId, db)
    // Sportfreunde: R002 storniert, aber R005 gültig → hat Rechnung
    expect(e.clubsWithoutInvoice.map((c) => c.clubName)).toEqual(['Trachtenverein Muster'])
    expect(e.clubsWithoutInvoice[0]).toMatchObject({ id: s.clubs.tracht, registeredPersons: 10, hasInvoice: false })
  })

  it('ein nur stornierter Verein gilt als ohne Rechnung', () => {
    const festivalId = insertFestival(db)
    const club = insertClub(db, festivalId, { clubName: 'Musterverein e.V.', registeredPersons: 5 })
    const data = {
      festivalId,
      seq: 1,
      customer: verein(club, 'Musterverein e.V.', 5),
      persons: 5,
      paymentKind: 'bar' as const,
      invoiceDate: '2025-06-01',
      lines: [{ productId: null, name: 'Festessen', priceCents: 1350, vatRate: 19 as const, quantity: 5 }]
    }
    const id = insertInvoice(db, data)
    expect(getEvaluation(festivalId, db).clubsWithoutInvoice).toHaveLength(0)
    insertStorno(db, { ...data, id }, { seq: 2, invoiceDate: '2025-06-01', reason: 'Test' })
    const e = getEvaluation(festivalId, db)
    expect(e.clubsWithoutInvoice.map((c) => c.id)).toEqual([club])
    expect(e.persons).toBe(0)
    expect(e.totalGrossCents).toBe(0)
  })

  it('ordnet Vereine nach erneutem Import über den Namen zu, nie über eine neu vergebene ID', () => {
    const festivalId = insertFestival(db)
    const a = insertClub(db, festivalId, { clubName: 'Musterverein e.V.', registeredPersons: 5 })
    const b = insertClub(db, festivalId, { clubName: 'Sportfreunde Beispielstadt', registeredPersons: 5 })
    const resolve = createClubResolver(loadEvaluationSource(festivalId, db).clubs)
    // ID passt, Name passt
    expect(resolve({ clubId: a, customer: verein(a, 'Musterverein e.V.') })?.id).toBe(a)
    // alte ID nach Re-Import, Name gleich (Groß-/Kleinschreibung, Leerzeichen egal)
    expect(resolve({ clubId: 999, customer: verein(999, '  musterverein   E.V. ') })?.id).toBe(a)
    // ID wurde an einen anderen Verein neu vergeben → nicht zuordnen
    expect(resolve({ clubId: b, customer: verein(b, 'Ganz anderer Verein') })).toBeNull()
    // Einzelrechnungen nie
    expect(resolve({ clubId: null, customer: EINZEL })).toBeNull()
  })

  it('ordnet Vereinsnamen wie „bereits abgerechnet“ zu (Satzzeichen/Umlaute egal, gleich wie listClubs)', () => {
    const festivalId = insertFestival(db)
    const ff = insertClub(db, festivalId, { clubName: 'FF Musterdorf e.V.', registeredPersons: 30 })
    const other = insertClub(db, festivalId, { clubName: 'Schützenverein Beispielstadt', registeredPersons: 12 })
    const resolve = createClubResolver(loadEvaluationSource(festivalId, db).clubs)
    // Re-Import: alte ID, Name mit anderer Schreibweise
    expect(resolve({ clubId: 999, customer: verein(999, 'FF Musterdorf e. V.') })?.id).toBe(ff)
    expect(resolve({ clubId: ff, customer: verein(ff, 'ff musterdorf e. v.') })?.id).toBe(ff)
    expect(resolve({ clubId: null, customer: verein(null, 'Schuetzenverein Beispielstadt') })?.id).toBe(other)
    expect(resolve({ clubId: null, customer: verein(null, 'FF Musterhausen e.V.') })).toBeNull()

    // Rechnung mit „FF Musterdorf e. V.“ (Leerzeichen im e. V.) → in der Auswertung und im Vereinsstamm abgerechnet
    insertInvoice(db, {
      festivalId,
      seq: 1,
      customer: verein(999, 'FF Musterdorf e. V.', 30),
      persons: 28,
      paymentKind: 'bar',
      invoiceDate: '2025-06-01',
      lines: [{ productId: null, name: 'Festessen', priceCents: 1450, vatRate: 7, quantity: 28 }]
    })
    const e = getEvaluation(festivalId, db)
    expect(e.clubsWithoutInvoice.map((c) => c.id)).toEqual([other])
    const hasInvoice = new Map(listClubs(db, festivalId).map((c) => [c.id, c.hasInvoice]))
    expect(hasInvoice.get(ff)).toBe(true)
    expect(hasInvoice.get(other)).toBe(false)
    // Vereinsbericht: Rechnung zählt beim Stammverein, keine zusätzliche Zeile „außerhalb des Stamms“
    const rows = buildClubReport(loadEvaluationSource(festivalId, db))
    expect(rows.find((r) => r.clubName === 'FF Musterdorf e.V.')).toMatchObject({ billedPersons: 28, invoiceCount: 1, inStamm: true })
    expect(rows.filter((r) => !r.inStamm)).toHaveLength(0)
  })

  it('Vereinsbericht: angemeldet vs. abgerechnet, inklusive Vereinen außerhalb des Stamms', () => {
    const s = seedScenario(db)
    const rows = buildClubReport(loadEvaluationSource(s.festivalId, db))
    expect(rows.map((r) => [r.clubName, r.registeredPersons, r.billedPersons, r.invoiceCount, r.grossCents, r.inStamm])).toEqual([
      ['Musterverein e.V.', 20, 18, 1, 32000, true],
      ['Sportfreunde Beispielstadt', 15, 10, 1, 14000, true],
      ['Trachtenverein Muster', 10, 0, 0, 0, true],
      ['Alter Verein', 8, 5, 1, 6750, false]
    ])
  })

  it('offene Überweisungen: nicht stornierte Überweisungsrechnungen nach Fälligkeit', () => {
    const s = seedScenario(db)
    const source = loadEvaluationSource(s.festivalId, db)
    expect(openTransfers(source.invoices).map((i) => i.number)).toEqual(['2025-005'])
    expect(summarizePayments(source.invoices)).toEqual([
      { kind: 'bar', label: 'Bar', invoiceCount: 3, stornoCount: 0, grossCents: 40050 },
      { kind: 'ueberweisung', label: 'Überweisung', invoiceCount: 2, stornoCount: 1, grossCents: 14000 }
    ])
  })

  it('lädt Bezüge zwischen Rechnung und Storno', () => {
    const s = seedScenario(db)
    const source = loadEvaluationSource(s.festivalId, db)
    const r2 = source.invoices.find((i) => i.id === s.invoices.r2)!
    const s4 = source.invoices.find((i) => i.id === s.invoices.s4)!
    expect(r2).toMatchObject({ status: 'storniert', stornoNumber: '2025-004', stornoInvoiceId: s4.id })
    expect(s4).toMatchObject({
      type: 'storno',
      originalNumber: '2025-002',
      stornoReason: 'Falsche Personenzahl',
      persons: 12,
      paymentKind: 'ueberweisung'
    })
    expect(s4.totals.grossCents).toBe(-16700)
    expect(source.invoices.find((i) => i.id === s.invoices.r3)!.customerLabel).toBe('Einzelrechnung')
  })

  it('trennt die Daten verschiedener Feste', () => {
    const s = seedScenario(db)
    const other = insertFestival(db, { name: 'Anderes Fest' })
    insertInvoice(db, {
      festivalId: other,
      seq: 100,
      customer: EINZEL,
      persons: null,
      paymentKind: 'bar',
      invoiceDate: '2025-07-01',
      lines: [{ productId: null, name: 'X', priceCents: 1000, vatRate: 19, quantity: 1 }]
    })
    expect(getEvaluation(s.festivalId, db).totalGrossCents).toBe(54050)
    expect(getEvaluation(other, db).totalGrossCents).toBe(1000)
  })
})
