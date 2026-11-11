/**
 * SQLite-Verbindung (better-sqlite3) und Migrationen.
 *
 * - `openDatabase(path)` öffnet (oder erzeugt) die Datenbank, setzt die Pragmas und migriert.
 *   `openDatabase(':memory:')` liefert eine frische, migrierte In-Memory-DB für Tests.
 * - `initDatabase(path)` öffnet die App-Datenbank und registriert sie als Singleton für `getDb()`.
 * - `setDb(db)` setzt das Singleton (z. B. In-Memory-DB in Service-Tests).
 */
import Database from 'better-sqlite3'
import { migrations as defaultMigrations, type Migration } from './migrations'

export type Db = Database.Database

let current: Db | null = null

export interface OpenDatabaseOptions {
  /** Standard true */
  migrate?: boolean
  /** nur für Tests: alternative Migrationsliste */
  migrations?: Migration[]
}

export function openDatabase(path: string, options: OpenDatabaseOptions = {}): Db {
  const db = new Database(path)
  try {
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.pragma('busy_timeout = 5000')
    if (options.migrate !== false) runMigrations(db, options.migrations)
  } catch (err) {
    db.close()
    throw err
  }
  return db
}

/** Aktuelle Schema-Version (`PRAGMA user_version`). */
export function getSchemaVersion(db: Db): number {
  return db.pragma('user_version', { simple: true }) as number
}

/**
 * Führt alle noch nicht angewendeten Migrationen aus – aufsteigend, jede in einer eigenen
 * Transaktion (inkl. Setzen von `user_version`). Liefert die Liste der angewendeten Versionen.
 */
export function runMigrations(db: Db, list: Migration[] = defaultMigrations): number[] {
  const sorted = [...list].sort((a, b) => a.version - b.version)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.version === sorted[i - 1]!.version) {
      throw new Error(`Doppelte Migrationsversion ${sorted[i]!.version}.`)
    }
  }
  const latest = sorted.at(-1)?.version ?? 0
  const currentVersion = getSchemaVersion(db)
  if (currentVersion > latest) {
    throw new Error(
      `Die Datenbank stammt von einer neueren Programmversion (Schema ${currentVersion}, unterstützt bis ${latest}). ` +
        'Bitte die aktuelle Version der Festbüro-App installieren.'
    )
  }

  const applied: number[] = []
  for (const migration of sorted) {
    if (migration.version <= currentVersion) continue
    if (!Number.isInteger(migration.version) || migration.version <= 0) {
      throw new Error(`Ungültige Migrationsversion: ${migration.version}.`)
    }
    const apply = db.transaction(() => {
      db.exec(migration.sql)
      db.pragma(`user_version = ${migration.version}`)
    })
    try {
      apply()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`Datenbank-Migration ${migration.version} („${migration.name}“) fehlgeschlagen: ${message}`)
    }
    applied.push(migration.version)
  }
  return applied
}

/** Öffnet die App-Datenbank und registriert sie für `getDb()`. */
export function initDatabase(path: string): Db {
  if (current) current.close()
  current = openDatabase(path)
  return current
}

/** Die geöffnete App-Datenbank. Wirft, wenn noch keine geöffnet ist. */
export function getDb(): Db {
  if (!current) throw new Error('Die Datenbank ist nicht geöffnet.')
  return current
}

/** Setzt die Singleton-Datenbank (Tests) – `null` entfernt sie, ohne sie zu schließen. */
export function setDb(db: Db | null): void {
  current = db
}

/** Schließt die App-Datenbank genau einmal (weitere Aufrufe sind wirkungslos). */
export function closeDatabase(): void {
  const db = current
  if (!db) return
  current = null
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    // ignorieren
  }
  try {
    if (db.open) db.close()
  } catch (err) {
    console.error('[db] Schließen fehlgeschlagen:', err)
  }
}

/** Aktueller Zeitpunkt als ISO 8601 (UTC) – Konvention für `created_at`/`updated_at`. */
export function nowIso(): string {
  return new Date().toISOString()
}
