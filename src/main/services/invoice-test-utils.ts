/**
 * Test-Helfer für die Unit-Tests des Bereichs „Abschluss & Druck“ (nur von *.test.ts importiert).
 *
 * - `electronMock()` ersetzt das Modul `electron` (Vitest läuft ohne Electron-Laufzeit):
 *     vi.mock('electron', async () => (await import('./invoice-test-utils')).electronMock())
 * - `setupTestContext()` liefert eine migrierte In-Memory-DB, temporäres App-Datenverzeichnis und
 *   temporären Dokumentenordner. Fest, Zahlungsarten, Vorlage und Produkte per eigenem SQL.
 * Alle Daten sind erfunden (Musterdaten); Produkte/Preise/Mengen wie in der Beispielrechnung.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDefaultTemplateConfig } from '@shared/invoice-render/default-template'
import type { InvoiceDraft, ProductMode, TemplateConfig, VatRate } from '@shared/types'
import { nowIso, openDatabase, type Db } from '../db/connection'
import { updateSettings } from './settings'

export const testEnv = { userData: tmpdir() }

export function electronMock(): Record<string, unknown> {
  class UnavailableWindow {
    constructor() {
      throw new Error('BrowserWindow ist im Unit-Test nicht verfügbar.')
    }
  }
  return {
    app: {
      isPackaged: false,
      getPath: (name: string) => (name === 'userData' ? testEnv.userData : tmpdir()),
      getAppPath: () => process.cwd(),
      on: () => undefined,
      removeListener: () => undefined
    },
    BrowserWindow: UnavailableWindow,
    session: {
      fromPartition: () => {
        throw new Error('session ist im Unit-Test nicht verfügbar.')
      }
    },
    dialog: { showSaveDialog: async () => ({ canceled: true, filePath: '' }) },
    shell: { openPath: async () => '', showItemInFolder: () => undefined }
  }
}

export interface SampleProduct {
  name: string
  priceCents: number
  vatRate: VatRate
  mode: ProductMode
  defaultQuantity: number
}

/** Die 8 Produkte der Beispielrechnung (Preise öffentlich übernehmbar, siehe CLAUDE.md). */
export const SAMPLE_PRODUCTS: SampleProduct[] = [
  { name: '1 Maß Bier (ohne Bedienung)', priceCents: 970, vatRate: 19, mode: 'feste_anzahl', defaultQuantity: 0 },
  { name: 'Brotzeit', priceCents: 800, vatRate: 7, mode: 'feste_anzahl', defaultQuantity: 0 },
  { name: 'Festzeichen', priceCents: 300, vatRate: 19, mode: 'pro_person', defaultQuantity: 1 },
  { name: 'Festessen', priceCents: 1450, vatRate: 7, mode: 'pro_person', defaultQuantity: 1 },
  { name: 'Korsoeinsatz', priceCents: 200, vatRate: 19, mode: 'feste_anzahl', defaultQuantity: 0 },
  { name: 'Käsespätzle', priceCents: 1000, vatRate: 7, mode: 'feste_anzahl', defaultQuantity: 0 },
  { name: 'Festschrift', priceCents: 1500, vatRate: 7, mode: 'feste_anzahl', defaultQuantity: 1 },
  { name: 'Alkoholfreies Getränk (0,5l)', priceCents: 380, vatRate: 19, mode: 'feste_anzahl', defaultQuantity: 0 }
]
/** Mengen der Beispielrechnung → 670,20 € */
export const SAMPLE_QUANTITIES = [0, 0, 45, 18, 0, 13, 1, 34]
export const SAMPLE_TOTAL_CENTS = 67020

export interface FestivalFixture {
  name?: string
  festivalDate?: string
  numberPrefix?: string
  numberStart?: number
  numberDigits?: number
  copies?: number
  taxExempt?: boolean
  taxExemptText?: string
  filenamePattern?: string
  archived?: boolean
  template?: TemplateConfig
  logoFile?: string | null
}

export interface TestContext {
  db: Db
  root: string
  userData: string
  documentsDir: string
  cleanup: () => void
}

export function setupTestContext(opts: { printer?: string | null } = {}): TestContext {
  delete process.env.FESTBUERO_REAL_PRINT
  delete process.env.FESTBUERO_FAKE_PRINT_FAIL
  delete process.env.FESTBUERO_FAKE_PDF_FAIL
  process.env.FESTBUERO_PRINT_DRY_RUN = '1'
  const root = mkdtempSync(join(tmpdir(), 'festbuero-unit-'))
  const userData = join(root, 'userData')
  const documentsDir = join(root, 'Dokumente')
  mkdirSync(userData, { recursive: true })
  mkdirSync(documentsDir, { recursive: true })
  testEnv.userData = userData
  const db = openDatabase(':memory:')
  const printer = opts.printer === undefined ? 'Testdrucker' : opts.printer
  updateSettings({ documentsDir, defaultPrinter: printer }, db)
  return {
    db,
    root,
    userData,
    documentsDir,
    cleanup: () => {
      db.close()
      rmSync(root, { recursive: true, force: true })
    }
  }
}

export function insertFestival(db: Db, f: FestivalFixture = {}): number {
  const now = nowIso()
  const start = f.numberStart ?? 81
  const result = db
    .prepare(
      `INSERT INTO festival (name, festival_date, number_prefix, number_start, number_next, number_digits, copies,
         tax_exempt, tax_exempt_text, filename_pattern, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      f.name ?? 'Testfest 2025',
      f.festivalDate ?? '2025-06-01',
      f.numberPrefix ?? '2025-',
      start,
      start,
      f.numberDigits ?? 3,
      f.copies ?? 2,
      (f.taxExempt ?? true) ? 1 : 0,
      f.taxExemptText ?? 'Als Kleinunternehmer im Sinne von § 19 UStG wird keine Umsatzsteuer berechnet.',
      f.filenamePattern ?? '{Rechnungsnummer}',
      f.archived ? 1 : 0,
      now,
      now
    )
  const id = Number(result.lastInsertRowid)
  const pm = db.prepare(
    'INSERT INTO payment_method (festival_id, kind, label, text, due_days, is_default) VALUES (?, ?, ?, ?, ?, ?)'
  )
  pm.run(id, 'bar', 'Bar', '<p>Betrag bar erhalten ____________________</p>', 7, 1)
  pm.run(
    id,
    'ueberweisung',
    'Überweisung',
    '<p>Bitte überweisen Sie den Betrag von {Gesamtbetrag} bis zum {Fälligkeitsdatum}.</p>',
    14,
    0
  )
  db.prepare('INSERT INTO template (festival_id, config_json, logo_file, updated_at) VALUES (?, ?, ?, ?)').run(
    id,
    JSON.stringify(f.template ?? getDefaultTemplateConfig()),
    f.logoFile ?? null,
    now
  )
  return id
}

export function insertProducts(db: Db, festivalId: number, products: SampleProduct[] = SAMPLE_PRODUCTS): number[] {
  const stmt = db.prepare(
    `INSERT INTO product (festival_id, name, price_cents, vat_rate, mode, default_quantity, sort_order, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
  )
  return products.map((p, i) =>
    Number(stmt.run(festivalId, p.name, p.priceCents, p.vatRate, p.mode, p.defaultQuantity, i).lastInsertRowid)
  )
}

export function insertClub(db: Db, festivalId: number, clubName = 'Musterverein Beispielhausen e.V.'): number {
  const now = nowIso()
  return Number(
    db
      .prepare(
        `INSERT INTO club (festival_id, contact_name, club_name, street, zip, city, registered_persons, source, created_at, updated_at)
         VALUES (?, 'Erika Musterfrau', ?, 'Musterweg 3', '01234', 'Beispielhausen', 45, 'manual', ?, ?)`
      )
      .run(festivalId, clubName, now, now).lastInsertRowid
  )
}

/** Entwurf wie aus der Maske: Verein, 45 Personen, Mengen der Beispielrechnung. */
export function buildDraft(
  festivalId: number,
  productIds: number[],
  overrides: Partial<InvoiceDraft> = {},
  quantities: number[] = SAMPLE_QUANTITIES
): InvoiceDraft {
  return {
    festivalId,
    customer: {
      kind: 'verein',
      clubId: null,
      contactName: 'Erika Musterfrau',
      clubName: 'Musterverein Beispielhausen e.V.',
      street: 'Musterweg 3',
      zip: '01234',
      city: 'Beispielhausen',
      registeredPersons: 45
    },
    persons: 45,
    paymentKind: 'bar',
    invoiceDate: '2025-06-01',
    serviceDate: '2025-06-01',
    lines: SAMPLE_PRODUCTS.map((p, i) => ({
      productId: productIds[i] ?? null,
      name: p.name,
      priceCents: p.priceCents,
      vatRate: p.vatRate,
      quantity: quantities[i] ?? 0
    })),
    ...overrides
  }
}

export function countInvoices(db: Db): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM invoice').get() as { n: number }).n
}

export function countLines(db: Db): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM invoice_line').get() as { n: number }).n
}

export function numberNext(db: Db, festivalId: number): number {
  return (db.prepare('SELECT number_next FROM festival WHERE id = ?').get(festivalId) as { number_next: number }).number_next
}
