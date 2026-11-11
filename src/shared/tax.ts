/**
 * Steuer- und Summenberechnung. Preise sind BRUTTO (Cent, Ganzzahl).
 *
 * Regel (architecture.md §5): Pro Steuersatz Brutto summieren,
 * netto = round(brutto × 100 / (100 + satz)) kaufmännisch auf Betragsbasis (Vorzeichen danach,
 * damit ein Storno exakt die Negation der Rechnung ist), mwst = brutto − netto.
 * Ausschließlich Integer-Arithmetik – keine Gleitkomma-Rundung.
 */
import type { Cents, InvoiceTotals, VatBreakdown, VatRate } from './types'

export interface TaxLineInput {
  priceCents: Cents
  vatRate: VatRate
  quantity: number
}

function assertInteger(value: number, what: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Ungültige ${what}: ${String(value)} (erwartet: ganze Zahl).`)
  }
}

/** Zeilensumme = Einzelpreis × Menge (bei Storno mit negativer Menge negativ). */
export function calculateLineTotal(priceCents: Cents, quantity: number): Cents {
  assertInteger(priceCents, 'Preisangabe')
  assertInteger(quantity, 'Menge')
  const total = priceCents * quantity
  assertInteger(total, 'Zeilensumme')
  return total === 0 ? 0 : total
}

/**
 * Kaufmännisch gerundete Ganzzahl-Division für nicht-negative Werte:
 * round(numerator / denominator), .5 wird aufgerundet.
 */
function divRoundHalfUp(numerator: number, denominator: number): number {
  const q = Math.floor(numerator / denominator)
  const r = numerator - q * denominator
  return 2 * r >= denominator ? q + 1 : q
}

/** Nettobetrag aus einem Bruttobetrag eines Steuersatzes (Vorzeichen bleibt erhalten). */
export function netFromGross(grossCents: Cents, vatRate: number): Cents {
  assertInteger(grossCents, 'Bruttoangabe')
  assertInteger(vatRate, 'Steuersatzangabe')
  const abs = Math.abs(grossCents)
  const net = divRoundHalfUp(abs * 100, 100 + vatRate)
  return grossCents < 0 ? -net : net
}

/** Aufschlüsselung eines Steuersatzes. */
export function breakdownForRate(rate: VatRate, grossCents: Cents): VatBreakdown {
  const netCents = netFromGross(grossCents, rate)
  return { rate, grossCents, netCents, vatCents: grossCents - netCents }
}

/**
 * Summen einer Rechnung. `byRate` enthält nur Steuersätze mit Brutto ≠ 0, aufsteigend sortiert.
 * Gesamt-Netto/-MwSt sind die Summen der pro Satz gerundeten Werte.
 */
export function calculateTotals(lines: ReadonlyArray<TaxLineInput>): InvoiceTotals {
  const grossByRate = new Map<number, number>()
  for (const line of lines) {
    const lineTotal = calculateLineTotal(line.priceCents, line.quantity)
    grossByRate.set(line.vatRate, (grossByRate.get(line.vatRate) ?? 0) + lineTotal)
  }

  const byRate: VatBreakdown[] = [...grossByRate.entries()]
    .filter(([, gross]) => gross !== 0)
    .sort(([a], [b]) => a - b)
    .map(([rate, gross]) => breakdownForRate(rate as VatRate, gross))

  let grossCents = 0
  for (const gross of grossByRate.values()) grossCents += gross
  const netCents = byRate.reduce((sum, b) => sum + b.netCents, 0)
  const vatCents = byRate.reduce((sum, b) => sum + b.vatCents, 0)

  return {
    grossCents: grossCents === 0 ? 0 : grossCents,
    netCents: netCents === 0 ? 0 : netCents,
    vatCents: vatCents === 0 ? 0 : vatCents,
    byRate
  }
}
