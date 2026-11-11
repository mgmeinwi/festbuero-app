/**
 * Dokumentenordner und Datensicherung.
 *
 * - `resolveDefaultDocumentsDir()` – Vorschlag für den Dokumentenordner (`<Dokumente>/Festbüro`).
 * - `ensureDocumentsDir()` – prüft einen gewählten Ordner und legt ihn bei Bedarf an.
 * - `createBackup()` – ZIP mit einer konsistenten Kopie der Datenbank (SQLite-Backup-API von
 *   better-sqlite3) und dem Ordner `logos/` nach
 *   `<Dokumentenordner>/Datensicherungen/Festbuero-Datensicherung-JJJJ-MM-TT_HH-mm.zip`.
 *   Vorhandene Dateien werden nie überschrieben.
 *
 * Bewusst ohne Electron-Importe: Pfade und Datenbank kommen als Parameter (IPC-Schicht: `ipc/app.ts`),
 * damit sich alles in Unit-Tests prüfen lässt.
 */
import {
  closeSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  type WriteStream
} from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { ZipArchive } from 'archiver'
import type { Db } from '../db/connection'

/** Name des Ordners für Rechnungs-PDFs unter „Dokumente“. */
export const DOCUMENTS_FOLDER_NAME = 'Festbüro'
/** Unterordner des Dokumentenordners für Datensicherungen. */
export const BACKUP_FOLDER_NAME = 'Datensicherungen'
/** Dateiname der Datenbank im ZIP (wie im App-Datenverzeichnis). */
export const BACKUP_DB_ENTRY = 'festbuero.sqlite'
export const BACKUP_LOGOS_ENTRY = 'logos'
export const BACKUP_README_ENTRY = 'LIESMICH.txt'

/* ------------------------------------------------------------------ */
/* Dokumentenordner                                                    */
/* ------------------------------------------------------------------ */

export interface DefaultDocumentsDirInput {
  /** `app.getPath('documents')` */
  documentsPath: string
  /** App-Datenverzeichnis (`app.getPath('userData')`) */
  userDataDir: string
  /**
   * true in Entwicklung/Tests (unpaketiert oder `FESTBUERO_USER_DATA` gesetzt): Der Vorschlag liegt dann
   * unter dem isolierten Datenverzeichnis, damit nie versehentlich in „~/Dokumente“ geschrieben wird.
   */
  isolated: boolean
}

/** Vorschlag für den Dokumentenordner: `<Dokumente>/Festbüro` (isoliert: `<userData>/Dokumente/Festbüro`). */
export function resolveDefaultDocumentsDir({ documentsPath, userDataDir, isolated }: DefaultDocumentsDirInput): string {
  const base = isolated ? join(userDataDir, 'Dokumente') : documentsPath
  return join(base, DOCUMENTS_FOLDER_NAME)
}

/**
 * Prüft einen Dokumentenordner und legt ihn (samt Elternordnern) bei Bedarf an.
 * Liefert den bereinigten absoluten Pfad. Fehler als verständliche deutsche Meldung.
 */
export function ensureDocumentsDir(dir: string): string {
  const trimmed = typeof dir === 'string' ? dir.trim() : ''
  if (!trimmed) throw new Error('Bitte einen Dokumentenordner wählen.')
  if (!isAbsolute(trimmed)) throw new Error(`Bitte einen vollständigen Ordnerpfad angeben: „${trimmed}“.`)
  const path = resolve(trimmed)
  if (existsSync(path)) {
    if (!statSync(path).isDirectory()) throw new Error(`„${path}“ ist kein Ordner.`)
    return path
  }
  try {
    mkdirSync(path, { recursive: true })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(`Der Dokumentenordner konnte nicht angelegt werden: ${path} (${reason})`)
  }
  return path
}

/* ------------------------------------------------------------------ */
/* Datensicherung                                                      */
/* ------------------------------------------------------------------ */

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** `Festbuero-Datensicherung-2025-06-01_14-05.zip` (lokale Zeit). */
export function backupFileName(now: Date = new Date()): string {
  const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
  const time = `${pad2(now.getHours())}-${pad2(now.getMinutes())}`
  return `Festbuero-Datensicherung-${date}_${time}.zip`
}

/**
 * Legt die Zieldatei exklusiv an (`wx`) – existiert sie schon, wird `-2`, `-3` … angehängt.
 * So wird nie eine vorhandene Sicherung überschrieben, auch nicht bei zwei Sicherungen pro Minute.
 */
function reserveTargetFile(dir: string, fileName: string): { path: string; fd: number } {
  const stem = fileName.replace(/\.zip$/i, '')
  for (let i = 1; i < 1000; i++) {
    const path = join(dir, i === 1 ? `${stem}.zip` : `${stem}-${i}.zip`)
    try {
      return { path, fd: openSync(path, 'wx') }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw err
    }
  }
  throw new Error('Für diese Minute existieren bereits zu viele Datensicherungen. Bitte kurz warten.')
}

function readmeText(opts: { createdAt: Date; appVersion: string; schemaVersion: number; logoCount: number }): string {
  return [
    'Festbüro – Datensicherung',
    '==========================',
    '',
    `Erstellt:        ${opts.createdAt.toLocaleString('de-DE')}`,
    `App-Version:     ${opts.appVersion}`,
    `Datenbank-Schema: ${opts.schemaVersion}`,
    `Logos:           ${opts.logoCount}`,
    '',
    'Inhalt',
    `- ${BACKUP_DB_ENTRY}: Datenbank (Feste, Produkte, Vereine, Vorlagen, Rechnungen)`,
    `- ${BACKUP_LOGOS_ENTRY}/: Logos der Rechnungsvorlagen`,
    '',
    'Die Rechnungs-PDFs liegen nicht in dieser Sicherung, sondern im Dokumentenordner.',
    '',
    'Wiederherstellen (von Hand)',
    '1. Festbüro beenden.',
    '2. Das App-Datenverzeichnis öffnen (Festbüro → Einstellungen → Info → Datenordner öffnen):',
    '   macOS:   ~/Library/Application Support/Festbüro',
    '   Windows: %APPDATA%\\Festbüro',
    '3. Vorhandene Dateien festbuero.sqlite, festbuero.sqlite-wal, festbuero.sqlite-shm und den Ordner',
    '   logos zur Sicherheit an einen anderen Ort verschieben.',
    `4. ${BACKUP_DB_ENTRY} und den Ordner ${BACKUP_LOGOS_ENTRY} aus dieser ZIP-Datei in das Datenverzeichnis kopieren.`,
    '5. Festbüro starten.',
    ''
  ].join('\n')
}

function countFiles(dir: string): number {
  try {
    return readdirSync(dir, { withFileTypes: true, recursive: true }).filter((e) => e.isFile()).length
  } catch {
    return 0
  }
}

export interface CreateBackupOptions {
  db: Db
  /** aus den App-Einstellungen; null → verständlicher Fehler */
  documentsDir: string | null
  /** `<userData>/logos` */
  logosDir: string
  appVersion?: string
  /** für Tests: Zeitpunkt (Dateiname) */
  now?: Date
}

/**
 * Erstellt eine Datensicherung (ZIP) und liefert ihren Pfad.
 * Die Datenbank wird über die SQLite-Backup-API kopiert (konsistent, auch bei WAL und laufender App).
 */
export async function createBackup(opts: CreateBackupOptions): Promise<{ path: string }> {
  if (!opts.documentsDir) {
    throw new Error(
      'Es ist noch kein Dokumentenordner gewählt. Bitte zuerst in den Einstellungen einen Dokumentenordner wählen – dort wird die Datensicherung abgelegt.'
    )
  }
  if (!existsSync(opts.documentsDir)) {
    throw new Error(
      `Der Dokumentenordner ist nicht erreichbar: ${opts.documentsDir}. Bitte prüfen (z. B. USB-Stick eingesteckt?) oder in den Einstellungen einen anderen Ordner wählen.`
    )
  }

  const now = opts.now ?? new Date()
  const backupDir = join(opts.documentsDir, BACKUP_FOLDER_NAME)
  try {
    mkdirSync(backupDir, { recursive: true })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(`Der Ordner für Datensicherungen konnte nicht angelegt werden: ${backupDir} (${reason})`)
  }

  const tmp = mkdtempSync(join(tmpdir(), 'festbuero-backup-'))
  const tmpDb = join(tmp, BACKUP_DB_ENTRY)
  let target: { path: string; fd: number } | null = null
  let output: WriteStream | null = null
  let finished = false
  try {
    try {
      await opts.db.backup(tmpDb)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      throw new Error(`Die Datenbank konnte nicht gesichert werden: ${reason}`)
    }
    const schemaVersion = Number(opts.db.pragma('user_version', { simple: true })) || 0
    const hasLogos = existsSync(opts.logosDir) && statSync(opts.logosDir).isDirectory()

    target = reserveTargetFile(backupDir, backupFileName(now))
    const stream = createWriteStream(target.path, { fd: target.fd })
    output = stream
    const archive = new ZipArchive({ zlib: { level: 9 } })
    const closed = new Promise<void>((resolvePromise, reject) => {
      stream.on('close', () => resolvePromise())
      stream.on('error', reject)
      archive.on('error', reject)
      archive.on('warning', reject)
    })
    archive.pipe(stream)
    archive.file(tmpDb, { name: BACKUP_DB_ENTRY })
    if (hasLogos) archive.directory(opts.logosDir, BACKUP_LOGOS_ENTRY)
    archive.append(
      readmeText({
        createdAt: now,
        appVersion: opts.appVersion ?? 'unbekannt',
        schemaVersion,
        logoCount: hasLogos ? countFiles(opts.logosDir) : 0
      }),
      { name: BACKUP_README_ENTRY }
    )
    try {
      await Promise.all([archive.finalize(), closed])
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      throw new Error(`Die Datensicherung konnte nicht geschrieben werden: ${reason}`)
    }
    finished = true
    return { path: target.path }
  } finally {
    if (target && !finished) {
      // unvollständige Datei entfernen (der Stream schließt seinen Dateideskriptor selbst)
      if (output) output.destroy()
      else {
        try {
          closeSync(target.fd)
        } catch {
          // ignorieren
        }
      }
      try {
        unlinkSync(target.path)
      } catch {
        // ignorieren
      }
    }
    rmSync(tmp, { recursive: true, force: true })
  }
}
