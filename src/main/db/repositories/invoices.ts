/**
 * SQL für Rechnungen und Stornobelege (Row ↔ Domänentyp).
 *
 * Zuständig: Bereich „Abschluss & Druck“.
 *
 * - Belege werden nur eingefügt, nie gelöscht. Erlaubte Updates (die DB-Trigger erzwingen den Rest):
 *   `status` (abgeschlossen → storniert), `pdf_path`/`pdf_created_at`, `printed`/`printed_at`/`print_error`.
 * - `originalNumber`, `stornoInvoiceId`, `stornoNumber` kommen per Join.
 * - Für den Abschluss liest dieses Modul Fest, Zahlungsart, Vorlage und Produkt-IDs mit eigenem SQL
 *   (keine Abhängigkeit von fremden Repositories).
 */
import type {
  CustomerKind,
  CustomerSnapshot,
  Invoice,
  InvoiceLine,
  InvoiceListItem,
  InvoiceStatus,
  InvoiceTotals,
  InvoiceType,
  PaymentKind,
  TemplateConfig,
  VatRate
} from '@shared/types'
import type { Db } from '../connection'

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

interface InvoiceRow {
  id: number
  festival_id: number
  number: string
  seq: number
  type: InvoiceType
  status: InvoiceStatus
  original_invoice_id: number | null
  storno_reason: string | null
  customer_kind: CustomerKind
  club_id: number | null
  customer_json: string
  persons: number | null
  payment_kind: PaymentKind
  payment_label: string
  payment_text: string
  due_days: number
  invoice_date: string
  service_date: string
  due_date: string
  total_gross_cents: number
  total_net_cents: number
  total_vat_cents: number
  totals_json: string
  tax_exempt: number
  tax_exempt_text: string
  festival_name: string
  template_json: string
  logo_file: string | null
  pdf_path: string | null
  pdf_created_at: string | null
  printed: number
  printed_at: string | null
  print_error: string | null
  created_at: string
  original_number: string | null
  storno_invoice_id: number | null
  storno_number: string | null
}

interface InvoiceLineRow {
  id: number
  invoice_id: number
  position: number
  product_id: number | null
  name: string
  price_cents: number
  vat_rate: number
  quantity: number
  line_total_cents: number
}

const SELECT_INVOICE = /* sql */ `
  SELECT i.*,
         o.number AS original_number,
         s.id     AS storno_invoice_id,
         s.number AS storno_number
  FROM invoice i
  LEFT JOIN invoice o ON o.id = i.original_invoice_id
  LEFT JOIN invoice s ON s.original_invoice_id = i.id
`

/* ------------------------------------------------------------------ */
/* Mapping                                                             */
/* ------------------------------------------------------------------ */

function parseJson<T>(text: string, what: string): T {
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`Die gespeicherten Daten der Rechnung sind beschädigt (${what}).`)
  }
}

function toCustomer(row: InvoiceRow): CustomerSnapshot {
  const raw = parseJson<Partial<CustomerSnapshot>>(row.customer_json, 'Kunde')
  return {
    kind: row.customer_kind,
    clubId: row.club_id,
    contactName: raw.contactName ?? '',
    clubName: raw.clubName ?? '',
    street: raw.street ?? '',
    zip: raw.zip ?? '',
    city: raw.city ?? '',
    registeredPersons: raw.registeredPersons ?? null
  }
}

/** Anzeigename des Kunden: Verein, sonst Name, sonst „Einzelrechnung“. */
export function customerLabel(customer: Pick<CustomerSnapshot, 'clubName' | 'contactName'>): string {
  const club = (customer.clubName ?? '').trim()
  if (club) return club
  const name = (customer.contactName ?? '').trim()
  if (name) return name
  return 'Einzelrechnung'
}

export function mapLine(row: InvoiceLineRow): InvoiceLine {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    position: row.position,
    productId: row.product_id,
    name: row.name,
    priceCents: row.price_cents,
    vatRate: row.vat_rate as VatRate,
    quantity: row.quantity,
    lineTotalCents: row.line_total_cents
  }
}

export function mapInvoice(row: InvoiceRow, lines: InvoiceLine[]): Invoice {
  return {
    id: row.id,
    festivalId: row.festival_id,
    number: row.number,
    seq: row.seq,
    type: row.type,
    status: row.status,
    originalInvoiceId: row.original_invoice_id,
    originalNumber: row.original_number,
    stornoReason: row.storno_reason,
    stornoInvoiceId: row.storno_invoice_id,
    stornoNumber: row.storno_number,
    customer: toCustomer(row),
    persons: row.persons,
    paymentKind: row.payment_kind,
    paymentLabel: row.payment_label,
    paymentText: row.payment_text,
    dueDays: row.due_days,
    invoiceDate: row.invoice_date,
    serviceDate: row.service_date,
    dueDate: row.due_date,
    totals: parseJson<InvoiceTotals>(row.totals_json, 'Summen'),
    taxExempt: row.tax_exempt === 1,
    taxExemptText: row.tax_exempt_text,
    festivalName: row.festival_name,
    template: parseJson<TemplateConfig>(row.template_json, 'Vorlage'),
    logoFile: row.logo_file,
    pdfPath: row.pdf_path,
    pdfCreatedAt: row.pdf_created_at,
    printed: row.printed === 1,
    printedAt: row.printed_at,
    printError: row.print_error,
    createdAt: row.created_at,
    lines
  }
}

export function mapListItem(row: InvoiceRow): InvoiceListItem {
  const customer = toCustomer(row)
  return {
    id: row.id,
    number: row.number,
    type: row.type,
    status: row.status,
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    customerLabel: customerLabel(customer),
    customerKind: row.customer_kind,
    clubId: row.club_id,
    persons: row.persons,
    paymentKind: row.payment_kind,
    paymentLabel: row.payment_label,
    totalGrossCents: row.total_gross_cents,
    printed: row.printed === 1,
    printedAt: row.printed_at,
    pdfPath: row.pdf_path,
    originalNumber: row.original_number,
    stornoNumber: row.storno_number,
    createdAt: row.created_at
  }
}

/* ------------------------------------------------------------------ */
/* Lesen                                                               */
/* ------------------------------------------------------------------ */

export function findLines(db: Db, invoiceId: number): InvoiceLine[] {
  const rows = db
    .prepare('SELECT * FROM invoice_line WHERE invoice_id = ? ORDER BY position ASC')
    .all(invoiceId) as InvoiceLineRow[]
  return rows.map(mapLine)
}

export function findInvoice(db: Db, id: number): Invoice | null {
  if (!Number.isSafeInteger(id)) return null
  const row = db.prepare(`${SELECT_INVOICE} WHERE i.id = ?`).get(id) as InvoiceRow | undefined
  return row ? mapInvoice(row, findLines(db, row.id)) : null
}

/** Alle Belege eines Fests, neueste zuerst (laufende Nummer absteigend). */
export function listInvoices(db: Db, festivalId: number): InvoiceListItem[] {
  const rows = db
    .prepare(`${SELECT_INVOICE} WHERE i.festival_id = ? ORDER BY i.seq DESC, i.id DESC`)
    .all(festivalId) as InvoiceRow[]
  return rows.map(mapListItem)
}

export function numberExists(db: Db, number: string): boolean {
  return db.prepare('SELECT 1 FROM invoice WHERE number = ?').get(number) !== undefined
}

/** ID des Stornobelegs zu einer Rechnung oder null. */
export function findStornoIdFor(db: Db, originalId: number): number | null {
  const row = db.prepare('SELECT id FROM invoice WHERE original_invoice_id = ?').get(originalId) as
    | { id: number }
    | undefined
  return row?.id ?? null
}

/* ------------------------------------------------------------------ */
/* Schreiben                                                           */
/* ------------------------------------------------------------------ */

export interface InvoiceInsertValues {
  festivalId: number
  number: string
  seq: number
  type: InvoiceType
  originalInvoiceId: number | null
  stornoReason: string | null
  customer: CustomerSnapshot
  persons: number | null
  paymentKind: PaymentKind
  paymentLabel: string
  paymentText: string
  dueDays: number
  invoiceDate: string
  serviceDate: string
  dueDate: string
  totals: InvoiceTotals
  taxExempt: boolean
  taxExemptText: string
  festivalName: string
  /** Vorlage als JSON-Text (unverändert gespeicherte Kopie) */
  templateJson: string
  logoFile: string | null
  createdAt: string
}

export interface InvoiceLineInsertValues {
  productId: number | null
  name: string
  priceCents: number
  vatRate: VatRate
  quantity: number
  lineTotalCents: number
}

export function insertInvoice(db: Db, v: InvoiceInsertValues): number {
  const customerJson = JSON.stringify({
    kind: v.customer.kind,
    clubId: v.customer.clubId,
    contactName: v.customer.contactName,
    clubName: v.customer.clubName,
    street: v.customer.street,
    zip: v.customer.zip,
    city: v.customer.city,
    registeredPersons: v.customer.registeredPersons
  } satisfies CustomerSnapshot)
  const result = db
    .prepare(
      /* sql */ `INSERT INTO invoice
        (festival_id, number, seq, type, status, original_invoice_id, storno_reason,
         customer_kind, club_id, customer_json, persons,
         payment_kind, payment_label, payment_text, due_days,
         invoice_date, service_date, due_date,
         total_gross_cents, total_net_cents, total_vat_cents, totals_json,
         tax_exempt, tax_exempt_text, festival_name, template_json, logo_file,
         pdf_path, pdf_created_at, printed, printed_at, print_error, created_at)
       VALUES (?, ?, ?, ?, 'abgeschlossen', ?, ?,
               ?, ?, ?, ?,
               ?, ?, ?, ?,
               ?, ?, ?,
               ?, ?, ?, ?,
               ?, ?, ?, ?, ?,
               NULL, NULL, 0, NULL, NULL, ?)`
    )
    .run(
      v.festivalId,
      v.number,
      v.seq,
      v.type,
      v.originalInvoiceId,
      v.stornoReason,
      v.customer.kind,
      v.customer.clubId,
      customerJson,
      v.persons,
      v.paymentKind,
      v.paymentLabel,
      v.paymentText,
      v.dueDays,
      v.invoiceDate,
      v.serviceDate,
      v.dueDate,
      v.totals.grossCents,
      v.totals.netCents,
      v.totals.vatCents,
      JSON.stringify(v.totals),
      v.taxExempt ? 1 : 0,
      v.taxExemptText,
      v.festivalName,
      v.templateJson,
      v.logoFile,
      v.createdAt
    )
  return Number(result.lastInsertRowid)
}

export function insertLines(db: Db, invoiceId: number, lines: ReadonlyArray<InvoiceLineInsertValues>): void {
  const stmt = db.prepare(
    /* sql */ `INSERT INTO invoice_line
      (invoice_id, position, product_id, name, price_cents, vat_rate, quantity, line_total_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  lines.forEach((l, index) => {
    stmt.run(invoiceId, index + 1, l.productId, l.name, l.priceCents, l.vatRate, l.quantity, l.lineTotalCents)
  })
}

/** PDF-Ablage festhalten (erlaubtes Update). */
export function setPdf(db: Db, id: number, pdfPath: string | null, createdAt: string | null): void {
  db.prepare('UPDATE invoice SET pdf_path = ?, pdf_created_at = ? WHERE id = ?').run(pdfPath, createdAt, id)
}

/** Erfolgreicher Druck (erlaubtes Update). */
export function setPrinted(db: Db, id: number, printedAt: string): void {
  db.prepare('UPDATE invoice SET printed = 1, printed_at = ?, print_error = NULL WHERE id = ?').run(printedAt, id)
}

/** Druckfehler festhalten; ein früherer erfolgreicher Druck bleibt vermerkt (erlaubtes Update). */
export function setPrintError(db: Db, id: number, error: string): void {
  db.prepare('UPDATE invoice SET print_error = ? WHERE id = ?').run(error, id)
}

/** Original nach Storno (erlaubter Statusübergang abgeschlossen → storniert). */
export function markStorniert(db: Db, id: number): void {
  db.prepare("UPDATE invoice SET status = 'storniert' WHERE id = ? AND status = 'abgeschlossen'").run(id)
}

/* ------------------------------------------------------------------ */
/* Lookups für den Abschluss (eigenes SQL)                             */
/* ------------------------------------------------------------------ */

export interface FestivalForInvoice {
  id: number
  name: string
  festivalDate: string
  numberPrefix: string
  numberNext: number
  numberDigits: number
  copies: number
  taxExempt: boolean
  taxExemptText: string
  filenamePattern: string
  archived: boolean
}

export function readFestival(db: Db, festivalId: number): FestivalForInvoice | null {
  if (!Number.isSafeInteger(festivalId)) return null
  const row = db
    .prepare(
      /* sql */ `SELECT id, name, festival_date, number_prefix, number_next, number_digits, copies,
                        tax_exempt, tax_exempt_text, filename_pattern, archived
                 FROM festival WHERE id = ?`
    )
    .get(festivalId) as
    | {
        id: number
        name: string
        festival_date: string
        number_prefix: string
        number_next: number
        number_digits: number
        copies: number
        tax_exempt: number
        tax_exempt_text: string
        filename_pattern: string
        archived: number
      }
    | undefined
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    festivalDate: row.festival_date,
    numberPrefix: row.number_prefix,
    numberNext: row.number_next,
    numberDigits: row.number_digits,
    copies: row.copies,
    taxExempt: row.tax_exempt === 1,
    taxExemptText: row.tax_exempt_text,
    filenamePattern: row.filename_pattern,
    archived: row.archived === 1
  }
}

/** Zähler des Fests auf die nächste laufende Nummer setzen (nur innerhalb der Abschluss-Transaktion). */
export function setFestivalNumberNext(db: Db, festivalId: number, next: number): void {
  db.prepare('UPDATE festival SET number_next = ? WHERE id = ?').run(next, festivalId)
}

export interface PaymentMethodForInvoice {
  kind: PaymentKind
  label: string
  text: string
  dueDays: number
}

export function readPaymentMethod(db: Db, festivalId: number, kind: PaymentKind): PaymentMethodForInvoice | null {
  const row = db
    .prepare('SELECT kind, label, text, due_days FROM payment_method WHERE festival_id = ? AND kind = ?')
    .get(festivalId, kind) as { kind: PaymentKind; label: string; text: string; due_days: number } | undefined
  return row ? { kind: row.kind, label: row.label, text: row.text, dueDays: row.due_days } : null
}

/** Vorlage des Fests als Rohdaten (JSON-Text + Logo-Datei) oder null. */
export function readTemplate(db: Db, festivalId: number): { configJson: string; logoFile: string | null } | null {
  const row = db.prepare('SELECT config_json, logo_file FROM template WHERE festival_id = ?').get(festivalId) as
    | { config_json: string; logo_file: string | null }
    | undefined
  return row ? { configJson: row.config_json, logoFile: row.logo_file } : null
}

/** Welche der angegebenen Produkt-IDs gehören zum Fest? */
export function productIdsOfFestival(db: Db, festivalId: number): Set<number> {
  const rows = db.prepare('SELECT id FROM product WHERE festival_id = ?').all(festivalId) as Array<{ id: number }>
  return new Set(rows.map((r) => r.id))
}
