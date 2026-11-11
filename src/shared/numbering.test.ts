import { describe, expect, it } from 'vitest'
import { defaultNumberPrefix, formatInvoiceNumber } from './numbering'

describe('formatInvoiceNumber', () => {
  it('füllt mit führenden Nullen auf', () => {
    expect(formatInvoiceNumber('2025-', 81, 3)).toBe('2025-081')
    expect(formatInvoiceNumber('2025-', 1, 3)).toBe('2025-001')
    expect(formatInvoiceNumber('', 7, 1)).toBe('7')
    expect(formatInvoiceNumber('R', 0, 4)).toBe('R0000')
  })

  it('schneidet längere Zahlen nicht ab', () => {
    expect(formatInvoiceNumber('2025-', 1234, 3)).toBe('2025-1234')
    expect(formatInvoiceNumber('2025-', 1000, 3)).toBe('2025-1000')
  })

  it('lehnt ungültige laufende Nummern ab', () => {
    expect(() => formatInvoiceNumber('2025-', -1, 3)).toThrow(/laufende Nummer/)
    expect(() => formatInvoiceNumber('2025-', 1.5, 3)).toThrow()
  })
})

describe('defaultNumberPrefix', () => {
  it('nimmt das Jahr des Festdatums', () => {
    expect(defaultNumberPrefix('2025-06-01')).toBe('2025-')
    expect(defaultNumberPrefix(null)).toMatch(/^\d{4}-$/)
  })
})
