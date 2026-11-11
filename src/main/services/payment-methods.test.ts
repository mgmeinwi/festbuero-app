import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '../db/connection'
import { createFestival } from './festivals'
import { getPaymentMethod, listPaymentMethods, updatePaymentMethod } from './payment-methods'

describe('payment-methods service', () => {
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

  const defaults = (id = festivalId) =>
    listPaymentMethods(id, db)
      .filter((m) => m.isDefault)
      .map((m) => m.kind)

  it('list liefert Bar vor Überweisung mit Standardwerten', () => {
    const list = listPaymentMethods(festivalId, db)
    expect(list.map((m) => [m.kind, m.label, m.dueDays, m.isDefault])).toEqual([
      ['bar', 'Bar', 7, true],
      ['ueberweisung', 'Überweisung', 7, false]
    ])
    expect(() => listPaymentMethods(999, db)).toThrow(/Gründungsfest wurde nicht gefunden/)
  })

  it('update ändert Anzeigename, Text und Frist', () => {
    const [, transfer] = listPaymentMethods(festivalId, db)
    const u = updatePaymentMethod(
      transfer!.id,
      { label: '  Bank  ', text: '<p>Bitte bis {Fälligkeitsdatum_DE} zahlen.</p>', dueDays: 14 },
      db
    )
    expect(u).toMatchObject({ label: 'Bank', text: '<p>Bitte bis {Fälligkeitsdatum_DE} zahlen.</p>', dueDays: 14, isDefault: false })
    expect(updatePaymentMethod(transfer!.id, { dueDays: 0 }, db).dueDays).toBe(0)
    expect(updatePaymentMethod(transfer!.id, { text: '' }, db).text).toBe('')
  })

  it('genau ein Standard pro Fest: Setzen setzt den anderen in derselben Transaktion zurück', () => {
    const [bar, transfer] = listPaymentMethods(festivalId, db)
    const other = createFestival(
      { name: 'Anderes', festivalDate: '2026-06-01', numberPrefix: '2026-', numberStart: 1, numberDigits: 3 },
      db
    )
    updatePaymentMethod(transfer!.id, { isDefault: true }, db)
    expect(defaults()).toEqual(['ueberweisung'])
    // andere Feste bleiben unberührt
    expect(defaults(other.id)).toEqual(['bar'])
    // erneut setzen ist idempotent
    updatePaymentMethod(transfer!.id, { isDefault: true }, db)
    expect(defaults()).toEqual(['ueberweisung'])
    updatePaymentMethod(bar!.id, { isDefault: true, label: 'Barzahlung' }, db)
    expect(defaults()).toEqual(['bar'])
    expect(getPaymentMethod(bar!.id, db).label).toBe('Barzahlung')
  })

  it('Abwählen des Standards übergibt ihn an die andere Zahlart', () => {
    const [bar, transfer] = listPaymentMethods(festivalId, db)
    updatePaymentMethod(bar!.id, { isDefault: false }, db)
    expect(defaults()).toEqual(['ueberweisung'])
    // Abwählen einer Nicht-Standard-Zahlart ändert nichts
    updatePaymentMethod(bar!.id, { isDefault: false }, db)
    expect(defaults()).toEqual(['ueberweisung'])
    expect(getPaymentMethod(transfer!.id, db).isDefault).toBe(true)
  })

  it('validiert mit deutschen Meldungen und ändert bei Fehlern nichts', () => {
    const [bar, transfer] = listPaymentMethods(festivalId, db)
    expect(() => updatePaymentMethod(bar!.id, { label: ' ' }, db)).toThrow('Bitte einen Anzeigenamen für die Zahlungsart angeben.')
    expect(() => updatePaymentMethod(bar!.id, { dueDays: -1 }, db)).toThrow('Die Zahlungsfrist muss eine ganze Zahl ab 0 Tagen sein.')
    expect(() => updatePaymentMethod(bar!.id, { dueDays: 2.5 }, db)).toThrow(/Zahlungsfrist/)
    expect(() => updatePaymentMethod(bar!.id, { dueDays: 366 }, db)).toThrow(/höchstens 365/)
    expect(() => updatePaymentMethod(bar!.id, { text: 5 as never }, db)).toThrow(/Zahlungstext/)
    expect(() => updatePaymentMethod(bar!.id, { isDefault: 'ja' as never }, db)).toThrow(/Standard/)
    // ungültige Frist zusammen mit Standardwechsel: nichts wird übernommen
    expect(() => updatePaymentMethod(transfer!.id, { isDefault: true, dueDays: -2 }, db)).toThrow(/Zahlungsfrist/)
    expect(defaults()).toEqual(['bar'])
    expect(() => updatePaymentMethod(999, { label: 'x' }, db)).toThrow('Die Zahlungsart wurde nicht gefunden.')
    expect(getPaymentMethod(bar!.id, db)).toMatchObject({ label: 'Bar', dueDays: 7 })
  })
})
