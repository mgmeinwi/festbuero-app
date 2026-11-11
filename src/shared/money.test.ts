import { describe, expect, it } from 'vitest'
import { EURO_DASH, formatAmount, formatEuro, formatEuroOrDash, NBSP, parseEuroToCents } from './money'

describe('formatEuro', () => {
  it('formatiert deutsch mit geschütztem Leerzeichen', () => {
    expect(formatEuro(123456)).toBe(`1.234,56${NBSP}€`)
    expect(formatEuro(970)).toBe(`9,70${NBSP}€`)
    expect(formatEuro(5)).toBe(`0,05${NBSP}€`)
    expect(formatEuro(0)).toBe(`0,00${NBSP}€`)
    expect(formatEuro(67020)).toBe(`670,20${NBSP}€`)
    expect(formatEuro(123456789)).toBe(`1.234.567,89${NBSP}€`)
  })

  it('formatiert negative Beträge mit Minus', () => {
    expect(formatEuro(-13500)).toBe(`-135,00${NBSP}€`)
    expect(formatEuro(-5)).toBe(`-0,05${NBSP}€`)
    expect(formatAmount(-123456)).toBe('-1.234,56')
  })

  it('lehnt Nicht-Ganzzahlen ab', () => {
    expect(() => formatEuro(9.7)).toThrow(/Cent/)
    expect(() => formatEuro(Number.NaN)).toThrow()
  })
})

describe('formatEuroOrDash', () => {
  it('zeigt 0 als „– €“', () => {
    expect(formatEuroOrDash(0)).toBe(EURO_DASH)
    expect(EURO_DASH).toBe(`–${NBSP}€`)
    expect(formatEuroOrDash(-0)).toBe(EURO_DASH)
  })
  it('zeigt andere Beträge normal', () => {
    expect(formatEuroOrDash(13500)).toBe(`135,00${NBSP}€`)
    expect(formatEuroOrDash(-13500)).toBe(`-135,00${NBSP}€`)
  })
})

describe('parseEuroToCents', () => {
  it.each([
    ['9,70', 970],
    ['9,7', 970],
    ['9.70', 970],
    ['9.7', 970],
    ['1.234,56', 123456],
    ['1234,56', 123456],
    ['12', 1200],
    ['0', 0],
    ['0,05', 5],
    [',5', 50],
    ['12,', 1200],
    ['12 €', 1200],
    ['12,50€', 1250],
    ['€ 12,50', 1250],
    ['  3,80 € ', 380],
    ['1 234,56 €', 123456],
    ['1.234', 123400],
    ['1.234.567', 123456700],
    ['1,234.56', 123456],
    ['-5,00', -500],
    ['+5', 500],
    ['5,00-', -500],
    ['12 EUR', 1200]
  ])('„%s“ → %i', (input, expected) => {
    expect(parseEuroToCents(input)).toBe(expected)
  })

  it.each(['', '   ', '€', 'abc', '9,705', '1,2,3', '1.2.3', '12a', '--5', '1.23.456', '1.234,5.6', '.'])(
    'ungültig: „%s“ → null',
    (input) => {
      expect(parseEuroToCents(input)).toBeNull()
    }
  )

  it('akzeptiert Zahlen', () => {
    expect(parseEuroToCents(9.7)).toBe(970)
    expect(parseEuroToCents(Number.NaN)).toBeNull()
    expect(parseEuroToCents(null)).toBeNull()
    expect(parseEuroToCents(undefined)).toBeNull()
  })

  it('ist mit formatEuro umkehrbar', () => {
    for (const cents of [0, 5, 970, 123456, 99999999]) {
      expect(parseEuroToCents(formatEuro(cents))).toBe(cents)
    }
  })
})
