import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { calculateLineTotal, calculateTotals } from '@shared/tax'
import type { TemplateConfig } from '@shared/types'
import { openDatabase, type Db } from '../db/connection'
import {
  createSampleFestival,
  SAMPLE_CLUBS,
  SAMPLE_FESTIVAL_NAME,
  SAMPLE_PRODUCTS,
  sampleFestivalDate
} from './sample-data'

const LOGO_SOURCE = resolve(__dirname, '../../../resources/sample/beispiel-logo.svg')

interface ProductRow {
  name: string
  price_cents: number
  vat_rate: 7 | 19
  mode: string
  default_quantity: number
  sort_order: number
  active: number
}

function products(db: Db, festivalId: number): ProductRow[] {
  return db
    .prepare(
      'SELECT name, price_cents, vat_rate, mode, default_quantity, sort_order, active FROM product WHERE festival_id = ? ORDER BY sort_order, id'
    )
    .all(festivalId) as ProductRow[]
}

describe('Beispiel-Fest', () => {
  let db: Db
  let logosDir: string

  beforeEach(() => {
    db = openDatabase(':memory:')
    logosDir = mkdtempSync(join(tmpdir(), 'festbuero-sample-logos-'))
  })

  afterEach(() => {
    db.close()
    rmSync(logosDir, { recursive: true, force: true })
  })

  it('legt das Fest mit Präfix, Steuerbefreiung und Festdatum in naher Zukunft an', () => {
    const today = new Date(2026, 10, 11) // Mittwoch, 11.11.2026
    const f = createSampleFestival({ db, logosDir, logoSource: LOGO_SOURCE, today })
    expect(f).toMatchObject({
      name: SAMPLE_FESTIVAL_NAME,
      numberPrefix: 'BSP-',
      numberStart: 1,
      numberNext: 1,
      numberDigits: 3,
      taxExempt: true,
      archived: false
    })
    // erster Samstag ≥ 3 Wochen nach heute: 02.12.2026 (Mi) → 05.12.2026 (Sa)
    expect(f.festivalDate).toBe('2026-12-05')
    expect(sampleFestivalDate(new Date(2026, 10, 7))).toBe('2026-11-28') // Samstag + 21 Tage = Samstag
  })

  it('enthält die 8 Produkte der Beispielrechnung in der richtigen Reihenfolge', () => {
    const f = createSampleFestival({ db, logosDir, logoSource: LOGO_SOURCE })
    const rows = products(db, f.id)
    expect(rows.map((r) => [r.name, r.price_cents, r.vat_rate, r.mode, r.default_quantity])).toEqual([
      ['1 Maß Bier (ohne Bedienung)', 970, 19, 'feste_anzahl', 0],
      ['Brotzeit', 800, 7, 'feste_anzahl', 0],
      ['Festzeichen', 300, 19, 'pro_person', 0],
      ['Festessen', 1450, 7, 'feste_anzahl', 0],
      ['Korsoeinsatz', 200, 19, 'feste_anzahl', 0],
      ['Käsespätzle', 1000, 7, 'feste_anzahl', 0],
      ['Festschrift', 1500, 7, 'feste_anzahl', 1],
      ['Alkoholfreies Getränk (0,5l)', 380, 19, 'feste_anzahl', 0]
    ])
    expect(rows.every((r) => r.active === 1)).toBe(true)
    expect(new Set(rows.map((r) => r.sort_order)).size).toBe(8)
  })

  it('Abschluss mit 0/0/45/18/0/13/1/34 ergibt exakt 670,20 €', () => {
    const f = createSampleFestival({ db, logosDir, logoSource: LOGO_SOURCE })
    const quantities = [0, 0, 45, 18, 0, 13, 1, 34]
    const lines = products(db, f.id).map((p, i) => ({
      priceCents: p.price_cents,
      vatRate: p.vat_rate,
      quantity: quantities[i]!
    }))
    const totals = calculateTotals(lines)
    expect(totals.grossCents).toBe(67020)
    expect(lines.reduce((sum, l) => sum + calculateLineTotal(l.priceCents, l.quantity), 0)).toBe(67020)
    // gleiche Prüfung direkt über die Konstanten
    expect(calculateTotals(SAMPLE_PRODUCTS.map((p, i) => ({ ...p, quantity: quantities[i]! }))).grossCents).toBe(67020)
  })

  it('legt ca. 12 erfundene Vereine manuell an', () => {
    const f = createSampleFestival({ db, logosDir, logoSource: LOGO_SOURCE })
    const clubs = db
      .prepare('SELECT club_name, contact_name, zip, city, registered_persons, source FROM club WHERE festival_id = ?')
      .all(f.id) as Array<{ club_name: string; zip: string; registered_persons: number; source: string }>
    expect(clubs).toHaveLength(SAMPLE_CLUBS.length)
    expect(clubs.length).toBeGreaterThanOrEqual(10)
    expect(clubs.every((c) => c.source === 'manual')).toBe(true)
    expect(clubs.every((c) => c.registered_persons > 0 && c.registered_persons <= 100)).toBe(true)
    expect(clubs.every((c) => /^\d{5}$/.test(c.zip))).toBe(true)
    expect(new Set(clubs.map((c) => c.club_name)).size).toBe(clubs.length)
  })

  it('Vorlage: Standard-Vorlage mit Muster-Logo (inhaltsadressiert) und zwei Hinweisen', () => {
    const f = createSampleFestival({ db, logosDir, logoSource: LOGO_SOURCE })
    const row = db.prepare('SELECT config_json, logo_file FROM template WHERE festival_id = ?').get(f.id) as {
      config_json: string
      logo_file: string | null
    }
    const config = JSON.parse(row.config_json) as TemplateConfig
    expect(config.logo.enabled).toBe(true)
    expect(config.slots.notes.map((n) => n.html)).toEqual([
      '<p>Beim Verkauf der Essensmarken handelt es sich um einen durchlaufenden Posten für den Musterverein e.V.</p>',
      '<p>Der Verkauf des Festessens erfolgt im Namen von Partyservice Mustermann.</p>'
    ])
    const hash = createHash('sha256').update(readFileSync(LOGO_SOURCE)).digest('hex')
    expect(row.logo_file).toBe(`${hash}.svg`)
    expect(readFileSync(join(logosDir, row.logo_file!)).equals(readFileSync(LOGO_SOURCE))).toBe(true)
  })

  it('ohne Logo-Datei entsteht das Fest trotzdem', () => {
    const f = createSampleFestival({ db, logosDir, logoSource: join(logosDir, 'fehlt.svg') })
    const row = db.prepare('SELECT logo_file FROM template WHERE festival_id = ?').get(f.id) as { logo_file: string | null }
    expect(row.logo_file).toBeNull()
    expect(products(db, f.id)).toHaveLength(8)
  })

  it('mehrfach anlegbar mit eindeutigem Namen und Präfix (keine Nummernkollision)', () => {
    const a = createSampleFestival({ db, logosDir, logoSource: LOGO_SOURCE })
    const b = createSampleFestival({ db, logosDir, logoSource: LOGO_SOURCE })
    expect(a.numberPrefix).toBe('BSP-')
    expect(b.numberPrefix).toBe('BSP2-')
    expect(b.name).toBe(`${SAMPLE_FESTIVAL_NAME} (2)`)
    // dasselbe Logo wird nur einmal abgelegt
    expect(existsSync(logosDir)).toBe(true)
    const logos = db.prepare('SELECT DISTINCT logo_file FROM template WHERE logo_file IS NOT NULL').all()
    expect(logos).toHaveLength(1)
  })
})
