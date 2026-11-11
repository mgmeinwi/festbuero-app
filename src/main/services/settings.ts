/**
 * App-Einstellungen (pro Rechner) in der Tabelle `app_settings` (Schlüssel = Feld von AppSettings,
 * Wert JSON-kodiert).
 */
import { z } from 'zod'
import type { AppSettings } from '@shared/types'
import { getDb, type Db } from '../db/connection'

export const DEFAULT_SETTINGS: Readonly<AppSettings> = Object.freeze({
  documentsDir: null,
  defaultPrinter: null,
  lastFestivalId: null,
  setupCompleted: false,
  theme: 'system'
})

const settingsPatchSchema = z
  .object({
    documentsDir: z.string().trim().min(1, 'Der Dokumentenordner darf nicht leer sein.').nullable(),
    defaultPrinter: z.string().trim().min(1).nullable(),
    lastFestivalId: z.number().int().positive().nullable(),
    setupCompleted: z.boolean(),
    theme: z.enum(['system', 'light', 'dark'])
  })
  .partial()
  .strict()

const KEYS = Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>

export function getSettings(db: Db = getDb()): AppSettings {
  const rows = db.prepare('SELECT key, value FROM app_settings').all() as Array<{ key: string; value: string }>
  const result: AppSettings = { ...DEFAULT_SETTINGS }
  for (const row of rows) {
    if (!(KEYS as string[]).includes(row.key)) continue
    try {
      const value: unknown = JSON.parse(row.value)
      const parsed = settingsPatchSchema.safeParse({ [row.key]: value })
      if (parsed.success) Object.assign(result, parsed.data)
    } catch {
      // defekter Wert → Standard behalten
    }
  }
  return result
}

/** Teil-Update; unbekannte Schlüssel oder falsche Typen → deutscher Fehler. Liefert die neuen Einstellungen. */
export function updateSettings(patch: Partial<AppSettings>, db: Db = getDb()): AppSettings {
  const parsed = settingsPatchSchema.safeParse(patch ?? {})
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const field = issue?.path.join('.') || ''
    const msg =
      issue?.code === 'unrecognized_keys'
        ? `Unbekannte Einstellung: ${(issue as { keys?: string[] }).keys?.join(', ') ?? ''}`
        : `Ungültiger Wert für Einstellung „${field}“.`
    throw new Error(issue?.message && issue.code === 'too_small' ? issue.message : msg)
  }
  const upsert = db.prepare(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  db.transaction(() => {
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value === undefined) continue
      upsert.run(key, JSON.stringify(value))
    }
  })()
  return getSettings(db)
}
