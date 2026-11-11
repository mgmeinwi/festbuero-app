import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDefaultTemplateConfig } from '@shared/invoice-render/default-template'
import type { TemplateConfig } from '@shared/types'
import { openDatabase, type Db } from '../db/connection'
import { createFestival } from './festivals'
import { getLogoDataUrl, getTemplate, resetTemplate, setLogo, updateTemplate, validateTemplateConfig } from './templates'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

describe('templates service', () => {
  let db: Db
  let dir: string
  let logosDir: string
  let festivalId: number

  beforeEach(() => {
    db = openDatabase(':memory:')
    dir = mkdtempSync(join(tmpdir(), 'festbuero-templates-'))
    logosDir = join(dir, 'logos')
    festivalId = createFestival(
      { name: 'Testfest', festivalDate: '2025-06-01', numberPrefix: '2025-', numberStart: 1, numberDigits: 3 },
      db
    ).id
  })
  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('liefert die Standardvorlage eines neuen Fests', () => {
    const t = getTemplate(festivalId, db)
    expect(t.festivalId).toBe(festivalId)
    expect(t.config).toEqual(getDefaultTemplateConfig())
    expect(t.logoFile).toBeNull()
  })

  it('legt eine fehlende Vorlage an und meldet unbekannte Feste verständlich', () => {
    db.prepare('DELETE FROM template WHERE festival_id = ?').run(festivalId)
    expect(getTemplate(festivalId, db).config).toEqual(getDefaultTemplateConfig())
    expect(() => getTemplate(9999, db)).toThrow('Das Gründungsfest wurde nicht gefunden.')
  })

  it('speichert eine geänderte Vorlage', () => {
    const config = getDefaultTemplateConfig()
    config.fontFamily = 'lato'
    config.subject.html = '<p>Beleg {Rechnungsnummer}</p>'
    config.footer.columns.push({ id: 'f2', html: '<p>Zweite Spalte</p>', align: 'right' })
    config.slots.notes.unshift({ id: 'neu', html: '<p>Neuer Hinweis</p>' })
    const saved = updateTemplate(festivalId, config, db)
    expect(saved.config.fontFamily).toBe('lato')
    expect(saved.config.subject.html).toBe('<p>Beleg {Rechnungsnummer}</p>')
    expect(saved.config.footer.columns).toHaveLength(2)
    expect(saved.config.slots.notes[0]!.id).toBe('neu')
    expect(getTemplate(festivalId, db).config).toEqual(saved.config)
  })

  it('prüft die Konfiguration gegen das Schema (deutsche Meldungen)', () => {
    const base = getDefaultTemplateConfig()
    const bad = (patch: (c: TemplateConfig) => void): TemplateConfig => {
      const c = structuredClone(base)
      patch(c)
      return c
    }
    expect(() => updateTemplate(festivalId, bad((c) => (c.fontFamily = 'comic' as never)), db)).toThrow(/Die Vorlage ist ungültig/)
    expect(() =>
      updateTemplate(festivalId, bad((c) => (c.footer.columns = [1, 2, 3, 4, 5].map((n) => ({ id: `f${n}`, html: '' })))), db)
    ).toThrow('höchstens 4 Spalten')
    expect(() => updateTemplate(festivalId, bad((c) => (c.footer.columns = [])), db)).toThrow('mindestens eine Spalte')
    expect(() => updateTemplate(festivalId, bad((c) => (c.baseFontSizePt = 2)), db)).toThrow('mindestens 5 pt')
    expect(() => updateTemplate(festivalId, bad((c) => (c.logo.widthMm = 500)), db)).toThrow('höchstens 120 mm')
    expect(() => updateTemplate(festivalId, { foo: 1 } as unknown as TemplateConfig, db)).toThrow(/Die Vorlage ist ungültig/)
    // nichts gespeichert
    expect(getTemplate(festivalId, db).config).toEqual(base)
    // unbekannte Felder werden verworfen
    const extra = validateTemplateConfig({ ...base, evil: '<script>' })
    expect('evil' in extra).toBe(false)
  })

  it('setzt auf die Standardvorlage zurück und behält das Logo', () => {
    const svgPath = join(dir, 'logo.svg')
    writeFileSync(svgPath, SVG)
    setLogo(festivalId, svgPath, { db, logosDir })
    const config = getDefaultTemplateConfig()
    config.baseFontSizePt = 9
    updateTemplate(festivalId, config, db)
    const reset = resetTemplate(festivalId, db)
    expect(reset.config).toEqual(getDefaultTemplateConfig())
    expect(reset.logoFile).toMatch(/^[a-f0-9]{64}\.svg$/)
  })

  describe('Logo', () => {
    it('kopiert inhaltsadressiert nach logos/<sha256>.<ext> und überschreibt nie', () => {
      const svgPath = join(dir, 'Mein Logo.SVG')
      writeFileSync(svgPath, SVG)
      const t = setLogo(festivalId, svgPath, { db, logosDir })
      expect(t.logoFile).toMatch(/^[a-f0-9]{64}\.svg$/)
      expect(readFileSync(join(logosDir, t.logoFile!), 'utf8')).toBe(SVG)

      // gleiche Datei erneut → gleicher Name, keine zweite Datei
      const again = setLogo(festivalId, svgPath, { db, logosDir })
      expect(again.logoFile).toBe(t.logoFile)
      expect(readdirSync(logosDir)).toHaveLength(1)

      // JPEG-Endung wird zu .jpg, PNG-Inhalt geprüft
      const pngPath = join(dir, 'bild.png')
      writeFileSync(pngPath, PNG_1PX)
      const png = setLogo(festivalId, pngPath, { db, logosDir })
      expect(png.logoFile).toMatch(/^[a-f0-9]{64}\.png$/)
      expect(readdirSync(logosDir)).toHaveLength(2)
    })

    it('schaltet das Logo beim Hochladen ein', () => {
      const config = getDefaultTemplateConfig()
      config.logo.enabled = false
      updateTemplate(festivalId, config, db)
      const svgPath = join(dir, 'logo.svg')
      writeFileSync(svgPath, SVG)
      expect(setLogo(festivalId, svgPath, { db, logosDir }).config.logo.enabled).toBe(true)
    })

    it('null entfernt nur die Referenz, die Datei bleibt', () => {
      const svgPath = join(dir, 'logo.svg')
      writeFileSync(svgPath, SVG)
      const file = setLogo(festivalId, svgPath, { db, logosDir }).logoFile!
      const removed = setLogo(festivalId, null, { db, logosDir })
      expect(removed.logoFile).toBeNull()
      expect(readdirSync(logosDir)).toEqual([file])
    })

    it('lehnt ungültige Dateien verständlich ab', () => {
      const txt = join(dir, 'logo.txt')
      writeFileSync(txt, 'hallo')
      expect(() => setLogo(festivalId, txt, { db, logosDir })).toThrow('Bildformat wird nicht unterstützt')
      const fakePng = join(dir, 'fake.png')
      writeFileSync(fakePng, 'kein png')
      expect(() => setLogo(festivalId, fakePng, { db, logosDir })).toThrow('kein gültiges Bild')
      expect(() => setLogo(festivalId, join(dir, 'fehlt.png'), { db, logosDir })).toThrow('nicht gefunden')
    })

    it('getLogoDataUrl liefert data:-URLs nur für Dateien aus logos/ (kein Path-Traversal)', () => {
      const svgPath = join(dir, 'logo.svg')
      writeFileSync(svgPath, SVG)
      const file = setLogo(festivalId, svgPath, { db, logosDir }).logoFile!
      const url = getLogoDataUrl(file, logosDir)
      expect(url).toBe(`data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}`)
      writeFileSync(join(dir, 'geheim.png'), PNG_1PX)
      expect(getLogoDataUrl('../geheim.png', logosDir)).toBeNull()
      expect(getLogoDataUrl('/etc/passwd', logosDir)).toBeNull()
      expect(getLogoDataUrl(`${'a'.repeat(64)}.png`, logosDir)).toBeNull() // existiert nicht
      expect(getLogoDataUrl(`..%2F${'a'.repeat(58)}.png`, logosDir)).toBeNull()
    })
  })
})
