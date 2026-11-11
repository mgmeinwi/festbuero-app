import { describe, expect, it } from 'vitest'
import { SAMPLE_LINES } from './invoice-render/sample-data'
import { calculateLineTotal, calculateTotals, netFromGross, type TaxLineInput } from './tax'
import type { InvoiceTotals } from './types'

/** Positionen der Beispielrechnung (Gesamt 670,20 €). */
const EXAMPLE_LINES: TaxLineInput[] = [
  { priceCents: 970, vatRate: 19, quantity: 0 }, // 1 Maß Bier
  { priceCents: 800, vatRate: 7, quantity: 0 }, // Brotzeit
  { priceCents: 300, vatRate: 19, quantity: 45 }, // Festzeichen
  { priceCents: 1450, vatRate: 7, quantity: 18 }, // Festessen
  { priceCents: 200, vatRate: 19, quantity: 0 }, // Korsoeinsatz
  { priceCents: 1000, vatRate: 7, quantity: 13 }, // Käsespätzle
  { priceCents: 1500, vatRate: 7, quantity: 1 }, // Festschrift
  { priceCents: 380, vatRate: 19, quantity: 34 } // Alkoholfreies Getränk (0,5l)
]

function negate(lines: TaxLineInput[]): TaxLineInput[] {
  return lines.map((l) => ({ ...l, quantity: -l.quantity }))
}

/** Negation ohne -0 (Beträge sind nie -0). */
const neg = (x: number) => (x === 0 ? 0 : -x)

function expectExactNegation(a: InvoiceTotals, b: InvoiceTotals) {
  expect(b.grossCents).toBe(neg(a.grossCents))
  expect(b.netCents).toBe(neg(a.netCents))
  expect(b.vatCents).toBe(neg(a.vatCents))
  expect(b.byRate.map((r) => r.rate)).toEqual(a.byRate.map((r) => r.rate))
  b.byRate.forEach((r, i) => {
    expect(r.grossCents).toBe(neg(a.byRate[i]!.grossCents))
    expect(r.netCents).toBe(neg(a.byRate[i]!.netCents))
    expect(r.vatCents).toBe(neg(a.byRate[i]!.vatCents))
  })
}

describe('calculateLineTotal', () => {
  it('multipliziert Preis und Menge', () => {
    expect(calculateLineTotal(300, 45)).toBe(13500)
    expect(calculateLineTotal(970, 0)).toBe(0)
    expect(calculateLineTotal(380, -34)).toBe(-12920)
    expect(Object.is(calculateLineTotal(970, -0), -0)).toBe(false)
  })
  it('lehnt Nicht-Ganzzahlen ab', () => {
    expect(() => calculateLineTotal(9.7, 1)).toThrow()
    expect(() => calculateLineTotal(970, 1.5)).toThrow(/Menge/)
    expect(() => calculateLineTotal(970, Number.NaN)).toThrow()
  })
})

describe('calculateTotals – Beispielrechnung', () => {
  it('ergibt exakt 670,20 € (67020 Cent)', () => {
    const totals = calculateTotals(EXAMPLE_LINES)
    expect(totals.grossCents).toBe(67020)
  })

  it('stimmt mit den Beispieldaten des Renderers überein', () => {
    expect(calculateTotals(SAMPLE_LINES).grossCents).toBe(67020)
  })

  it('rechnet die Steuer pro Satz auf Rechnungsebene heraus', () => {
    const totals = calculateTotals(EXAMPLE_LINES)
    // 19 %: 13500 + 12920 = 26420 brutto → netto round(26420 × 100 / 119) = 22202 (22201,68…)
    // 7 %: 26100 + 13000 + 1500 = 40600 brutto → netto round(40600 × 100 / 107) = 37944 (37943,92…)
    expect(totals.byRate).toEqual([
      { rate: 7, grossCents: 40600, netCents: 37944, vatCents: 2656 },
      { rate: 19, grossCents: 26420, netCents: 22202, vatCents: 4218 }
    ])
    expect(totals.netCents).toBe(37944 + 22202)
    expect(totals.vatCents).toBe(2656 + 4218)
    expect(totals.netCents + totals.vatCents).toBe(totals.grossCents)
  })

  it('Storno (negierte Mengen) ist die exakte Negation', () => {
    const original = calculateTotals(EXAMPLE_LINES)
    const storno = calculateTotals(negate(EXAMPLE_LINES))
    expect(storno.grossCents).toBe(-67020)
    expectExactNegation(original, storno)
  })
})

describe('calculateTotals – Rundung und Grenzfälle', () => {
  it('exakte Fälle ohne Rundung', () => {
    expect(netFromGross(107, 7)).toBe(100)
    expect(netFromGross(119, 19)).toBe(100)
    expect(netFromGross(1785, 19)).toBe(1500)
    expect(netFromGross(0, 7)).toBe(0)
    // 1 Cent brutto bei 7 %: 0,93… → 1
    expect(netFromGross(1, 7)).toBe(1)
  })

  it('rundet ,5 auf und spiegelt beim Vorzeichen (Betragsbasis)', () => {
    // Satz 100 (nur zum Test der Rundung): netto = brutto / 2 → 3 / 2 = 1,5 → 2
    expect(netFromGross(3, 100)).toBe(2)
    expect(netFromGross(-3, 100)).toBe(-2)
    expect(netFromGross(5, 100)).toBe(3)
    expect(netFromGross(-5, 100)).toBe(-3)
    // knapp unter ,5 → ab
    expect(netFromGross(1, 19)).toBe(1) // 0,84 → 1
    expect(netFromGross(2, 19)).toBe(2) // 1,68 → 2
    expect(netFromGross(3, 19)).toBe(3) // 2,52 → 3
    expect(netFromGross(6, 19)).toBe(5) // 5,04 → 5
  })

  it('gemischte 7/19 % mit Rundung pro Satz (nicht pro Zeile)', () => {
    const lines: TaxLineInput[] = [
      { priceCents: 333, vatRate: 7, quantity: 3 }, // 999
      { priceCents: 1, vatRate: 7, quantity: 1 }, // 1  → 7 %: 1000 brutto → netto 934,57… → 935
      { priceCents: 499, vatRate: 19, quantity: 1 }, // 19 %: 499 → netto 419,33… → 419
      { priceCents: 0, vatRate: 19, quantity: 5 }
    ]
    const totals = calculateTotals(lines)
    expect(totals.byRate).toEqual([
      { rate: 7, grossCents: 1000, netCents: 935, vatCents: 65 },
      { rate: 19, grossCents: 499, netCents: 419, vatCents: 80 }
    ])
    expect(totals.grossCents).toBe(1499)
    expect(totals.netCents).toBe(1354)
    expect(totals.vatCents).toBe(145)
  })

  it('rundet einmal pro Satz, nicht pro Zeile', () => {
    // zwei Zeilen à 3 Cent bei 19 %: pro Zeile wären es 2 × round(2,52) = 6 netto,
    // pro Satz round(6 × 100 / 119 = 5,04) = 5 netto
    const totals = calculateTotals([
      { priceCents: 3, vatRate: 19, quantity: 1 },
      { priceCents: 3, vatRate: 19, quantity: 1 }
    ])
    expect(totals.byRate).toEqual([{ rate: 19, grossCents: 6, netCents: 5, vatCents: 1 }])
  })

  it('lässt Sätze mit Brutto 0 weg und sortiert aufsteigend', () => {
    const totals = calculateTotals([
      { priceCents: 500, vatRate: 19, quantity: 2 },
      { priceCents: 200, vatRate: 7, quantity: 0 }
    ])
    expect(totals.byRate.map((b) => b.rate)).toEqual([19])

    const both = calculateTotals([
      { priceCents: 500, vatRate: 19, quantity: 1 },
      { priceCents: 200, vatRate: 7, quantity: 1 }
    ])
    expect(both.byRate.map((b) => b.rate)).toEqual([7, 19])
  })

  it('Satz mit sich aufhebenden Positionen erscheint nicht', () => {
    const totals = calculateTotals([
      { priceCents: 500, vatRate: 7, quantity: 1 },
      { priceCents: 500, vatRate: 7, quantity: -1 },
      { priceCents: 119, vatRate: 19, quantity: 1 }
    ])
    expect(totals.byRate).toEqual([{ rate: 19, grossCents: 119, netCents: 100, vatCents: 19 }])
    expect(totals.grossCents).toBe(119)
  })

  it('leere Rechnung → alles 0', () => {
    expect(calculateTotals([])).toEqual({ grossCents: 0, netCents: 0, vatCents: 0, byRate: [] })
    const zero = calculateTotals([{ priceCents: 970, vatRate: 19, quantity: 0 }])
    expect(zero).toEqual({ grossCents: 0, netCents: 0, vatCents: 0, byRate: [] })
    expect(Object.is(zero.grossCents, -0)).toBe(false)
  })

  it('negative Summen sind für viele Beträge exakt negiert', () => {
    for (let gross = 1; gross <= 3000; gross += 7) {
      for (const rate of [7, 19] as const) {
        const pos = calculateTotals([{ priceCents: gross, vatRate: rate, quantity: 1 }])
        const neg = calculateTotals([{ priceCents: gross, vatRate: rate, quantity: -1 }])
        expectExactNegation(pos, neg)
        expect(pos.netCents + pos.vatCents).toBe(pos.grossCents)
      }
    }
  })

  it('Netto entspricht der mathematisch gerundeten Division', () => {
    for (let gross = 0; gross <= 5000; gross++) {
      for (const rate of [7, 19]) {
        const exact = (gross * 100) / (100 + rate)
        const expected = Math.floor(exact + 0.5 + 1e-9)
        expect(netFromGross(gross, rate)).toBe(expected)
      }
    }
  })
})
