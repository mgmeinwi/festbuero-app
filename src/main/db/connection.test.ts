import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getSchemaVersion, openDatabase, runMigrations, type Db } from './connection'
import { migrations } from './migrations'

const NOW = '2025-06-01T10:00:00.000Z'

function insertFestival(db: Db, name = 'Testfest'): number {
  const r = db
    .prepare(
      `INSERT INTO festival (name, festival_date, number_prefix, number_start, number_next, number_digits, created_at, updated_at)
       VALUES (?, '2025-06-01', '2025-', 1, 1, 3, ?, ?)`
    )
    .run(name, NOW, NOW)
  return Number(r.lastInsertRowid)
}

interface InvoiceOverrides {
  number?: string
  seq?: number
  type?: 'rechnung' | 'storno'
  status?: 'abgeschlossen' | 'storniert'
  originalInvoiceId?: number | null
}

function insertInvoice(db: Db, festivalId: number, o: InvoiceOverrides = {}): number {
  const totals = JSON.stringify({ grossCents: 1000, netCents: 1000, vatCents: 0, byRate: [] })
  const r = db
    .prepare(
      `INSERT INTO invoice (
         festival_id, number, seq, type, status, original_invoice_id, storno_reason,
         customer_kind, club_id, customer_json, persons, payment_kind, payment_label, payment_text,
         due_days, invoice_date, service_date, due_date,
         total_gross_cents, total_net_cents, total_vat_cents, totals_json,
         tax_exempt, tax_exempt_text, festival_name, template_json, logo_file, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'einzel', NULL, '{}', NULL, 'bar', 'Bar', '<p>bar</p>',
         7, '2025-06-01', '2025-06-01', '2025-06-08',
         1000, 1000, 0, ?, 1, '§ 19', 'Testfest', '{}', NULL, ?)`
    )
    .run(
      festivalId,
      o.number ?? '2025-001',
      o.seq ?? 1,
      o.type ?? 'rechnung',
      o.status ?? 'abgeschlossen',
      o.originalInvoiceId ?? null,
      o.type === 'storno' ? 'Test' : null,
      totals,
      NOW
    )
  const id = Number(r.lastInsertRowid)
  db.prepare(
    `INSERT INTO invoice_line (invoice_id, position, product_id, name, price_cents, vat_rate, quantity, line_total_cents)
     VALUES (?, 1, NULL, 'Festschrift', 1000, 7, 1, 1000)`
  ).run(id)
  return id
}

describe('openDatabase / runMigrations', () => {
  it('migriert eine In-Memory-Datenbank auf die neueste Version', () => {
    const db = openDatabase(':memory:')
    expect(getSchemaVersion(db)).toBe(Math.max(...migrations.map((m) => m.version)))
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name)
    expect(tables).toEqual(
      expect.arrayContaining(['app_settings', 'festival', 'product', 'club', 'template', 'payment_method', 'invoice', 'invoice_line'])
    )
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000)
    db.close()
  })

  it('ist idempotent', () => {
    const db = openDatabase(':memory:')
    expect(runMigrations(db)).toEqual([])
    db.close()
  })

  it('führt neue Migrationen inkrementell aus', () => {
    const db = openDatabase(':memory:', { migrate: false })
    expect(runMigrations(db, [migrations[0]!])).toEqual([1])
    const extra = { version: 2, name: 'test', sql: 'CREATE TABLE test_extra (id INTEGER PRIMARY KEY);' }
    expect(runMigrations(db, [migrations[0]!, extra])).toEqual([2])
    expect(getSchemaVersion(db)).toBe(2)
    db.close()
  })

  it('rollt eine fehlerhafte Migration vollständig zurück', () => {
    const db = openDatabase(':memory:', { migrate: false })
    runMigrations(db, [migrations[0]!])
    const broken = { version: 2, name: 'kaputt', sql: 'CREATE TABLE half_done (id INTEGER); SELECT * FROM gibt_es_nicht;' }
    expect(() => runMigrations(db, [migrations[0]!, broken])).toThrow(/Migration 2/)
    expect(getSchemaVersion(db)).toBe(1)
    const half = db.prepare("SELECT name FROM sqlite_master WHERE name = 'half_done'").get()
    expect(half).toBeUndefined()
    db.close()
  })

  it('verweigert Datenbanken einer neueren Programmversion', () => {
    const db = openDatabase(':memory:', { migrate: false })
    db.pragma('user_version = 999')
    expect(() => runMigrations(db)).toThrow(/neueren Programmversion/)
    db.close()
  })
})

describe('Schutz abgeschlossener Rechnungen (Trigger)', () => {
  let db: Db
  let festivalId: number

  beforeEach(() => {
    db = openDatabase(':memory:')
    festivalId = insertFestival(db)
  })
  afterEach(() => db.close())

  it('verhindert das Löschen von Rechnungen und Positionen', () => {
    const id = insertInvoice(db, festivalId)
    expect(() => db.prepare('DELETE FROM invoice WHERE id = ?').run(id)).toThrow(/nicht gelöscht/)
    expect(() => db.prepare('DELETE FROM invoice_line WHERE invoice_id = ?').run(id)).toThrow(/nicht gelöscht/)
  })

  it('verhindert Änderungen an Inhalt und Positionen', () => {
    const id = insertInvoice(db, festivalId)
    expect(() => db.prepare('UPDATE invoice SET total_gross_cents = 1 WHERE id = ?').run(id)).toThrow(/unveränderlich/)
    expect(() => db.prepare("UPDATE invoice SET customer_json = '{\"x\":1}' WHERE id = ?").run(id)).toThrow(
      /unveränderlich/
    )
    expect(() => db.prepare("UPDATE invoice SET number = '2025-999' WHERE id = ?").run(id)).toThrow(/unveränderlich/)
    expect(() => db.prepare('UPDATE invoice_line SET quantity = 5 WHERE invoice_id = ?').run(id)).toThrow(
      /nicht geändert/
    )
  })

  it('erlaubt abgeschlossen → storniert, aber nicht zurück', () => {
    const id = insertInvoice(db, festivalId)
    db.prepare("UPDATE invoice SET status = 'storniert' WHERE id = ?").run(id)
    expect((db.prepare('SELECT status FROM invoice WHERE id = ?').get(id) as { status: string }).status).toBe(
      'storniert'
    )
    expect(() => db.prepare("UPDATE invoice SET status = 'abgeschlossen' WHERE id = ?").run(id)).toThrow(
      /unveränderlich/
    )
  })

  it('erlaubt Ablage- und Druckstatus', () => {
    const id = insertInvoice(db, festivalId)
    db.prepare(
      `UPDATE invoice SET pdf_path = '/tmp/x.pdf', pdf_created_at = ?, printed = 1, printed_at = ?, print_error = 'Papier leer'
       WHERE id = ?`
    ).run(NOW, NOW, id)
    const row = db.prepare('SELECT pdf_path, printed, print_error FROM invoice WHERE id = ?').get(id) as {
      pdf_path: string
      printed: number
      print_error: string
    }
    expect(row).toEqual({ pdf_path: '/tmp/x.pdf', printed: 1, print_error: 'Papier leer' })
  })

  it('Startnummer ist nach der ersten Rechnung gesperrt', () => {
    db.prepare('UPDATE festival SET number_start = 50, number_next = 50 WHERE id = ?').run(festivalId)
    insertInvoice(db, festivalId)
    expect(() => db.prepare('UPDATE festival SET number_start = 60 WHERE id = ?').run(festivalId)).toThrow(
      /Startnummer/
    )
    // andere Felder bleiben änderbar
    db.prepare("UPDATE festival SET name = 'Neu', number_next = 51 WHERE id = ?").run(festivalId)
  })

  it('Rechnungsnummer ist über alle Feste eindeutig', () => {
    const other = insertFestival(db, 'Anderes Fest')
    insertInvoice(db, festivalId, { number: '2025-001' })
    expect(() => insertInvoice(db, other, { number: '2025-001' })).toThrow(/UNIQUE/)
  })

  it('eine Rechnung kann nur einmal storniert werden', () => {
    const original = insertInvoice(db, festivalId, { number: '2025-001', seq: 1 })
    insertInvoice(db, festivalId, { number: '2025-002', seq: 2, type: 'storno', originalInvoiceId: original })
    expect(() =>
      insertInvoice(db, festivalId, { number: '2025-003', seq: 3, type: 'storno', originalInvoiceId: original })
    ).toThrow(/UNIQUE/)
  })

  it('Storno braucht eine Originalrechnung, Rechnung darf keine haben', () => {
    expect(() => insertInvoice(db, festivalId, { type: 'storno', originalInvoiceId: null })).toThrow(/CHECK/)
  })

  it('Feste mit Rechnungen können nicht gelöscht werden', () => {
    insertInvoice(db, festivalId)
    expect(() => db.prepare('DELETE FROM festival WHERE id = ?').run(festivalId)).toThrow(/archivieren/)
    const empty = insertFestival(db, 'Leer')
    db.prepare('DELETE FROM festival WHERE id = ?').run(empty)
  })
})
