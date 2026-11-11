import { describe, expect, it } from 'vitest'
import { addDays, formatDate, isValidIsoDate, normalizeDatePattern, parseIsoDate, todayIso, toIsoDate } from './dates'

describe('todayIso / toIsoDate', () => {
  it('nutzt die lokale Zeit', () => {
    expect(todayIso(new Date(2025, 5, 1, 23, 59))).toBe('2025-06-01')
    expect(todayIso(new Date(2025, 0, 1, 0, 0))).toBe('2025-01-01')
    expect(toIsoDate(new Date(2024, 1, 29))).toBe('2024-02-29')
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('parseIsoDate / isValidIsoDate', () => {
  it('prüft Format und Kalender', () => {
    expect(parseIsoDate('2025-06-01')?.getDate()).toBe(1)
    expect(isValidIsoDate('2024-02-29')).toBe(true)
    expect(isValidIsoDate('2025-02-29')).toBe(false)
    expect(isValidIsoDate('2025-13-01')).toBe(false)
    expect(isValidIsoDate('01.06.2025')).toBe(false)
    expect(isValidIsoDate('')).toBe(false)
    expect(isValidIsoDate(null)).toBe(false)
  })
})

describe('addDays', () => {
  it('addiert Tage über Monats-/Jahresgrenzen', () => {
    expect(addDays('2025-06-01', 7)).toBe('2025-06-08')
    expect(addDays('2025-06-28', 7)).toBe('2025-07-05')
    expect(addDays('2025-12-29', 7)).toBe('2026-01-05')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2025-06-01', 0)).toBe('2025-06-01')
    expect(addDays('2025-06-01', -1)).toBe('2025-05-31')
  })
  it('übersteht Sommerzeitwechsel', () => {
    expect(addDays('2025-03-29', 1)).toBe('2025-03-30')
    expect(addDays('2025-03-30', 1)).toBe('2025-03-31')
    expect(addDays('2025-10-25', 2)).toBe('2025-10-27')
  })
  it('wirft bei ungültigem Datum', () => {
    expect(() => addDays('kaputt', 1)).toThrow(/Ungültiges Datum/)
  })
})

describe('formatDate', () => {
  it('Standardvarianten', () => {
    expect(formatDate('2025-06-01')).toBe('1. Juni 2025')
    expect(formatDate('2025-06-01', 'Lang')).toBe('1. Juni 2025')
    expect(formatDate('2025-06-01', 'DE')).toBe('01.06.2025')
    expect(formatDate('2025-06-01', 'ISO')).toBe('2025-06-01')
    expect(formatDate('2025-06-01', 'Kurz')).toBe('1.6.2025')
    expect(formatDate('2025-03-09', 'Lang')).toBe('9. März 2025')
  })

  it('Varianten sind unabhängig von Groß-/Kleinschreibung', () => {
    expect(formatDate('2025-06-01', 'de')).toBe('01.06.2025')
    expect(formatDate('2025-06-01', 'iso')).toBe('2025-06-01')
    expect(formatDate('2025-06-01', 'LANG')).toBe('1. Juni 2025')
  })

  it('freie date-fns-Muster mit deutscher Locale', () => {
    expect(formatDate('2025-06-01', 'dd.MM.yy')).toBe('01.06.25')
    expect(formatDate('2025-06-01', 'd. MMMM yyyy')).toBe('1. Juni 2025')
    expect(formatDate('2025-06-01', 'EEEE, d. MMMM')).toBe('Sonntag, 1. Juni')
    expect(formatDate('2025-06-01', 'dd.MM.yyyy')).toBe('01.06.2025')
    expect(formatDate('2025-06-01', "'am' d.M.")).toBe('am 1.6.')
    expect(formatDate('2025-06-01', 'MMM yyyy')).toBe('Juni 2025')
  })

  it('übliche Fremdschreibweisen werden toleriert', () => {
    expect(formatDate('2025-06-01', 'DD.MM.YYYY')).toBe('01.06.2025')
    expect(formatDate('2025-06-01', 'TT.MM.JJJJ')).toBe('01.06.2025')
    expect(formatDate('2025-06-01', 'dd.mm.yyyy')).toBe('01.06.2025')
    expect(normalizeDatePattern("d. 'Datum' MMMM")).toBe("d. 'Datum' MMMM")
  })

  it('ungültiges Muster → Fallback Lang statt Exception', () => {
    expect(formatDate('2025-06-01', 'foo')).toBe('1. Juni 2025')
    expect(formatDate('2025-06-01', 'jjj')).toBe('1. Juni 2025')
    expect(formatDate('2025-06-01', '   ')).toBe('1. Juni 2025')
  })

  it('ungültiges Datum bleibt unverändert', () => {
    expect(formatDate('kein Datum', 'DE')).toBe('kein Datum')
    expect(formatDate('', 'DE')).toBe('')
  })
})
