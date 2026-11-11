/**
 * Erfundene Beispieldaten für Editor-Vorschau, Testseite und Screenshots.
 * Positionen, Preise und Mengen entsprechen der Beispielrechnung (Gesamt 670,20 €), Namen sind neutral.
 *
 * Zuständig: Bereich „Vorlage“ (bestehende Signaturen bleiben stabil).
 */
import { addDays } from '../dates'
import { calculateLineTotal, calculateTotals } from '../tax'
import type { Festival, InvoiceRenderData, PaymentKind, PaymentMethod, VatRate } from '../types'

export const SAMPLE_LINES: ReadonlyArray<{ name: string; priceCents: number; vatRate: VatRate; quantity: number }> = [
  { name: '1 Maß Bier (ohne Bedienung)', priceCents: 970, vatRate: 19, quantity: 0 },
  { name: 'Brotzeit', priceCents: 800, vatRate: 7, quantity: 0 },
  { name: 'Festzeichen', priceCents: 300, vatRate: 19, quantity: 45 },
  { name: 'Festessen', priceCents: 1450, vatRate: 7, quantity: 18 },
  { name: 'Korsoeinsatz', priceCents: 200, vatRate: 19, quantity: 0 },
  { name: 'Käsespätzle', priceCents: 1000, vatRate: 7, quantity: 13 },
  { name: 'Festschrift', priceCents: 1500, vatRate: 7, quantity: 1 },
  { name: 'Alkoholfreies Getränk (0,5l)', priceCents: 380, vatRate: 19, quantity: 34 }
]

export const SAMPLE_TAX_EXEMPT_TEXT = 'Als Kleinunternehmer im Sinne von § 19 UStG wird keine Umsatzsteuer berechnet.'
export const SAMPLE_STORNO_REASON = 'Falsche Personenzahl angegeben'
export const SAMPLE_CASH_TEXT = '<p>Betrag bar erhalten ____________________</p>'
export const SAMPLE_TRANSFER_TEXT =
  '<p>Bitte überweisen Sie den Betrag von {Gesamtbetrag} bis zum {Fälligkeitsdatum} unter Angabe der ' +
  'Rechnungsnummer {Rechnungsnummer} auf das unten genannte Konto.</p>'

type SampleLine = { name: string; priceCents: number; vatRate: VatRate; quantity: number }

function withTotals(lines: ReadonlyArray<SampleLine>) {
  const full = lines.map((l) => ({ ...l, lineTotalCents: calculateLineTotal(l.priceCents, l.quantity) }))
  return { lines: full, totals: calculateTotals(full) }
}

export function getSampleRenderData(overrides: Partial<InvoiceRenderData> = {}): InvoiceRenderData {
  const { lines, totals } = withTotals(SAMPLE_LINES)
  return {
    type: 'rechnung',
    number: '2025-081',
    originalNumber: null,
    festivalName: '100-jähriges Gründungsfest',
    invoiceDate: '2025-06-01',
    serviceDate: '2025-06-01',
    dueDate: '2025-06-08',
    today: '2025-06-01',
    customer: {
      kind: 'verein',
      clubId: null,
      contactName: 'Max Mustermann',
      clubName: 'Radsportverein Beispielhausen',
      street: 'Hauptstraße 12',
      zip: '01234',
      city: 'Beispielhausen',
      registeredPersons: 45
    },
    persons: 45,
    paymentKind: 'bar',
    paymentLabel: 'Bar',
    paymentText: SAMPLE_CASH_TEXT,
    lines,
    totals,
    taxExempt: true,
    taxExemptText: SAMPLE_TAX_EXEMPT_TEXT,
    stornoReason: null,
    ...overrides
  }
}

/** Stornobeleg zu den Beispieldaten: Mengen negiert, Summen negativ, Grund gesetzt. */
export function getSampleStornoRenderData(overrides: Partial<InvoiceRenderData> = {}): InvoiceRenderData {
  const { lines, totals } = withTotals(SAMPLE_LINES.map((l) => ({ ...l, quantity: l.quantity === 0 ? 0 : -l.quantity })))
  return getSampleRenderData({
    type: 'storno',
    number: '2025-082',
    originalNumber: '2025-081',
    lines,
    totals,
    stornoReason: SAMPLE_STORNO_REASON,
    ...overrides
  })
}

/** Viele Positionen (z. B. 40) für Seitenumbruch-Tests und Screenshots. */
export function getManyLinesSampleRenderData(count = 40, overrides: Partial<InvoiceRenderData> = {}): InvoiceRenderData {
  const source: SampleLine[] = []
  for (let i = 0; i < count; i++) {
    const base = SAMPLE_LINES[i % SAMPLE_LINES.length]!
    source.push({
      name: `${base.name} – Position ${i + 1}`,
      priceCents: base.priceCents,
      vatRate: base.vatRate,
      quantity: (i * 7) % 11
    })
  }
  const { lines, totals } = withTotals(source)
  return getSampleRenderData({ lines, totals, ...overrides })
}

export interface SampleContext {
  festival?: Pick<Festival, 'name' | 'festivalDate' | 'taxExempt' | 'taxExemptText' | 'numberPrefix' | 'numberDigits' | 'numberNext'> | null
  paymentMethods?: ReadonlyArray<Pick<PaymentMethod, 'kind' | 'label' | 'text' | 'dueDays'>> | null
  paymentKind?: PaymentKind
  type?: 'rechnung' | 'storno'
  /** Rechnungsdatum (Standard: Festdatum bzw. 2025-06-01) */
  invoiceDate?: string
  /** Anzahl Positionen statt der 8 Beispielpositionen (z. B. 40 zum Prüfen des Seitenumbruchs) */
  lineCount?: number
}

/**
 * Beispieldaten mit den echten Fest-Einstellungen (Festname, Steuerbefreiung/-text, Zahlungstexte,
 * Nummernkreis) – für die Live-Vorschau im Vorlagen-Editor und die Testseite.
 */
export function buildSampleRenderData(ctx: SampleContext = {}): InvoiceRenderData {
  const f = ctx.festival ?? null
  const kind = ctx.paymentKind ?? 'bar'
  const pm = ctx.paymentMethods?.find((m) => m.kind === kind) ?? null
  const invoiceDate = ctx.invoiceDate ?? f?.festivalDate ?? '2025-06-01'
  const dueDays = pm?.dueDays ?? 7
  let dueDate = invoiceDate
  try {
    dueDate = addDays(invoiceDate, dueDays)
  } catch {
    // ungültiges Datum → Rechnungsdatum
  }
  const number = (seq: number): string =>
    f ? `${f.numberPrefix}${String(Math.max(seq, 0)).padStart(f.numberDigits, '0')}` : `2025-${String(seq).padStart(3, '0')}`
  const seq = f?.numberNext ?? 81

  const common: Partial<InvoiceRenderData> = {
    festivalName: f?.name ?? '100-jähriges Gründungsfest',
    invoiceDate,
    serviceDate: f?.festivalDate ?? invoiceDate,
    dueDate,
    today: invoiceDate,
    paymentKind: kind,
    paymentLabel: pm?.label ?? (kind === 'bar' ? 'Bar' : 'Überweisung'),
    paymentText: pm?.text ?? (kind === 'bar' ? SAMPLE_CASH_TEXT : SAMPLE_TRANSFER_TEXT),
    taxExempt: f?.taxExempt ?? true,
    taxExemptText: f?.taxExemptText ?? SAMPLE_TAX_EXEMPT_TEXT
  }
  if (ctx.lineCount && ctx.lineCount !== SAMPLE_LINES.length) {
    const many = getManyLinesSampleRenderData(ctx.lineCount)
    if (ctx.type === 'storno') {
      const negated = many.lines.map((l) => ({ ...l, quantity: l.quantity === 0 ? 0 : -l.quantity }))
      const { lines, totals } = withTotals(negated)
      return getSampleStornoRenderData({ ...common, lines, totals, number: number(seq + 1), originalNumber: number(seq) })
    }
    return getSampleRenderData({ ...common, lines: many.lines, totals: many.totals, number: number(seq) })
  }
  if (ctx.type === 'storno') {
    return getSampleStornoRenderData({ ...common, number: number(seq + 1), originalNumber: number(seq) })
  }
  return getSampleRenderData({ ...common, number: number(seq) })
}
