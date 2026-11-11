import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDefaultTemplateConfig } from '@shared/invoice-render/default-template'
import type { FestivalCreateInput } from '@shared/types'
import { openDatabase, type Db } from '../db/connection'
import { createFestival, DEFAULT_TAX_EXEMPT_TEXT, getFestival, listFestivals, updateFestival } from './festivals'

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
})
