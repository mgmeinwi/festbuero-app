/**
 * Testdaten für die Unit-Tests von Auswertung und Excel-Exporten (nur für Tests).
 * Fügt Feste, Produkte, Vereine und Belege per SQL direkt in eine (In-Memory-)Datenbank ein.
 * Alle Namen sind erfunden.
 */
import { calculateLineTotal, calculateTotals } from '@shared/tax'
import type { CustomerSnapshot, PaymentKind, VatRate } from '@shared/types'
import type { Db } from '../db/connection'

const NOW = '2025-06-02T10:00:00.000Z'

export function insertFestival(db: Db, opts: { name?: string; taxExempt?: boolean } = {}): number {
  const info = db
    .prepare(
      `INSERT INTO festival (name, festival_date, number_prefix, number_start, number_next, number_digits, copies,
         tax_exempt, created_at, updated_at)
       VALUES (?, '2025-06-01', '2025-', 1, 1, 3, 2, ?, ?, ?)`
    )
    .run(opts.name ?? 'Testfest 2025', opts.taxExempt ? 1 : 0, NOW, NOW)
  return Number(info.lastInsertRowid)
}

export function insertProduct(
  db: Db,
  festivalId: number,
  p: { name: string; priceCents: number; vatRate: VatRate; sortOrder: number; active?: boolean }
): number {
  const info = db
    .prepare(
      `INSERT INTO product (festival_id, name, price_cents, vat_rate, mode, default_quantity, sort_order, active)
       VALUES (?, ?, ?, ?, 'pro_person', 1, ?, ?)`
    )
    .run(festivalId, p.name, p.priceCents, p.vatRate, p.sortOrder, p.active === false ? 0 : 1)
  return Number(info.lastInsertRowid)
}

export function insertClub(
  db: Db,
  festivalId: number,
  c: { clubName: string; contactName?: string; city?: string; registeredPersons: number; id?: number }
): number {
  const info = db
    .prepare(
      `INSERT INTO club (id, festival_id, contact_name, club_name, street, zip, city, registered_persons, source,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, 'Musterstraße 1', '01234', ?, ?, 'import', ?, ?)`
    )
    .run(
      c.id ?? null,
      festivalId,
      c.contactName ?? 'Max Muster',
      c.clubName,
      c.city ?? 'Musterstadt',
      c.registeredPersons,
      NOW,
      NOW
    )
  return Number(info.lastInsertRowid)
}

export interface FixtureLine {
  productId: number | null
  name: string
  priceCents: number
  vatRate: VatRate
  quantity: number
}

export interface FixtureInvoice {
  festivalId: number
  seq: number
  customer: CustomerSnapshot
  persons: number | null
  paymentKind: PaymentKind
  invoiceDate: string
  lines: FixtureLine[]
  taxExempt?: boolean
  printed?: boolean
}

export function verein(clubId: number | null, clubName: string, registeredPersons: number | null = 20): CustomerSnapshot {
  return {
    kind: 'verein',
    clubId,
    contactName: 'Erika Beispiel',
    clubName,
    street: 'Hauptstraße 5',
    zip: '01234',
    city: 'Musterstadt',
    registeredPersons
  }
}

export const EINZEL: CustomerSnapshot = {
  kind: 'einzel',
  clubId: null,
  contactName: '',
  clubName: '',
  street: '',
  zip: '',
  city: '',
  registeredPersons: null
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function insertRaw(
  db: Db,
  inv: FixtureInvoice & { type: 'rechnung' | 'storno'; originalId: number | null; reason: string | null }
): number {
  const totals = calculateTotals(inv.lines)
  const number = `2025-${String(inv.seq).padStart(3, '0')}`
  const paymentLabel = inv.paymentKind === 'bar' ? 'Bar' : 'Überweisung'
  const info = db
    .prepare(
      `INSERT INTO invoice (festival_id, number, seq, type, status, original_invoice_id, storno_reason, customer_kind,
         club_id, customer_json, persons, payment_kind, payment_label, payment_text, due_days, invoice_date,
         service_date, due_date, total_gross_cents, total_net_cents, total_vat_cents, totals_json, tax_exempt,
         tax_exempt_text, festival_name, template_json, logo_file, pdf_path, printed, printed_at, created_at)
       VALUES (?, ?, ?, ?, 'abgeschlossen', ?, ?, ?, ?, ?, ?, ?, ?, '<p>Text</p>', 7, ?, '2025-06-01', ?, ?, ?, ?, ?, ?,
         '§ 19', 'Testfest 2025', '{}', NULL, ?, ?, ?, ?)`
    )
    .run(
      inv.festivalId,
      number,
      inv.seq,
      inv.type,
      inv.originalId,
      inv.reason,
      inv.customer.kind,
      inv.customer.clubId,
      JSON.stringify(inv.customer),
      inv.persons,
      inv.paymentKind,
      paymentLabel,
      inv.invoiceDate,
      addDaysIso(inv.invoiceDate, 7),
      totals.grossCents,
      totals.netCents,
      totals.vatCents,
      JSON.stringify(totals),
      inv.taxExempt ? 1 : 0,
      `/tmp/festbuero-test/${number}.pdf`,
      inv.printed === false ? 0 : 1,
      inv.printed === false ? null : NOW,
      NOW
    )
  const id = Number(info.lastInsertRowid)
  const insertLine = db.prepare(
    `INSERT INTO invoice_line (invoice_id, position, product_id, name, price_cents, vat_rate, quantity, line_total_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  inv.lines.forEach((l, idx) => {
    insertLine.run(id, idx + 1, l.productId, l.name, l.priceCents, l.vatRate, l.quantity, calculateLineTotal(l.priceCents, l.quantity))
  })
  return id
}

export function insertInvoice(db: Db, inv: FixtureInvoice): number {
  return insertRaw(db, { ...inv, type: 'rechnung', originalId: null, reason: null })
}

/** Storno nach Konvention: negative Mengen/Summen, persons positiv, Zahlart vom Original, Original → storniert. */
export function insertStorno(
  db: Db,
  original: FixtureInvoice & { id: number },
  opts: { seq: number; invoiceDate: string; reason: string }
): number {
  const id = insertRaw(db, {
    ...original,
    seq: opts.seq,
    invoiceDate: opts.invoiceDate,
    lines: original.lines.map((l) => ({ ...l, quantity: -l.quantity })),
    type: 'storno',
    originalId: original.id,
    reason: opts.reason
  })
  db.prepare(`UPDATE invoice SET status = 'storniert' WHERE id = ?`).run(original.id)
  return id
}

export interface Scenario {
  festivalId: number
  products: { essen: number; marke: number; schrift: number }
  clubs: { muster: number; sport: number; tracht: number }
  invoices: { r1: number; r2: number; r3: number; s4: number; r5: number; r6: number }
}

/**
 * Standard-Szenario:
 * - R001 Musterverein, 18 P., bar, 01.06.: Festessen 18 × 13,50, Getränkemarke 36 × 2,00, Festschrift 1 × 5,00 = 320,00
 * - R002 Sportfreunde, 12 P., Überweisung, 01.06.: Festessen 12, Getränkemarke 0, Festschrift 1 = 167,00 (storniert)
 * - R003 Einzelrechnung, bar, 02.06.: Festessen 0, Getränkemarke 4, Zusatz „Kaffee“ 2 × 2,50 = 13,00
 * - S004 Storno zu R002, 02.06.: −167,00
 * - R005 Sportfreunde (neu), 10 P., Überweisung, 02.06.: Festessen 10, Festschrift 1 = 140,00
 * - R006 „Alter Verein“ (nicht mehr im Stamm), 5 P., bar, 02.06.: Festessen 5 = 67,50
 */
export function seedScenario(db: Db, opts: { taxExempt?: boolean } = {}): Scenario {
  const festivalId = insertFestival(db, { taxExempt: opts.taxExempt })
  const essen = insertProduct(db, festivalId, { name: 'Festessen', priceCents: 1350, vatRate: 19, sortOrder: 0 })
  const marke = insertProduct(db, festivalId, { name: 'Getränkemarke', priceCents: 200, vatRate: 19, sortOrder: 1 })
  const schrift = insertProduct(db, festivalId, { name: 'Festschrift', priceCents: 500, vatRate: 7, sortOrder: 2 })
  const muster = insertClub(db, festivalId, { clubName: 'Musterverein e.V.', registeredPersons: 20 })
  const sport = insertClub(db, festivalId, { clubName: 'Sportfreunde Beispielstadt', registeredPersons: 15 })
  const tracht = insertClub(db, festivalId, { clubName: 'Trachtenverein Muster', registeredPersons: 10 })

  const taxExempt = opts.taxExempt ?? false
  const line = (productId: number | null, name: string, priceCents: number, vatRate: VatRate, quantity: number) => ({
    productId,
    name,
    priceCents,
    vatRate,
    quantity
  })

  const r1 = insertInvoice(db, {
    festivalId,
    seq: 1,
    customer: verein(muster, 'Musterverein e.V.', 20),
    persons: 18,
    paymentKind: 'bar',
    invoiceDate: '2025-06-01',
    taxExempt,
    lines: [
      line(essen, 'Festessen', 1350, 19, 18),
      line(marke, 'Getränkemarke', 200, 19, 36),
      line(schrift, 'Festschrift', 500, 7, 1)
    ]
  })
  const r2Data: FixtureInvoice = {
    festivalId,
    seq: 2,
    customer: verein(sport, 'Sportfreunde Beispielstadt', 15),
    persons: 12,
    paymentKind: 'ueberweisung',
    invoiceDate: '2025-06-01',
    taxExempt,
    lines: [
      line(essen, 'Festessen', 1350, 19, 12),
      line(marke, 'Getränkemarke', 200, 19, 0),
      line(schrift, 'Festschrift', 500, 7, 1)
    ]
  }
  const r2 = insertInvoice(db, r2Data)
  const r3 = insertInvoice(db, {
    festivalId,
    seq: 3,
    customer: EINZEL,
    persons: null,
    paymentKind: 'bar',
    invoiceDate: '2025-06-02',
    taxExempt,
    printed: false,
    lines: [
      line(essen, 'Festessen', 1350, 19, 0),
      line(marke, 'Getränkemarke', 200, 19, 4),
      line(null, 'Kaffee', 250, 19, 2)
    ]
  })
  const s4 = insertStorno(db, { ...r2Data, id: r2 }, { seq: 4, invoiceDate: '2025-06-02', reason: 'Falsche Personenzahl' })
  const r5 = insertInvoice(db, {
    festivalId,
    seq: 5,
    customer: verein(sport, 'Sportfreunde Beispielstadt', 15),
    persons: 10,
    paymentKind: 'ueberweisung',
    invoiceDate: '2025-06-02',
    taxExempt,
    lines: [line(essen, 'Festessen', 1350, 19, 10), line(schrift, 'Festschrift', 500, 7, 1)]
  })
  const r6 = insertInvoice(db, {
    festivalId,
    seq: 6,
    customer: verein(999, 'Alter Verein', 8),
    persons: 5,
    paymentKind: 'bar',
    invoiceDate: '2025-06-02',
    taxExempt,
    lines: [line(essen, 'Festessen', 1350, 19, 5)]
  })
  return {
    festivalId,
    products: { essen, marke, schrift },
    clubs: { muster, sport, tracht },
    invoices: { r1, r2, r3, s4, r5, r6 }
  }
}
