/**
 * Entwurfslogik der Festbüro-Maske (reine Funktionen, plattformneutral).
 *
 * - Vorbelegung der Positionen: Verein → Modus `pro_person` = kommende Personen, `feste_anzahl` =
 *   Standardanzahl; Einzelrechnung (und noch kein Kunde) → alle Mengen 0.
 * - Personenänderung: Zeilen ohne Handänderung werden neu vorbelegt, von Hand geänderte bleiben.
 * - Schnellwahl 0 / 1× / 2× (= 0, Personen, 2 × Personen).
 * - Freie Zusatzpositionen (`productId: null`).
 * - Aufbau von `InvoiceDraft` (Abschluss) und `InvoiceRenderData` (Live-Vorschau).
 *
 * Regel „von Hand geändert“ (Markierung `manual`):
 *   Jede Mengeneingabe – getippt, per Pfeiltaste oder per Schnellwahl – setzt die Markierung, sobald
 *   die neue Menge von der aktuellen Vorbelegung abweicht. Entspricht sie der Vorbelegung (z. B. „1×“
 *   bei einem Pro-Person-Produkt), bleibt bzw. wird die Zeile automatisch und folgt weiter der
 *   Personenzahl. Eine gesetzte Markierung bleibt bei späteren Personenänderungen bestehen, bis die
 *   Zeile erneut bearbeitet oder zurückgesetzt wird. Aus einer alten Rechnung übernommene Zeilen
 *   (`?from=`) sind immer markiert.
 */
import { addDays, isValidIsoDate } from './dates'
import { calculateLineTotal, calculateTotals } from './tax'
import type {
  Cents,
  Club,
  CustomerKind,
  CustomerSnapshot,
  Festival,
  Invoice,
  InvoiceDraft,
  InvoiceDraftLine,
  InvoiceRenderData,
  InvoiceTotals,
  IsoDate,
  PaymentKind,
  PaymentMethod,
  Product,
  ProductMode,
  VatRate
} from './types'

/** Höchste zulässige Menge bzw. Personenzahl pro Eingabe. */
export const MAX_QUANTITY = 99_999
/** Steuersatz einer neuen Zusatzposition. */
export const DEFAULT_EXTRA_VAT_RATE: VatRate = 19
/** Standard-Zahlungsfrist, wenn die Zahlungsart (noch) unbekannt ist. */
export const FALLBACK_DUE_DAYS = 7

/* ------------------------------------------------------------------ */
/* Typen                                                               */
/* ------------------------------------------------------------------ */

/** Eine Zeile der Maske (Produkt oder freie Zusatzposition). */
export interface DraftLine {
  /** stabiler Schlüssel: `p<productId>` für Produkte, `x<n>` für Zusatzpositionen */
  key: string
  /** null = freie Zusatzposition */
  productId: number | null
  name: string
  priceCents: Cents
  vatRate: VatRate
  /** Produktmodus; null bei Zusatzpositionen (keine Vorbelegung) */
  mode: ProductMode | null
  /** Standardanzahl bei Modus `feste_anzahl` */
  defaultQuantity: number
  quantity: number
  /** von Hand geändert → bleibt bei Personenänderung stehen */
  manual: boolean
}

/** Kontext für die Vorbelegung. */
export interface PrefillContext {
  /** null = noch kein Kunde gewählt */
  customerKind: CustomerKind | null
  /** kommende Personen (nur Vereine) */
  persons: number | null
}

export type QuickPick = 0 | 1 | 2
export const QUICK_PICKS: readonly QuickPick[] = [0, 1, 2] as const

/** Optionale Anschrift einer Einzelrechnung. */
export interface EinzelAddress {
  contactName?: string
  street?: string
  zip?: string
  city?: string
}

/* ------------------------------------------------------------------ */
/* Eingaben normalisieren                                              */
/* ------------------------------------------------------------------ */

/**
 * Wandelt eine Mengeneingabe in eine ganze Zahl 0…MAX_QUANTITY um. Leere oder ungültige Eingaben → 0,
 * Nachkommastellen werden abgeschnitten, negative Werte → 0.
 */
export function normalizeQuantity(input: string | number | null | undefined): number {
  if (input === null || input === undefined) return 0
  let value: number
  if (typeof input === 'number') {
    value = input
  } else {
    const digits = input.replace(/[\s.]/g, '').replace(',', '.')
    if (digits === '' || !/^-?\d+(\.\d*)?$/.test(digits)) return 0
    value = Number(digits)
  }
  if (!Number.isFinite(value)) return 0
  const int = Math.trunc(value)
  if (int <= 0) return 0
  return Math.min(int, MAX_QUANTITY)
}

/** Nur Ziffern einer Mengen-/Personeneingabe behalten (für kontrollierte Eingabefelder). */
export function sanitizeQuantityInput(input: string): string {
  const digits = input.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
  return digits.length > String(MAX_QUANTITY).length ? digits.slice(0, String(MAX_QUANTITY).length) : digits
}

/** Menge um `delta` ändern (Pfeiltasten), begrenzt auf 0…MAX_QUANTITY. */
export function stepQuantity(quantity: number, delta: number): number {
  return normalizeQuantity(Math.max(0, quantity + delta))
}

/* ------------------------------------------------------------------ */
/* Vorbelegung                                                         */
/* ------------------------------------------------------------------ */

/** Vorbelegte Menge einer Zeile im gegebenen Kontext. */
export function prefillQuantity(line: Pick<DraftLine, 'mode' | 'defaultQuantity'>, ctx: PrefillContext): number {
  if (ctx.customerKind !== 'verein' || line.mode === null) return 0
  if (line.mode === 'pro_person') return normalizeQuantity(ctx.persons ?? 0)
  return normalizeQuantity(line.defaultQuantity)
}

export function productLineKey(productId: number): string {
  return `p${productId}`
}

/** Zeile zu einem Produkt, vorbelegt. */
export function createProductLine(product: Product, ctx: PrefillContext): DraftLine {
  const line: DraftLine = {
    key: productLineKey(product.id),
    productId: product.id,
    name: product.name,
    priceCents: product.priceCents,
    vatRate: product.vatRate,
    mode: product.mode,
    defaultQuantity: product.defaultQuantity,
    quantity: 0,
    manual: false
  }
  line.quantity = prefillQuantity(line, ctx)
  return line
}

/** Aktive Produkte in der festgelegten Reihenfolge (sortOrder, dann id). */
export function sortActiveProducts(products: ReadonlyArray<Product>): Product[] {
  return products.filter((p) => p.active).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
}

/** Alle Zeilen für die aktiven Produkte, vorbelegt im Kontext. */
export function createDraftLines(products: ReadonlyArray<Product>, ctx: PrefillContext): DraftLine[] {
  return sortActiveProducts(products).map((p) => createProductLine(p, ctx))
}

/**
 * Belegt alle Zeilen ohne Handänderung neu vor (Personen- oder Kundenwechsel).
 * Von Hand geänderte Zeilen und Zusatzpositionen bleiben unverändert.
 */
export function reprefillLines(lines: ReadonlyArray<DraftLine>, ctx: PrefillContext): DraftLine[] {
  return lines.map((line) => {
    if (line.manual || line.productId === null) return line
    const quantity = prefillQuantity(line, ctx)
    return quantity === line.quantity ? line : { ...line, quantity }
  })
}

/**
 * Gleicht die Zeilen mit den aktuellen Produkten ab (z. B. nach dem Laden oder einer Änderung der
 * Stammdaten): Bezeichnung/Preis/Satz/Modus werden übernommen, Mengen von Hand geänderter Zeilen
 * bleiben, neue Produkte werden vorbelegt, inaktive/gelöschte Produkte entfallen.
 * Zusatzpositionen bleiben am Ende erhalten.
 */
export function syncDraftLines(
  lines: ReadonlyArray<DraftLine>,
  products: ReadonlyArray<Product>,
  ctx: PrefillContext
): DraftLine[] {
  const byProduct = new Map<number, DraftLine>()
  for (const line of lines) if (line.productId !== null) byProduct.set(line.productId, line)
  const productLines = sortActiveProducts(products).map((product) => {
    const existing = byProduct.get(product.id)
    const fresh = createProductLine(product, ctx)
    if (!existing) return fresh
    if (existing.manual) return { ...fresh, quantity: existing.quantity, manual: true }
    return fresh
  })
  return [...productLines, ...lines.filter((l) => l.productId === null)]
}

/** Setzt die Menge einer Zeile (Eingabe/Pfeiltasten) und aktualisiert die Markierung. */
export function setLineQuantity(
  lines: ReadonlyArray<DraftLine>,
  key: string,
  quantity: number,
  ctx: PrefillContext
): DraftLine[] {
  const q = normalizeQuantity(quantity)
  return lines.map((line) => {
    if (line.key !== key) return line
    // Zusatzpositionen haben keine Vorbelegung und gelten immer als von Hand erfasst.
    const manual = line.productId === null ? true : q !== prefillQuantity(line, ctx)
    return line.quantity === q && line.manual === manual ? line : { ...line, quantity: q, manual }
  })
}

/** Menge zur Schnellwahl: 0, 1× Personen, 2× Personen. */
export function quickPickQuantity(pick: QuickPick, persons: number | null): number {
  return normalizeQuantity(pick * normalizeQuantity(persons ?? 0))
}

/** Schnellwahl auf eine Zeile anwenden (zählt als Handänderung, wenn sie von der Vorbelegung abweicht). */
export function applyQuickPick(
  lines: ReadonlyArray<DraftLine>,
  key: string,
  pick: QuickPick,
  ctx: PrefillContext
): DraftLine[] {
  return setLineQuantity(lines, key, quickPickQuantity(pick, ctx.persons), ctx)
}

/** Welche Schnellwahl der aktuellen Menge entspricht (für die Hervorhebung), sonst null. */
export function activeQuickPick(quantity: number, persons: number | null): QuickPick | null {
  const p = normalizeQuantity(persons ?? 0)
  if (quantity === 0) return 0
  if (p > 0 && quantity === p) return 1
  if (p > 0 && quantity === 2 * p) return 2
  return null
}

/** Setzt eine von Hand geänderte Zeile auf die Vorbelegung zurück. */
export function resetLine(lines: ReadonlyArray<DraftLine>, key: string, ctx: PrefillContext): DraftLine[] {
  return lines.map((line) =>
    line.key === key && line.productId !== null
      ? { ...line, quantity: prefillQuantity(line, ctx), manual: false }
      : line
  )
}

/* ------------------------------------------------------------------ */
/* Zusatzpositionen                                                    */
/* ------------------------------------------------------------------ */

/** Nächster freier Schlüssel für eine Zusatzposition. */
export function nextExtraKey(lines: ReadonlyArray<DraftLine>): string {
  let max = 0
  for (const line of lines) {
    const m = /^x(\d+)$/.exec(line.key)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `x${max + 1}`
}

/** Neue, leere Zusatzposition (Menge 1). */
export function createExtraLine(
  key: string,
  init: Partial<Pick<DraftLine, 'name' | 'priceCents' | 'vatRate' | 'quantity'>> = {}
): DraftLine {
  return {
    key,
    productId: null,
    name: init.name ?? '',
    priceCents: init.priceCents ?? 0,
    vatRate: init.vatRate ?? DEFAULT_EXTRA_VAT_RATE,
    mode: null,
    defaultQuantity: 0,
    quantity: normalizeQuantity(init.quantity ?? 1),
    manual: true
  }
}

export function addExtraLine(
  lines: ReadonlyArray<DraftLine>,
  init?: Partial<Pick<DraftLine, 'name' | 'priceCents' | 'vatRate' | 'quantity'>>
): DraftLine[] {
  return [...lines, createExtraLine(nextExtraKey(lines), init)]
}

/** Ändert Felder einer Zusatzposition (Produktzeilen bleiben unberührt). */
export function updateExtraLine(
  lines: ReadonlyArray<DraftLine>,
  key: string,
  patch: Partial<Pick<DraftLine, 'name' | 'priceCents' | 'vatRate' | 'quantity'>>
): DraftLine[] {
  return lines.map((line) => {
    if (line.key !== key || line.productId !== null) return line
    const next = { ...line, ...patch, manual: true }
    if (patch.quantity !== undefined) next.quantity = normalizeQuantity(patch.quantity)
    if (patch.priceCents !== undefined && (!Number.isSafeInteger(patch.priceCents) || patch.priceCents < 0)) {
      next.priceCents = line.priceCents
    }
    return next
  })
}

export function removeLine(lines: ReadonlyArray<DraftLine>, key: string): DraftLine[] {
  return lines.filter((l) => l.key !== key || l.productId !== null)
}

/** Zusatzposition ohne Inhalt (wird beim Abschluss ignoriert). */
export function isEmptyExtraLine(line: DraftLine): boolean {
  return line.productId === null && line.name.trim() === '' && line.quantity === 0 && line.priceCents === 0
}

/* ------------------------------------------------------------------ */
/* Kunde                                                               */
/* ------------------------------------------------------------------ */

/** Kundendaten-Kopie aus dem Vereinsstamm. */
export function customerFromClub(club: Club): CustomerSnapshot {
  return {
    kind: 'verein',
    clubId: club.id,
    contactName: club.contactName ?? '',
    clubName: club.clubName ?? '',
    street: club.street ?? '',
    zip: club.zip ?? '',
    city: club.city ?? '',
    registeredPersons: club.registeredPersons ?? null
  }
}

/** Kunde einer Einzelrechnung; ohne Angaben steht im Anschriftfeld nur „Einzelrechnung“. */
export function customerEinzel(address: EinzelAddress = {}): CustomerSnapshot {
  return {
    kind: 'einzel',
    clubId: null,
    contactName: (address.contactName ?? '').trim(),
    clubName: '',
    street: (address.street ?? '').trim(),
    zip: (address.zip ?? '').trim(),
    city: (address.city ?? '').trim(),
    registeredPersons: null
  }
}

/** Kurzbezeichnung des Kunden für Anzeigen (Verein bzw. Name bzw. „Einzelrechnung“). */
export function customerLabel(customer: CustomerSnapshot | null): string {
  if (!customer) return ''
  if (customer.kind === 'verein') return customer.clubName || customer.contactName || 'Verein'
  return customer.contactName || 'Einzelrechnung'
}

/* ------------------------------------------------------------------ */
/* Abschlussdaten                                                      */
/* ------------------------------------------------------------------ */

/** Positionen für den Abschluss: alle Produktzeilen (inkl. Menge 0) und nicht leere Zusatzpositionen. */
export function draftLinesToInvoiceLines(lines: ReadonlyArray<DraftLine>): InvoiceDraftLine[] {
  return lines
    .filter((l) => !isEmptyExtraLine(l))
    .map((l) => ({
      productId: l.productId,
      name: l.productId === null ? l.name.trim() : l.name,
      priceCents: l.priceCents,
      vatRate: l.vatRate,
      quantity: l.quantity
    }))
}

/** Summen der Maske (über `calculateTotals`). */
export function calculateDraftTotals(
  lines: ReadonlyArray<Pick<DraftLine, 'priceCents' | 'vatRate' | 'quantity'>>
): InvoiceTotals {
  return calculateTotals(lines)
}

/** Standard-Zahlungsart: als Standard markierte, sonst Bar, sonst die erste. */
export function defaultPaymentKind(methods: ReadonlyArray<PaymentMethod>): PaymentKind {
  return (
    methods.find((m) => m.isDefault)?.kind ?? methods.find((m) => m.kind === 'bar')?.kind ?? methods[0]?.kind ?? 'bar'
  )
}

/** Fälligkeitsdatum = Rechnungsdatum + Frist der Zahlungsart. Ungültiges Datum → unverändert. */
export function computeDueDate(
  invoiceDate: IsoDate,
  method: Pick<PaymentMethod, 'dueDays'> | null | undefined
): IsoDate {
  if (!isValidIsoDate(invoiceDate)) return invoiceDate
  const days = method && Number.isInteger(method.dueDays) && method.dueDays >= 0 ? method.dueDays : FALLBACK_DUE_DAYS
  return addDays(invoiceDate, days)
}

export interface BuildDraftInput {
  festivalId: number
  customer: CustomerSnapshot
  /** kommende Personen; wird bei Einzelrechnung ignoriert (null) */
  persons: number | null
  paymentKind: PaymentKind
  invoiceDate: IsoDate
  serviceDate: IsoDate
  lines: ReadonlyArray<DraftLine>
}

/** Kundendaten ohne führende/abschließende Leerzeichen. */
export function trimCustomer(customer: CustomerSnapshot): CustomerSnapshot {
  return {
    ...customer,
    contactName: (customer.contactName ?? '').trim(),
    clubName: (customer.clubName ?? '').trim(),
    street: (customer.street ?? '').trim(),
    zip: (customer.zip ?? '').trim(),
    city: (customer.city ?? '').trim()
  }
}

/** Baut den Entwurf für `invoices.finalize`. */
export function buildInvoiceDraft(input: BuildDraftInput): InvoiceDraft {
  return {
    festivalId: input.festivalId,
    customer: trimCustomer(input.customer),
    persons: input.customer.kind === 'verein' ? normalizeQuantity(input.persons ?? 0) : null,
    paymentKind: input.paymentKind,
    invoiceDate: input.invoiceDate,
    serviceDate: input.serviceDate,
    lines: draftLinesToInvoiceLines(input.lines)
  }
}

/** Kunde für die Vorschau, solange noch keiner gewählt ist (leeres Anschriftfeld). */
export const EMPTY_PREVIEW_CUSTOMER: CustomerSnapshot = {
  kind: 'verein',
  clubId: null,
  contactName: '',
  clubName: '',
  street: '',
  zip: '',
  city: '',
  registeredPersons: null
}

const PAYMENT_LABEL_FALLBACK: Record<PaymentKind, string> = { bar: 'Bar', ueberweisung: 'Überweisung' }

export interface BuildRenderDataInput {
  draft: InvoiceDraft
  festival: Pick<Festival, 'name' | 'taxExempt' | 'taxExemptText'>
  paymentMethods: ReadonlyArray<PaymentMethod>
  /** Vorschau-Nummer (`invoices.nextNumberPreview`), null = „(wird vergeben)“ */
  number: string | null
  /** heutiges Datum für {Heute…} */
  today: IsoDate
}

/** Render-Daten für die Live-Vorschau eines Entwurfs. */
export function buildDraftRenderData(input: BuildRenderDataInput): InvoiceRenderData {
  const { draft, festival } = input
  const method = input.paymentMethods.find((m) => m.kind === draft.paymentKind) ?? null
  const lines = draft.lines.map((l) => ({
    name: l.name,
    priceCents: l.priceCents,
    vatRate: l.vatRate,
    quantity: l.quantity,
    lineTotalCents: calculateLineTotal(l.priceCents, l.quantity)
  }))
  return {
    type: 'rechnung',
    number: input.number,
    originalNumber: null,
    festivalName: festival.name,
    invoiceDate: draft.invoiceDate,
    serviceDate: draft.serviceDate,
    dueDate: computeDueDate(draft.invoiceDate, method),
    today: input.today,
    customer: draft.customer,
    persons: draft.persons,
    paymentKind: draft.paymentKind,
    paymentLabel: method?.label ?? PAYMENT_LABEL_FALLBACK[draft.paymentKind],
    paymentText: method?.text ?? '',
    lines,
    totals: calculateTotals(lines),
    taxExempt: festival.taxExempt,
    taxExemptText: festival.taxExemptText
  }
}

/* ------------------------------------------------------------------ */
/* Abschluss möglich?                                                  */
/* ------------------------------------------------------------------ */

export interface FinalizeCheckInput {
  customer: CustomerSnapshot | null
  lines: ReadonlyArray<DraftLine>
  invoiceDate?: IsoDate
  serviceDate?: IsoDate
}

/** Grund, warum (noch) nicht abgeschlossen werden kann – oder null. */
export function getFinalizeBlocker(input: FinalizeCheckInput): string | null {
  if (!input.customer) return 'Bitte zuerst einen Verein wählen oder eine Einzelrechnung beginnen.'
  const unnamed = input.lines.some((l) => l.productId === null && !isEmptyExtraLine(l) && l.name.trim() === '')
  if (unnamed) return 'Bitte eine Bezeichnung für die Zusatzposition eingeben.'
  if (input.invoiceDate !== undefined && !isValidIsoDate(input.invoiceDate)) {
    return 'Bitte ein gültiges Rechnungsdatum eingeben.'
  }
  if (input.serviceDate !== undefined && !isValidIsoDate(input.serviceDate)) {
    return 'Bitte ein gültiges Leistungsdatum eingeben.'
  }
  if (calculateDraftTotals(input.lines).grossCents === 0) return 'Der Endbetrag ist 0 €. Bitte Mengen eingeben.'
  return null
}

/** Kunde gewählt (Verein oder Einzelrechnung), Endbetrag ≠ 0 und alle Angaben gültig. */
export function canFinalize(input: FinalizeCheckInput): boolean {
  return getFinalizeBlocker(input) === null
}

/* ------------------------------------------------------------------ */
/* Vorbelegung aus einer alten Rechnung (?from=)                       */
/* ------------------------------------------------------------------ */

export interface DraftFromInvoice {
  customer: CustomerSnapshot
  persons: number | null
  paymentKind: PaymentKind
  serviceDate: IsoDate
  lines: DraftLine[]
}

/**
 * Übernimmt Kunde, Personen, Zahlart, Leistungsdatum und Mengen einer Rechnung („Stornieren und neu
 * erstellen“). Zuordnung über `productId` zu den aktuellen aktiven Produkten (aktuelle Bezeichnung und
 * aktueller Preis); Positionen ohne passendes aktives Produkt werden Zusatzpositionen mit den Daten der
 * alten Rechnung. Alle übernommenen Zeilen gelten als von Hand geändert; Produkte, die in der alten
 * Rechnung fehlen, werden normal vorbelegt. Stornobelege werden mit positiven Mengen übernommen.
 */
export function draftFromInvoice(invoice: Invoice, products: ReadonlyArray<Product>): DraftFromInvoice {
  const customer: CustomerSnapshot = { ...invoice.customer }
  const persons = customer.kind === 'verein' ? normalizeQuantity(Math.abs(invoice.persons ?? 0)) : null
  const ctx: PrefillContext = { customerKind: customer.kind, persons }
  const sign = invoice.type === 'storno' ? -1 : 1

  let lines = createDraftLines(products, ctx)
  const used = new Set<string>()
  const sortedOld = [...invoice.lines].sort((a, b) => a.position - b.position)
  for (const old of sortedOld) {
    const quantity = normalizeQuantity(old.quantity * sign)
    const key = old.productId !== null ? productLineKey(old.productId) : null
    const target = key !== null && !used.has(key) ? lines.find((l) => l.key === key) : undefined
    if (target) {
      used.add(target.key)
      lines = lines.map((l) => (l.key === target.key ? { ...l, quantity, manual: true } : l))
    } else {
      lines = addExtraLine(lines, {
        name: old.name,
        priceCents: Math.abs(old.priceCents),
        vatRate: old.vatRate,
        quantity
      })
    }
  }
  return { customer, persons, paymentKind: invoice.paymentKind, serviceDate: invoice.serviceDate, lines }
}
