import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '../db/connection'
import {
  BACKUP_DB_ENTRY,
  backupFileName,
  createBackup,
  ensureDocumentsDir,
  resolveDefaultDocumentsDir
} from './backup'
import { createFestival } from './festivals'

/** Minimaler ZIP-Leser (zentrales Verzeichnis, Methoden „stored“ und „deflate“) – nur für Tests. */
function readZip(file: string): Map<string, Buffer> {
  const buf = readFileSync(file)
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 0xffff - 22); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Kein ZIP-Verzeichnis gefunden')
  const count = buf.readUInt16LE(eocd + 10)
  let offset = buf.readUInt32LE(eocd + 16)
  const entries = new Map<string, Buffer>()
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error('Defektes ZIP-Verzeichnis')
    const method = buf.readUInt16LE(offset + 10)
    const compressedSize = buf.readUInt32LE(offset + 20)
    const nameLength = buf.readUInt16LE(offset + 28)
    const extraLength = buf.readUInt16LE(offset + 30)
    const commentLength = buf.readUInt16LE(offset + 32)
    const localOffset = buf.readUInt32LE(offset + 42)
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLength)
    const localNameLength = buf.readUInt16LE(localOffset + 26)
    const localExtraLength = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const raw = buf.subarray(dataStart, dataStart + compressedSize)
    if (!name.endsWith('/')) entries.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw))
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

describe('resolveDefaultDocumentsDir', () => {
  it('schlägt <Dokumente>/Festbüro vor', () => {
    expect(
      resolveDefaultDocumentsDir({ documentsPath: '/Users/test/Documents', userDataDir: '/data', isolated: false })
    ).toBe(join('/Users/test/Documents', 'Festbüro'))
  })

  it('bleibt in Entwicklung/Tests unter dem isolierten Datenverzeichnis', () => {
    expect(
      resolveDefaultDocumentsDir({ documentsPath: '/Users/test/Documents', userDataDir: '/tmp/e2e', isolated: true })
    ).toBe(join('/tmp/e2e', 'Dokumente', 'Festbüro'))
  })
})

describe('Datensicherung', () => {
  let root: string
  let db: Db
  let dbPath: string
  let logosDir: string
  let documentsDir: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'festbuero-backup-test-'))
    dbPath = join(root, 'userData', 'festbuero.sqlite')
    logosDir = join(root, 'userData', 'logos')
    documentsDir = join(root, 'Dokumente', 'Festbüro')
    mkdirSync(logosDir, { recursive: true })
    mkdirSync(documentsDir, { recursive: true })
    db = openDatabase(dbPath)
  })

  afterEach(() => {
    if (db.open) db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('ensureDocumentsDir legt den Ordner bei Bedarf an und prüft den Pfad', () => {
    const dir = join(root, 'neu', 'Festbüro')
    expect(existsSync(dir)).toBe(false)
    expect(ensureDocumentsDir(`  ${dir} `)).toBe(dir)
    expect(statSync(dir).isDirectory()).toBe(true)
    // vorhandener Ordner bleibt unverändert
    expect(ensureDocumentsDir(dir)).toBe(dir)
    expect(() => ensureDocumentsDir('relativ/pfad')).toThrow(/vollständigen Ordnerpfad/)
    expect(() => ensureDocumentsDir('')).toThrow(/Dokumentenordner/)
    const file = join(root, 'datei.txt')
    writeFileSync(file, 'x')
    expect(() => ensureDocumentsDir(file)).toThrow(/kein Ordner/)
  })

  it('Dateiname enthält Datum und Uhrzeit', () => {
    expect(backupFileName(new Date(2025, 5, 1, 9, 5))).toBe('Festbuero-Datensicherung-2025-06-01_09-05.zip')
  })

  it('ZIP enthält eine lesbare, konsistente Datenbank und die Logos', async () => {
    createFestival(
      { name: 'Sicherungsfest', festivalDate: '2025-06-01', numberPrefix: 'S-', numberStart: 1, numberDigits: 3 },
      db
    )
    const logo = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>')
    writeFileSync(join(logosDir, 'abc123.svg'), logo)

    const now = new Date(2025, 5, 1, 14, 5)
    const { path } = await createBackup({ db, documentsDir, logosDir, appVersion: '1.2.3', now })
    expect(path).toBe(join(documentsDir, 'Datensicherungen', 'Festbuero-Datensicherung-2025-06-01_14-05.zip'))
    expect(existsSync(path)).toBe(true)

    const entries = readZip(path)
    expect([...entries.keys()].sort()).toEqual(['LIESMICH.txt', BACKUP_DB_ENTRY, 'logos/abc123.svg'])
    expect(entries.get('logos/abc123.svg')!.equals(logo)).toBe(true)
    expect(entries.get('LIESMICH.txt')!.toString('utf8')).toContain('Wiederherstellen')

    // Datenbank aus dem ZIP öffnen und prüfen
    const restored = join(root, 'restored.sqlite')
    writeFileSync(restored, entries.get(BACKUP_DB_ENTRY)!)
    const check = new Database(restored, { readonly: true })
    try {
      expect(check.pragma('integrity_check', { simple: true })).toBe('ok')
      expect(check.pragma('user_version', { simple: true })).toBe(db.pragma('user_version', { simple: true }))
      const rows = check.prepare('SELECT name, number_prefix FROM festival').all()
      expect(rows).toEqual([{ name: 'Sicherungsfest', number_prefix: 'S-' }])
      expect((check.prepare('SELECT COUNT(*) AS n FROM payment_method').get() as { n: number }).n).toBe(2)
    } finally {
      check.close()
    }
  })

  it('überschreibt nie eine vorhandene Sicherung', async () => {
    const now = new Date(2025, 5, 1, 14, 5)
    const first = await createBackup({ db, documentsDir, logosDir, now })
    const firstContent = readFileSync(first.path)
    const second = await createBackup({ db, documentsDir, logosDir, now })
    const third = await createBackup({ db, documentsDir, logosDir, now })
    expect(basename(second.path)).toBe('Festbuero-Datensicherung-2025-06-01_14-05-2.zip')
    expect(basename(third.path)).toBe('Festbuero-Datensicherung-2025-06-01_14-05-3.zip')
    expect(readFileSync(first.path).equals(firstContent)).toBe(true)
  })

  it('funktioniert auch ohne Logo-Ordner', async () => {
    rmSync(logosDir, { recursive: true, force: true })
    const { path } = await createBackup({ db, documentsDir, logosDir })
    expect([...readZip(path).keys()].sort()).toEqual(['LIESMICH.txt', BACKUP_DB_ENTRY])
  })

  it('ohne Dokumentenordner verständlicher Fehler', async () => {
    await expect(createBackup({ db, documentsDir: null, logosDir })).rejects.toThrow(/kein Dokumentenordner gewählt/)
    await expect(createBackup({ db, documentsDir: join(root, 'fehlt'), logosDir })).rejects.toThrow(
      /nicht erreichbar/
    )
  })
})
