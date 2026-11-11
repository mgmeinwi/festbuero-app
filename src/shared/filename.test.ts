import { describe, expect, it } from 'vitest'
import {
  buildPdfFileName,
  MAX_FILE_NAME_LENGTH,
  sanitizeFileName,
  sanitizeFolderName,
  validateFilenamePattern
} from './filename'
import { getSampleRenderData } from './invoice-render/sample-data'

const data = getSampleRenderData({ number: '2025-081', invoiceDate: '2025-06-01' })

describe('validateFilenamePattern', () => {
  it('akzeptiert Muster mit {Rechnungsnummer}', () => {
    expect(validateFilenamePattern('{Rechnungsnummer}')).toEqual({ valid: true })
    expect(validateFilenamePattern('{Rechnungsnummer} {Verein}')).toEqual({ valid: true })
    expect(validateFilenamePattern('{Rechnungsdatum_ISO}_{Rechnungsnummer}')).toEqual({ valid: true })
    expect(validateFilenamePattern('{rechnungsnummer}')).toEqual({ valid: true })
  })

  it('lehnt Muster ohne Rechnungsnummer ab', () => {
    const result = validateFilenamePattern('{Verein}')
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.error).toMatch(/\{Rechnungsnummer\}/)
  })

  it('lehnt leere Muster und unbekannte Platzhalter ab', () => {
    expect(validateFilenamePattern('').valid).toBe(false)
    expect(validateFilenamePattern('   ').valid).toBe(false)
    const unknown = validateFilenamePattern('{Rechnungsnummer} {Vereinsname}')
    expect(unknown.valid).toBe(false)
    if (!unknown.valid) expect(unknown.error).toMatch(/Vereinsname/)
    expect(validateFilenamePattern(`{Rechnungsnummer}${'x'.repeat(250)}`).valid).toBe(false)
  })
})

describe('sanitizeFileName', () => {
  it('ersetzt unzulässige Zeichen', () => {
    expect(sanitizeFileName('a<b>c:d"e/f\\g|h?i*j')).toBe('a_b_c_d_e_f_g_h_i_j')
    expect(sanitizeFileName('Tab\tNeu\nZeile\u0000')).toBe('Tab_Neu_Zeile_')
    expect(sanitizeFileName('2025/081')).toBe('2025_081')
  })

  it('vermeidet reservierte Windows-Namen', () => {
    expect(sanitizeFileName('CON')).toBe('_CON')
    expect(sanitizeFileName('nul')).toBe('_nul')
    expect(sanitizeFileName('com1')).toBe('_com1')
    expect(sanitizeFileName('LPT9.txt')).toBe('_LPT9.txt')
    expect(sanitizeFileName('CONTROL')).toBe('CONTROL')
  })

  it('entfernt Punkte/Leerzeichen am Ende und führende Punkte', () => {
    expect(sanitizeFileName('Rechnung. . ')).toBe('Rechnung')
    expect(sanitizeFileName('...versteckt')).toBe('versteckt')
    expect(sanitizeFileName('  viel   Platz  ')).toBe('viel Platz')
  })

  it('liefert einen Ersatznamen für leere Ergebnisse', () => {
    expect(sanitizeFileName('')).toBe('Rechnung')
    expect(sanitizeFileName('...')).toBe('Rechnung')
    expect(sanitizeFileName('???')).toBe('Rechnung')
  })

  it('begrenzt die Länge', () => {
    const long = sanitizeFileName('ä'.repeat(500))
    expect(Array.from(long).length).toBe(MAX_FILE_NAME_LENGTH)
    expect(sanitizeFileName(`${'a'.repeat(MAX_FILE_NAME_LENGTH - 1)}. b`)).toBe('a'.repeat(MAX_FILE_NAME_LENGTH - 1))
  })

  it('normalisiert Umlaute auf NFC', () => {
    const nfd = 'Gründungsfest'
    expect(sanitizeFileName(nfd)).toBe('Gründungsfest')
  })
})

describe('sanitizeFolderName', () => {
  it('bereinigt Festnamen', () => {
    expect(sanitizeFolderName('Gründungsfest 2025: 100 Jahre')).toBe('Gründungsfest 2025_ 100 Jahre')
    expect(sanitizeFolderName('')).toBe('Gründungsfest')
    expect(sanitizeFolderName('AUX')).toBe('_AUX')
  })
})

describe('buildPdfFileName', () => {
  it('Standardmuster', () => {
    expect(buildPdfFileName('{Rechnungsnummer}', data)).toBe('2025-081')
    expect(buildPdfFileName('', data)).toBe('2025-081')
  })

  it('Datum ohne Variante als ISO, Kundendaten bereinigt', () => {
    expect(buildPdfFileName('{Rechnungsdatum}_{Rechnungsnummer}', data)).toBe('2025-06-01_2025-081')
    expect(buildPdfFileName('{Rechnungsnummer} {Verein}', data)).toBe('2025-081 Radsportverein Beispielhausen')
    expect(buildPdfFileName('{Rechnungsnummer}_{Rechnungsdatum_dd/MM/yyyy}', data)).toBe('2025-081_01_06_2025')
    expect(buildPdfFileName('{Rechnungsnummer} {Rechnungsdatum_Lang}', data)).toBe('2025-081 1. Juni 2025')
  })

  it('unzulässige Zeichen aus Daten werden ersetzt', () => {
    const tricky = getSampleRenderData({
      number: '2025/081',
      customer: { ...data.customer, clubName: 'TSV "Blau:Weiß" e.V.' }
    })
    expect(buildPdfFileName('{Rechnungsnummer} {Verein}', tricky)).toBe('2025_081 TSV _Blau_Weiß_ e.V')
  })
})
