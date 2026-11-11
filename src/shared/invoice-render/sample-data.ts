/**
 * Erfundene Beispieldaten für Editor-Vorschau, Testseite und Screenshots.
 * Positionen und Mengen entsprechen der Beispielrechnung (Gesamt 670,20 €), Namen sind neutral.
 *
 * STUB des Bereichs „Basis“ – darf vom Bereich „Vorlage“ erweitert werden (Signatur bleibt).
 */
import { calculateLineTotal, calculateTotals } from '../tax'
import type { InvoiceRenderData, VatRate } from '../types'

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

export function getSampleRenderData(overrides: Partial<InvoiceRenderData> = {}): InvoiceRenderData {
  const lines = SAMPLE_LINES.map((l) => ({ ...l, lineTotalCents: calculateLineTotal(l.priceCents, l.quantity) }))
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
    paymentText: '<p>Betrag bar erhalten ____________________</p>',
    lines,
    totals: calculateTotals(lines),
    taxExempt: true,
    taxExemptText: 'Als Kleinunternehmer im Sinne von § 19 UStG wird keine Umsatzsteuer berechnet.',
    ...overrides
  }
}
