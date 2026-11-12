/**
 * Auswertung eines Gründungsfests (Bereich „Liste & Auswertung“).
 *
 * Alle Summen rechnen Stornos gegen: Stornobelege haben negative Summen und Positionen mit negativer
 * Menge, `persons` ist beim Storno aber positiv wie im Original und wird deshalb abgezogen.
 *
 * Steuer: Die Werte kommen aus den gespeicherten `totals_json`-byRate-Werten der Belege (pro Beleg
 * gerundet, also konsistent mit den Rechnungen). Bei steuerbefreiten Belegen wurde keine Umsatzsteuer
 * ausgewiesen – dort zählt der Bruttobetrag vollständig als Netto (MwSt 0).
 *
 * Die Funktionen lesen direkt per SQL (nicht über das Rechnungs-Repository), damit Auswertung und
 * Excel-Exporte unabhängig vom Bereich „Abschluss & Druck“ bleiben.
 */
import { calculateTotals } from '@shared/tax'
import type {
  Club,
  CustomerKind,
  CustomerSnapshot,
  EvaluationData,
  InvoiceStatus,
  InvoiceTotals,
  InvoiceType,
  IsoDate,
  IsoDateTime,
  PaymentKind,
  VatBreakdown,
  VatRate
} from '@shared/types'
import { getDb, type Db } from '../db/connection'
import { clubNameKey } from '../db/repositories/clubs'

/* ------------------------------------------------------------------ */
/* Quelldaten                                                          */
/* ------------------------------------------------------------------ */

export interface EvalFestival {
  id: number
  name: string
  festivalDate: IsoDate
  taxExempt: boolean
}

export interface EvalLine {
  position: number
  productId: number | null
  name: string
  priceCents: number
  vatRate: VatRate
  quantity: number
  lineTotalCents: number
}

/** Ein Beleg (Rechnung oder Storno) mit allen Feldern, die Auswertung und Exporte brauchen. */
export interface EvalInvoice {
  id: number
  number: string
  seq: number
  type: InvoiceType
  status: InvoiceStatus
  originalInvoiceId: number | null
  originalNumber: string | null
  stornoInvoiceId: number | null
  stornoNumber: string | null
  stornoReason: string | null
  customerKind: CustomerKind
  clubId: number | null
  customer: CustomerSnapshot
  /** Anzeige: Verein bzw. Name bzw. „Einzelrechnung“ */
  customerLabel: string
  persons: number | null
  paymentKind: PaymentKind
  paymentLabel: string
  dueDays: number
  invoiceDate: IsoDate
  serviceDate: IsoDate
  dueDate: IsoDate
  /** gespeicherte Summen des Belegs */
  totals: InvoiceTotals
  /** Summen mit Steuerausweis wie auf dem Beleg (steuerbefreit → MwSt 0, Netto = Brutto) */
  effectiveTotals: InvoiceTotals
  taxExempt: boolean
  pdfPath: string | null
  pdfCreatedAt: IsoDateTime | null
  printed: boolean
  printedAt: IsoDateTime | null
  printError: string | null
  createdAt: IsoDateTime
  lines: EvalLine[]
}

export interface EvalProduct {
  id: number
  name: string
  sortOrder: number
  active: boolean
}

export interface EvaluationSource {
  festival: EvalFestival
  invoices: EvalInvoice[]
  products: EvalProduct[]
  clubs: Club[]
}

interface InvoiceRow {
  id: number
  number: string
  seq: number
  type: InvoiceType
  status: InvoiceStatus
  original_invoice_id: number | null
  original_number: string | null
  storno_id: number | null
  storno_number: string | null
  storno_reason: string | null
  customer_kind: CustomerKind
  club_id: number | null
  customer_json: string
  persons: number | null
  payment_kind: PaymentKind
  payment_label: string
  due_days: number
  invoice_date: string
  service_date: string
  due_date: string
  total_gross_cents: number
  total_net_cents: number
  total_vat_cents: number
  totals_json: string
  tax_exempt: number
  pdf_path: string | null
  pdf_created_at: string | null
  printed: number
  printed_at: string | null
  print_error: string | null
  created_at: string
}

interface LineRow {
  invoice_id: number
  position: number
  product_id: number | null
  name: string
  price_cents: number
  vat_rate: number
  quantity: number
  line_total_cents: number
}

interface ClubRow {
  id: number
  festival_id: number
  contact_name: string
  club_name: string
  street: string
  zip: string
  city: string
  registered_persons: number
  source: 'import' | 'manual'
}

function parseJson<T>(text: string | null | undefined): T | null {
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

function toCustomer(row: InvoiceRow): CustomerSnapshot {
  const parsed = parseJson<Partial<CustomerSnapshot>>(row.customer_json) ?? {}
  return {
    kind: parsed.kind === 'einzel' || parsed.kind === 'verein' ? parsed.kind : row.customer_kind,
    clubId: typeof parsed.clubId === 'number' ? parsed.clubId : row.club_id,
    contactName: typeof parsed.contactName === 'string' ? parsed.contactName : '',
    clubName: typeof parsed.clubName === 'string' ? parsed.clubName : '',
    street: typeof parsed.street === 'string' ? parsed.street : '',
    zip: typeof parsed.zip === 'string' ? parsed.zip : parsed.zip != null ? String(parsed.zip) : '',
    city: typeof parsed.city === 'string' ? parsed.city : '',
    registeredPersons: typeof parsed.registeredPersons === 'number' ? parsed.registeredPersons : null
  }
}

/** Kundenbezeichnung wie in der Rechnungsliste: Verein, sonst Name, sonst „Einzelrechnung“. */
export function customerLabelOf(customer: CustomerSnapshot): string {
  return customer.clubName.trim() || customer.contactName.trim() || 'Einzelrechnung'
}

function isVatBreakdown(value: unknown): value is VatBreakdown {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    (v.rate === 7 || v.rate === 19) &&
    Number.isSafeInteger(v.grossCents) &&
    Number.isSafeInteger(v.netCents) &&
    Number.isSafeInteger(v.vatCents)
  )
}

function toTotals(row: InvoiceRow, lines: EvalLine[]): InvoiceTotals {
  const parsed = parseJson<Partial<InvoiceTotals>>(row.totals_json)
  if (parsed && Array.isArray(parsed.byRate) && parsed.byRate.every(isVatBreakdown)) {
    return {
      grossCents: row.total_gross_cents,
      netCents: row.total_net_cents,
      vatCents: row.total_vat_cents,
      byRate: [...parsed.byRate].sort((a, b) => a.rate - b.rate)
    }
  }
  // defektes JSON (sollte nie vorkommen): Aufschlüsselung aus den Positionen nachrechnen
  const computed = calculateTotals(lines)
  return {
    grossCents: row.total_gross_cents,
    netCents: row.total_net_cents,
    vatCents: row.total_vat_cents,
    byRate: computed.byRate
  }
}

/** Steuerausweis wie auf dem Beleg: steuerbefreit → keine MwSt, Netto = Brutto. */
export function effectiveTotalsOf(totals: InvoiceTotals, taxExempt: boolean): InvoiceTotals {
  if (!taxExempt) return totals
  return {
    grossCents: totals.grossCents,
    netCents: totals.grossCents,
    vatCents: 0,
    byRate: totals.byRate.map((b) => ({ rate: b.rate, grossCents: b.grossCents, netCents: b.grossCents, vatCents: 0 }))
  }
}

function loadFestival(festivalId: number, db: Db): EvalFestival {
  const row = db.prepare('SELECT id, name, festival_date, tax_exempt FROM festival WHERE id = ?').get(festivalId) as
    | { id: number; name: string; festival_date: string; tax_exempt: number }
    | undefined
  if (!row) throw new Error('Das Gründungsfest wurde nicht gefunden.')
  return { id: row.id, name: row.name, festivalDate: row.festival_date, taxExempt: row.tax_exempt === 1 }
}

/** Alle Belege des Fests (aufsteigend nach laufender Nummer) inklusive Positionen. */
export function loadInvoices(festivalId: number, db: Db = getDb()): EvalInvoice[] {
  const rows = db
    .prepare(
      `SELECT i.*, o.number AS original_number, s.id AS storno_id, s.number AS storno_number
       FROM invoice i
       LEFT JOIN invoice o ON o.id = i.original_invoice_id
       LEFT JOIN invoice s ON s.original_invoice_id = i.id
       WHERE i.festival_id = ?
       ORDER BY i.seq ASC, i.id ASC`
    )
    .all(festivalId) as InvoiceRow[]
  const lineRows = db
    .prepare(
      `SELECT l.invoice_id, l.position, l.product_id, l.name, l.price_cents, l.vat_rate, l.quantity, l.line_total_cents
       FROM invoice_line l
       JOIN invoice i ON i.id = l.invoice_id
       WHERE i.festival_id = ?
       ORDER BY l.invoice_id ASC, l.position ASC`
    )
    .all(festivalId) as LineRow[]

  const linesByInvoice = new Map<number, EvalLine[]>()
  for (const l of lineRows) {
    const list = linesByInvoice.get(l.invoice_id) ?? []
    list.push({
      position: l.position,
      productId: l.product_id,
      name: l.name,
      priceCents: l.price_cents,
      vatRate: (l.vat_rate === 7 ? 7 : 19) as VatRate,
      quantity: l.quantity,
      lineTotalCents: l.line_total_cents
    })
    linesByInvoice.set(l.invoice_id, list)
  }

  return rows.map((row) => {
    const lines = linesByInvoice.get(row.id) ?? []
    const customer = toCustomer(row)
    const totals = toTotals(row, lines)
    const taxExempt = row.tax_exempt === 1
    return {
      id: row.id,
      number: row.number,
      seq: row.seq,
      type: row.type,
      status: row.status,
      originalInvoiceId: row.original_invoice_id,
      originalNumber: row.original_number,
      stornoInvoiceId: row.storno_id,
      stornoNumber: row.storno_number,
      stornoReason: row.storno_reason,
      customerKind: row.customer_kind,
      clubId: row.club_id,
      customer,
      customerLabel: customerLabelOf(customer),
      persons: row.persons,
      paymentKind: row.payment_kind,
      paymentLabel: row.payment_label,
      dueDays: row.due_days,
      invoiceDate: row.invoice_date,
      serviceDate: row.service_date,
      dueDate: row.due_date,
      totals,
      effectiveTotals: effectiveTotalsOf(totals, taxExempt),
      taxExempt,
      pdfPath: row.pdf_path,
      pdfCreatedAt: row.pdf_created_at,
      printed: row.printed === 1,
      printedAt: row.printed_at,
      printError: row.print_error,
      createdAt: row.created_at,
      lines
    }
  })
}

function loadProducts(festivalId: number, db: Db): EvalProduct[] {
  const rows = db
    .prepare('SELECT id, name, sort_order, active FROM product WHERE festival_id = ? ORDER BY sort_order ASC, id ASC')
    .all(festivalId) as Array<{ id: number; name: string; sort_order: number; active: number }>
  return rows.map((r) => ({ id: r.id, name: r.name, sortOrder: r.sort_order, active: r.active === 1 }))
}

function loadClubs(festivalId: number, db: Db): Club[] {
  const rows = db
    .prepare(
      `SELECT id, festival_id, contact_name, club_name, street, zip, city, registered_persons, source
       FROM club WHERE festival_id = ?`
    )
    .all(festivalId) as ClubRow[]
  return rows
    .map((r) => ({
      id: r.id,
      festivalId: r.festival_id,
      contactName: r.contact_name,
      clubName: r.club_name,
      street: r.street,
      zip: r.zip,
      city: r.city,
      registeredPersons: r.registered_persons,
      source: r.source,
      hasInvoice: false
    }))
    .sort(compareClubs)
}

const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true })

function compareClubs(a: Club, b: Club): number {
  return collator.compare(a.clubName, b.clubName) || collator.compare(a.contactName, b.contactName) || a.id - b.id
}

/** Lädt alles, was Auswertung und Excel-Export eines Fests brauchen. */
export function loadEvaluationSource(festivalId: number, db: Db = getDb()): EvaluationSource {
  if (!Number.isInteger(festivalId) || festivalId <= 0) throw new Error('Ungültiges Gründungsfest.')
  const festival = loadFestival(festivalId, db)
  const clubs = loadClubs(festivalId, db)
  return { festival, invoices: loadInvoices(festivalId, db), products: loadProducts(festivalId, db), clubs }
}

/* ------------------------------------------------------------------ */
/* Vereine zuordnen                                                    */
/* ------------------------------------------------------------------ */

/** Vergleichsschlüssel für Bezeichnungen freier Positionen (Groß-/Kleinschreibung und Leerzeichen egal). */
export function normalizeName(value: string | null | undefined): string {
  return (value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de')
}

/**
 * Vergleichsschlüssel für Vereinsnamen – derselbe wie für `Club.hasInvoice` („bereits abgerechnet“ in der
 * Maske) und die Import-Dubletten (`clubNameKey`): Groß-/Kleinschreibung, Leer- und Satzzeichen sowie
 * Umlaut-Schreibweisen sind egal („FF Musterdorf e.V.“ = „FF Musterdorf e. V.“).
 */
function clubKey(value: string | null | undefined): string {
  return clubNameKey(value ?? '')
}

/**
 * Ordnet einen Beleg einem Verein des aktuellen Stamms zu (wie `invoicedClubIds` im Vereins-Repository).
 * Reihenfolge: gleiche ID und gleicher Vereinsname → gleicher Vereinsname → keine Zuordnung.
 * (Nach einem erneuten Import haben die Vereine neue IDs, und SQLite kann alte IDs neu vergeben –
 * deshalb zählt die ID nur zusammen mit dem Namen.)
 */
export function createClubResolver(clubs: Club[]): (invoice: Pick<EvalInvoice, 'customer' | 'clubId'>) => Club | null {
  const byId = new Map<number, Club>()
  const byName = new Map<string, Club>()
  for (const club of clubs) {
    byId.set(club.id, club)
    const key = clubKey(club.clubName)
    if (key && !byName.has(key)) byName.set(key, club)
  }
  return (invoice) => {
    if (invoice.customer.kind !== 'verein') return null
    const key = clubKey(invoice.customer.clubName)
    const id = invoice.clubId ?? invoice.customer.clubId
    if (id !== null && id !== undefined) {
      const club = byId.get(id)
      if (club && clubKey(club.clubName) === key) return club
    }
    return key ? (byName.get(key) ?? null) : null
  }
}

/* ------------------------------------------------------------------ */
/* Berechnung                                                          */
/* ------------------------------------------------------------------ */

/** Personen eines Belegs mit Vorzeichen: Storno zieht ab (persons ist dort positiv). */
export function signedPersons(invoice: Pick<EvalInvoice, 'type' | 'persons'>): number {
  const persons = invoice.persons ?? 0
  return invoice.type === 'storno' ? -persons : persons
}

function sumByRate(invoices: EvalInvoice[]): VatBreakdown[] {
  const map = new Map<VatRate, VatBreakdown>()
  for (const inv of invoices) {
    for (const b of inv.effectiveTotals.byRate) {
      const acc = map.get(b.rate) ?? { rate: b.rate, grossCents: 0, netCents: 0, vatCents: 0 }
      acc.grossCents += b.grossCents
      acc.netCents += b.netCents
      acc.vatCents += b.vatCents
      map.set(b.rate, acc)
    }
  }
  return [...map.values()]
    .filter((b) => b.grossCents !== 0 || b.netCents !== 0 || b.vatCents !== 0)
    .sort((a, b) => a.rate - b.rate)
}

export interface ProductSummary {
  name: string
  quantity: number
  grossCents: number
  productId: number | null
}

/**
 * Menge und Umsatz je Position, gruppiert über `product_id` (sonst Bezeichnung). Reihenfolge wie die
 * Produktreihenfolge des Fests, danach unbekannte Produkte und Zusatzpositionen (in Reihenfolge des
 * ersten Auftretens). Der Name eines Produkts ist der aktuelle Produktname, sonst der des letzten Belegs.
 */
export function summarizeProducts(source: Pick<EvaluationSource, 'invoices' | 'products'>): ProductSummary[] {
  const productById = new Map(source.products.map((p) => [p.id, p]))
  const groups = new Map<string, ProductSummary & { order: number; known: boolean; sortOrder: number }>()
  let order = 0
  for (const inv of source.invoices) {
    for (const line of inv.lines) {
      const key = line.productId !== null ? `p:${line.productId}` : `n:${normalizeName(line.name)}`
      let group = groups.get(key)
      if (!group) {
        const product = line.productId !== null ? productById.get(line.productId) : undefined
        group = {
          name: product?.name ?? line.name.trim(),
          quantity: 0,
          grossCents: 0,
          productId: line.productId,
          order: order++,
          known: product !== undefined,
          sortOrder: product?.sortOrder ?? 0
        }
        groups.set(key, group)
      } else if (!group.known && line.productId !== null) {
        group.name = line.name.trim()
      }
      group.quantity += line.quantity
      group.grossCents += line.lineTotalCents
    }
  }
  const productIndex = new Map(source.products.map((p, i) => [p.id, i]))
  const rank = (g: { known: boolean; productId: number | null }): number =>
    g.known ? 0 : g.productId !== null ? 1 : 2
  return [...groups.values()]
    .sort((a, b) => {
      const ra = rank(a)
      const rb = rank(b)
      if (ra !== rb) return ra - rb
      if (ra === 0) return (productIndex.get(a.productId!) ?? 0) - (productIndex.get(b.productId!) ?? 0)
      return a.order - b.order
    })
    .map(({ name, quantity, grossCents, productId }) => ({
      name,
      quantity: quantity === 0 ? 0 : quantity,
      grossCents: grossCents === 0 ? 0 : grossCents,
      productId
    }))
}

/** Vereine des Stamms ohne (nicht stornierte) Rechnung. */
export function clubsWithoutInvoice(source: Pick<EvaluationSource, 'invoices' | 'clubs'>): Club[] {
  const resolve = createClubResolver(source.clubs)
  const invoiced = new Set<number>()
  for (const inv of source.invoices) {
    if (inv.type !== 'rechnung' || inv.status === 'storniert') continue
    const club = resolve(inv)
    if (club) invoiced.add(club.id)
  }
  return source.clubs.filter((c) => !invoiced.has(c.id)).map((c) => ({ ...c, hasInvoice: false }))
}

/** Berechnet die Auswertung aus den Quelldaten. */
export function computeEvaluation(source: EvaluationSource): EvaluationData {
  const { invoices, festival } = source
  let invoiceCount = 0
  let stornoCount = 0
  let totalGrossCents = 0
  let cashCents = 0
  let transferCents = 0
  let persons = 0
  const perDay = new Map<IsoDate, { date: IsoDate; invoiceCount: number; grossCents: number }>()

  for (const inv of invoices) {
    if (inv.type === 'storno') stornoCount++
    else invoiceCount++
    const gross = inv.totals.grossCents
    totalGrossCents += gross
    if (inv.paymentKind === 'bar') cashCents += gross
    else transferCents += gross
    persons += signedPersons(inv)

    const day = perDay.get(inv.invoiceDate) ?? { date: inv.invoiceDate, invoiceCount: 0, grossCents: 0 }
    if (inv.type === 'rechnung') day.invoiceCount++
    day.grossCents += gross
    perDay.set(inv.invoiceDate, day)
  }

  const hasTaxedInvoices = invoices.some((inv) => !inv.taxExempt)

  return {
    festivalId: festival.id,
    invoiceCount,
    stornoCount,
    totalGrossCents,
    cashCents,
    transferCents,
    persons,
    products: summarizeProducts(source),
    taxRates: sumByRate(invoices),
    showTaxRates: !festival.taxExempt || hasTaxedInvoices,
    perDay: [...perDay.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    clubsWithoutInvoice: clubsWithoutInvoice(source)
  }
}

/** IPC `evaluation.get` */
export function getEvaluation(festivalId: number, db: Db = getDb()): EvaluationData {
  return computeEvaluation(loadEvaluationSource(festivalId, db))
}

/* ------------------------------------------------------------------ */
/* Berichte für den Excel-Export                                       */
/* ------------------------------------------------------------------ */

export interface ClubReportRow {
  clubName: string
  contactName: string
  city: string
  /** angemeldet laut Stamm bzw. (nicht mehr im Stamm) laut letztem Beleg */
  registeredPersons: number | null
  /** abgerechnet: Rechnungen minus Stornos */
  billedPersons: number
  /** nicht stornierte Rechnungen */
  invoiceCount: number
  grossCents: number
  inStamm: boolean
  clubId: number | null
}

/**
 * Angemeldete vs. abgerechnete Personen pro Verein: alle Vereine des Stamms (alphabetisch), danach
 * abgerechnete Vereine, die nicht mehr im Stamm sind (aus dem Kunden-Snapshot der Belege).
 */
export function buildClubReport(source: Pick<EvaluationSource, 'invoices' | 'clubs'>): ClubReportRow[] {
  const resolve = createClubResolver(source.clubs)
  const stamm = new Map<number, ClubReportRow>()
  for (const club of source.clubs) {
    stamm.set(club.id, {
      clubName: club.clubName,
      contactName: club.contactName,
      city: club.city,
      registeredPersons: club.registeredPersons,
      billedPersons: 0,
      invoiceCount: 0,
      grossCents: 0,
      inStamm: true,
      clubId: club.id
    })
  }
  const others = new Map<string, ClubReportRow & { lastSeq: number }>()
  for (const inv of source.invoices) {
    if (inv.customer.kind !== 'verein') continue
    const club = resolve(inv)
    let row: ClubReportRow
    if (club) {
      row = stamm.get(club.id)!
    } else {
      const key = clubKey(inv.customer.clubName) || `id:${inv.clubId ?? inv.id}`
      let other = others.get(key)
      if (!other) {
        other = {
          clubName: inv.customer.clubName || inv.customerLabel,
          contactName: inv.customer.contactName,
          city: inv.customer.city,
          registeredPersons: inv.customer.registeredPersons,
          billedPersons: 0,
          invoiceCount: 0,
          grossCents: 0,
          inStamm: false,
          clubId: inv.clubId,
          lastSeq: inv.seq
        }
        others.set(key, other)
      } else if (inv.seq >= other.lastSeq && inv.type === 'rechnung') {
        other.lastSeq = inv.seq
        other.contactName = inv.customer.contactName
        other.city = inv.customer.city
        other.registeredPersons = inv.customer.registeredPersons
      }
      row = other
    }
    row.billedPersons += signedPersons(inv)
    row.grossCents += inv.totals.grossCents
    if (inv.type === 'rechnung' && inv.status !== 'storniert') row.invoiceCount++
  }
  const otherRows = [...others.values()]
    .map(({ lastSeq: _lastSeq, ...row }) => row)
    .sort((a, b) => collator.compare(a.clubName, b.clubName))
  return [...stamm.values(), ...otherRows]
}

/** Alle nicht stornierten Überweisungsrechnungen, sortiert nach Fälligkeit (keine Zahlungsverfolgung). */
export function openTransfers(invoices: EvalInvoice[]): EvalInvoice[] {
  return invoices
    .filter((inv) => inv.type === 'rechnung' && inv.status !== 'storniert' && inv.paymentKind === 'ueberweisung')
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.seq - b.seq))
}

export interface PaymentSummaryRow {
  kind: PaymentKind
  label: string
  invoiceCount: number
  stornoCount: number
  grossCents: number
}

const DEFAULT_PAYMENT_LABELS: Record<PaymentKind, string> = { bar: 'Bar', ueberweisung: 'Überweisung' }

/** Summen pro Zahlart (Stornos gegengerechnet). */
export function summarizePayments(invoices: EvalInvoice[]): PaymentSummaryRow[] {
  return (['bar', 'ueberweisung'] as const).map((kind) => {
    const list = invoices.filter((inv) => inv.paymentKind === kind)
    const label = [...list].reverse().find((inv) => inv.paymentLabel.trim())?.paymentLabel ?? DEFAULT_PAYMENT_LABELS[kind]
    return {
      kind,
      label,
      invoiceCount: list.filter((inv) => inv.type === 'rechnung').length,
      stornoCount: list.filter((inv) => inv.type === 'storno').length,
      grossCents: list.reduce((sum, inv) => sum + inv.totals.grossCents, 0)
    }
  })
}
