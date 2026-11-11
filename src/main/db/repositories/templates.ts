/**
 * SQL für Rechnungsvorlagen (Tabelle `template`, eine Zeile pro Fest). Zuständig: Bereich „Vorlage“.
 * `config_json` = TemplateConfig (JSON), `logo_file` = Dateiname in `<userData>/logos/`.
 */
import { nowIso, type Db } from '../connection'

export interface TemplateRow {
  id: number
  festival_id: number
  config_json: string
  logo_file: string | null
  updated_at: string
}

export function findTemplateRow(db: Db, festivalId: number): TemplateRow | null {
  const row = db.prepare('SELECT * FROM template WHERE festival_id = ?').get(festivalId) as TemplateRow | undefined
  return row ?? null
}

export function festivalExists(db: Db, festivalId: number): boolean {
  return db.prepare('SELECT 1 FROM festival WHERE id = ?').get(festivalId) !== undefined
}

/** Legt die Vorlage an, falls sie fehlt (z. B. sehr alte Datenbestände). */
export function insertTemplateIfMissing(db: Db, festivalId: number, configJson: string): void {
  db.prepare(
    `INSERT INTO template (festival_id, config_json, logo_file, updated_at)
     SELECT ?, ?, NULL, ? WHERE NOT EXISTS (SELECT 1 FROM template WHERE festival_id = ?)`
  ).run(festivalId, configJson, nowIso(), festivalId)
}

export function updateTemplateConfig(db: Db, festivalId: number, configJson: string): void {
  db.prepare('UPDATE template SET config_json = ?, updated_at = ? WHERE festival_id = ?').run(configJson, nowIso(), festivalId)
}

export function updateTemplateLogo(db: Db, festivalId: number, logoFile: string | null, configJson?: string): void {
  if (configJson === undefined) {
    db.prepare('UPDATE template SET logo_file = ?, updated_at = ? WHERE festival_id = ?').run(logoFile, nowIso(), festivalId)
  } else {
    db.prepare('UPDATE template SET logo_file = ?, config_json = ?, updated_at = ? WHERE festival_id = ?').run(
      logoFile,
      configJson,
      nowIso(),
      festivalId
    )
  }
}
