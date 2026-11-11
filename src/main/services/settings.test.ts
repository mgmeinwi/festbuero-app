import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '../db/connection'
import { DEFAULT_SETTINGS, getSettings, updateSettings } from './settings'

describe('settings service', () => {
  let db: Db
  beforeEach(() => {
    db = openDatabase(':memory:')
  })
  afterEach(() => db.close())

  it('liefert Standardwerte', () => {
    expect(getSettings(db)).toEqual({
      documentsDir: null,
      defaultPrinter: null,
      lastFestivalId: null,
      setupCompleted: false,
      theme: 'system'
    })
    expect(getSettings(db)).toEqual(DEFAULT_SETTINGS)
  })

  it('speichert Teil-Updates JSON-kodiert', () => {
    const s = updateSettings({ documentsDir: '/tmp/belege', theme: 'dark', setupCompleted: true }, db)
    expect(s).toMatchObject({ documentsDir: '/tmp/belege', theme: 'dark', setupCompleted: true, defaultPrinter: null })
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'theme'").get() as { value: string }
    expect(row.value).toBe('"dark"')
    expect(updateSettings({ lastFestivalId: 3 }, db).lastFestivalId).toBe(3)
    expect(updateSettings({ defaultPrinter: null }, db).defaultPrinter).toBeNull()
    expect(getSettings(db).theme).toBe('dark')
  })

  it('lehnt unbekannte Schlüssel und falsche Typen ab', () => {
    expect(() => updateSettings({ foo: 1 } as never, db)).toThrow(/Unbekannte Einstellung/)
    expect(() => updateSettings({ theme: 'blau' } as never, db)).toThrow(/theme/)
    expect(() => updateSettings({ lastFestivalId: 'x' } as never, db)).toThrow()
    expect(getSettings(db)).toEqual(DEFAULT_SETTINGS)
  })

  it('ignoriert defekte gespeicherte Werte', () => {
    db.prepare("INSERT INTO app_settings (key, value) VALUES ('theme', 'kein json')").run()
    db.prepare("INSERT INTO app_settings (key, value) VALUES ('unbekannt', '1')").run()
    expect(getSettings(db).theme).toBe('system')
  })
})
