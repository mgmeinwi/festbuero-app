import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSampleRenderData } from '@shared/invoice-render/sample-data'
import { buildPdfFileName } from '@shared/filename'

vi.mock('electron', async () => (await import('./invoice-test-utils')).electronMock())

import { describeFilingError, filingDir, requireDocumentsDir, variantFileName, writeFileExclusive } from './filing'

describe('Ablage: Pfade und Dateinamen', () => {
  it('Rechnungen und Stornos in getrennten Ordnern unter dem Festnamen', () => {
    expect(filingDir('/docs', 'Testfest 2025', 'rechnung')).toBe(join('/docs', 'Testfest 2025', 'Rechnungen'))
    expect(filingDir('/docs', 'Testfest 2025', 'storno')).toBe(join('/docs', 'Testfest 2025', 'Stornos'))
  })

  it('ersetzt unzulässige Zeichen im Festnamen', () => {
    expect(filingDir('/docs', 'Fest: 100/Jahre? <neu> *|"', 'rechnung')).toBe(join('/docs', 'Fest_ 100_Jahre_ _neu_ ___', 'Rechnungen'))
    expect(filingDir('/docs', '...', 'rechnung')).toBe(join('/docs', 'Gründungsfest', 'Rechnungen'))
    expect(filingDir('/docs', 'CON', 'rechnung')).toBe(join('/docs', '_CON', 'Rechnungen'))
    expect(filingDir('/docs', 'Fest. ', 'rechnung')).toBe(join('/docs', 'Fest', 'Rechnungen'))
  })

  it('Dateiname aus Muster mit unzulässigen Zeichen', () => {
    const data = getSampleRenderData({ number: '2025/081' })
    data.customer.clubName = 'RV "Isar:au" e.V.'
    expect(buildPdfFileName('{Rechnungsnummer} {Verein}', data)).toBe('2025_081 RV _Isar_au_ e.V')
    expect(buildPdfFileName('{Rechnungsnummer}_{Rechnungsdatum}', getSampleRenderData())).toBe('2025-081_2025-06-01')
  })

  it('Namensvarianten', () => {
    expect(variantFileName('2025-081', 1)).toBe('2025-081.pdf')
    expect(variantFileName('2025-081', 2)).toBe('2025-081 (2).pdf')
    expect(variantFileName('2025-081', 3, '.zip')).toBe('2025-081 (3).zip')
  })
})

describe('Ablage: exklusives Schreiben', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'festbuero-filing-'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('legt Ordner an und überschreibt nie („ (2)“, „ (3)“ …)', () => {
    const dir = join(root, 'Fest', 'Rechnungen')
    const a = writeFileExclusive(dir, '2025-081', Buffer.from('A'))
    const b = writeFileExclusive(dir, '2025-081', Buffer.from('B'))
    const c = writeFileExclusive(dir, '2025-081', Buffer.from('C'))
    expect([a, b, c]).toEqual([join(dir, '2025-081.pdf'), join(dir, '2025-081 (2).pdf'), join(dir, '2025-081 (3).pdf')])
    expect(readFileSync(a, 'utf8')).toBe('A')
    expect(readFileSync(b, 'utf8')).toBe('B')
    expect(readFileSync(c, 'utf8')).toBe('C')
    // keine Temp-Dateien zurückgelassen
    expect(readdirSync(dir).sort()).toEqual(['2025-081 (2).pdf', '2025-081 (3).pdf', '2025-081.pdf'])
  })

  it('überspringt auch belegte Zwischennamen', () => {
    const dir = join(root, 'R')
    mkdirSync(dir)
    writeFileSync(join(dir, 'X.pdf'), 'alt')
    writeFileSync(join(dir, 'X (2).pdf'), 'alt2')
    expect(writeFileExclusive(dir, 'X', Buffer.from('neu'))).toBe(join(dir, 'X (3).pdf'))
    expect(readFileSync(join(dir, 'X.pdf'), 'utf8')).toBe('alt')
    expect(readFileSync(join(dir, 'X (2).pdf'), 'utf8')).toBe('alt2')
  })

  it('schreibt große Inhalte vollständig', () => {
    const data = Buffer.alloc(3 * 1024 * 1024, 7)
    const path = writeFileExclusive(join(root, 'gross'), 'big', data)
    expect(readFileSync(path).equals(data)).toBe(true)
  })

  it('prüft den Dokumentenordner', () => {
    expect(() => requireDocumentsDir(null)).toThrow('Bitte zuerst in den Einstellungen einen Dokumentenordner wählen.')
    expect(() => requireDocumentsDir('  ')).toThrow('Bitte zuerst in den Einstellungen einen Dokumentenordner wählen.')
    expect(() => requireDocumentsDir(join(root, 'fehlt'))).toThrow(/wurde nicht gefunden/)
    const file = join(root, 'datei.txt')
    writeFileSync(file, 'x')
    expect(() => requireDocumentsDir(file)).toThrow(/wurde nicht gefunden/)
    expect(requireDocumentsDir(root)).toBe(root)
  })
})

describe('Ablage: Fehlermeldungen', () => {
  const err = (code: string) => Object.assign(new Error(`${code}: technisch`), { code })
  it('übersetzt typische Dateisystemfehler', () => {
    expect(describeFilingError(err('EACCES'), '/docs/Fest/Rechnungen')).toMatch(/^Keine Schreibrechte im Ablageordner „\/docs\/Fest\/Rechnungen“/)
    expect(describeFilingError(err('ENOSPC'), '/x')).toMatch(/kein Speicherplatz/)
    expect(describeFilingError(err('EROFS'), '/x')).toMatch(/schreibgeschützt/)
    expect(describeFilingError(err('ENAMETOOLONG'), '/x')).toMatch(/zu lang/)
    expect(describeFilingError(new Error('Bitte zuerst …'), '')).toBe('Bitte zuerst …')
  })
})
