import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ClubInput } from '@shared/types'
import { openDatabase, type Db } from '../db/connection'
import { clubNameKey, cleanText, createClub, deleteClub, getClub, listClubs, normalizeClubInput, updateClub } from './clubs'

function insertFestival(db: Db, name = 'Testfest 2025'): number {
  const now = new Date().toISOString()
  return Number(
    db
      .prepare('INSERT INTO festival (name, festival_date, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(name, '2025-06-01', now, now).lastInsertRowid
  )
}

const INPUT: ClubInput = {
  contactName: '  Anna Beispiel ',
  clubName: ' FF  Musterdorf ',
  street: 'Hauptstraße 1',
  zip: '01067',
  city: 'Musterdorf',
  registeredPersons: 45
}

describe('Hilfsfunktionen', () => {
  it('cleanText trimmt und fasst Leerraum zusammen', () => {
    expect(cleanText('  a   b\t\n c ')).toBe('a b c')
    expect(cleanText(null)).toBe('')
    expect(cleanText(12)).toBe('12')
  })

  it('clubNameKey ignoriert Schreibweise, Umlaute und Satzzeichen', () => {
    expect(clubNameKey('TSV Beispielstadt e. V.')).toBe(clubNameKey('tsv beispielstadt e.V.'))
    expect(clubNameKey('Schützenverein')).toBe(clubNameKey('Schuetzenverein'))
    expect(clubNameKey('Fußballclub')).toBe(clubNameKey('FUSSBALLCLUB'))
    expect(clubNameKey('FF Musterdorf')).not.toBe(clubNameKey('FF Musterhausen'))
  })

  it('normalizeClubInput prüft Pflichtfelder und Zahlen', () => {
    expect(normalizeClubInput(INPUT)).toEqual({
      contactName: 'Anna Beispiel',
      clubName: 'FF Musterdorf',
      street: 'Hauptstraße 1',
      zip: '01067',
      city: 'Musterdorf',
      registeredPersons: 45
    })
    expect(() => normalizeClubInput({ ...INPUT, clubName: '   ' })).toThrow('Bitte den Vereinsnamen angeben.')
    expect(() => normalizeClubInput({ ...INPUT, registeredPersons: -1 })).toThrow('ganze Zahl ab 0')
    expect(() => normalizeClubInput({ ...INPUT, registeredPersons: 2.5 })).toThrow('ganze Zahl ab 0')
    expect(() => normalizeClubInput({ ...INPUT, registeredPersons: Number.NaN })).toThrow('ganze Zahl ab 0')
    expect(() => normalizeClubInput({ ...INPUT, registeredPersons: 200_000 })).toThrow('höchstens')
    expect(() => normalizeClubInput({ ...INPUT, clubName: 'x'.repeat(201) })).toThrow('zu lang')
    expect(() => normalizeClubInput({ ...INPUT, zip: '1'.repeat(21) })).toThrow('Die PLZ ist zu lang')
    // PLZ als Zahl (nicht vertragsgemäß) wird trotzdem zu Text
    expect(normalizeClubInput({ ...INPUT, zip: 12345 as unknown as string }).zip).toBe('12345')
    expect(normalizeClubInput({ ...INPUT, registeredPersons: '12' as unknown as number }).registeredPersons).toBe(12)
    expect(normalizeClubInput({ registeredPersons: 3 }, true)).toEqual({ registeredPersons: 3 })
  })
})

describe('clubs service', () => {
  let db: Db
  let festivalId: number

  beforeEach(() => {
    db = openDatabase(':memory:')
    festivalId = insertFestival(db)
  })
  afterEach(() => db.close())

  function insertInvoice(
    clubId: number | null,
    opts: {
      number: string
      /** Vereinsname im Kunden-Snapshot (Standard: Name des Vereins mit `clubId`) */
      clubName?: string
      kind?: 'verein' | 'einzel'
      type?: 'rechnung' | 'storno'
      status?: 'abgeschlossen' | 'storniert'
      originalId?: number
      festivalId?: number
    }
  ): number {
    const clubName =
      opts.clubName ??
      ((clubId !== null && (db.prepare('SELECT club_name FROM club WHERE id = ?').get(clubId) as { club_name: string } | undefined)?.club_name) ||
        '')
    const kind = opts.kind ?? 'verein'
    const customer = JSON.stringify({ kind, clubId, clubName, contactName: '', street: '', zip: '', city: '', registeredPersons: null })
    const now = new Date().toISOString()
    return Number(
      db
        .prepare(
          `INSERT INTO invoice (festival_id, number, seq, type, status, original_invoice_id, customer_kind, club_id,
             customer_json, persons, payment_kind, payment_label, payment_text, due_days, invoice_date, service_date,
             due_date, total_gross_cents, total_net_cents, total_vat_cents, totals_json, tax_exempt, tax_exempt_text,
             festival_name, template_json, created_at)
           VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, 10, 'bar', 'Bar', '', 7, '2025-06-01', '2025-06-01',
             '2025-06-08', 1000, 1000, 0, '{}', 1, '', 'Testfest', '{}', ?)`
        )
        .run(
          opts.festivalId ?? festivalId,
          opts.number,
          opts.type ?? 'rechnung',
          opts.status ?? 'abgeschlossen',
          opts.originalId ?? null,
          kind,
          clubId,
          customer,
          now
        )
        .lastInsertRowid
    )
  }

  it('legt manuell an, liest, ändert und löscht', () => {
    const created = createClub(festivalId, INPUT, db)
    expect(created).toMatchObject({
      festivalId,
      clubName: 'FF Musterdorf',
      contactName: 'Anna Beispiel',
      zip: '01067',
      registeredPersons: 45,
      source: 'manual',
      hasInvoice: false
    })
    expect(getClub(created.id, db)).toEqual(created)

    const updated = updateClub(created.id, { registeredPersons: 50, city: ' Neustadt ' }, db)
    expect(updated).toMatchObject({ registeredPersons: 50, city: 'Neustadt', clubName: 'FF Musterdorf', source: 'manual' })
    expect(() => updateClub(created.id, { clubName: '' }, db)).toThrow('Vereinsnamen')

    deleteClub(created.id, db)
    expect(listClubs(festivalId, db)).toEqual([])
    expect(() => getClub(created.id, db)).toThrow('Der Verein wurde nicht gefunden.')
    expect(() => deleteClub(created.id, db)).toThrow('Der Verein wurde nicht gefunden.')
  })

  it('Bearbeiten behält die Quelle „import“', () => {
    const id = Number(
      db
        .prepare(
          `INSERT INTO club (festival_id, club_name, source, created_at, updated_at) VALUES (?, 'Importiert', 'import', 'x', 'x')`
        )
        .run(festivalId).lastInsertRowid
    )
    expect(updateClub(id, { registeredPersons: 3 }, db).source).toBe('import')
  })

  it('listet nur Vereine des Fests, alphabetisch', () => {
    const other = insertFestival(db, 'Anderes Fest')
    createClub(festivalId, { ...INPUT, clubName: 'TSV Beispielstadt' }, db)
    createClub(festivalId, { ...INPUT, clubName: 'ff musterdorf' }, db)
    createClub(other, { ...INPUT, clubName: 'Anderer Verein' }, db)
    expect(listClubs(festivalId, db).map((c) => c.clubName)).toEqual(['ff musterdorf', 'TSV Beispielstadt'])
    expect(() => listClubs(9999, db)).toThrow('Das Gründungsfest wurde nicht gefunden.')
    expect(() => createClub(9999, INPUT, db)).toThrow('Das Gründungsfest wurde nicht gefunden.')
  })

  it('hasInvoice: nur abgeschlossene Rechnungen vom Typ „rechnung“', () => {
    const a = createClub(festivalId, { ...INPUT, clubName: 'A' }, db)
    const b = createClub(festivalId, { ...INPUT, clubName: 'B' }, db)
    const c = createClub(festivalId, { ...INPUT, clubName: 'C' }, db)

    insertInvoice(a.id, { number: '2025-001' })
    // B: Rechnung storniert (+ Stornobeleg) → keine gültige Rechnung
    const original = insertInvoice(b.id, { number: '2025-002' })
    db.prepare("UPDATE invoice SET status = 'storniert' WHERE id = ?").run(original)
    insertInvoice(b.id, { number: '2025-003', type: 'storno', originalId: original })
    // Einzelrechnung ohne Verein
    insertInvoice(null, { number: '2025-004' })

    const byName = Object.fromEntries(listClubs(festivalId, db).map((club) => [club.clubName, club.hasInvoice]))
    expect(byName).toEqual({ A: true, B: false, C: false })
    expect(getClub(a.id, db).hasInvoice).toBe(true)
    expect(getClub(c.id, db).hasInvoice).toBe(false)
  })

  it('hasInvoice: ID zählt nur zusammen mit dem Namen, sonst Zuordnung über den Vereinsnamen', () => {
    const a = createClub(festivalId, { ...INPUT, clubName: 'TSV Beispielstadt e.V.' }, db)
    const b = createClub(festivalId, { ...INPUT, clubName: 'SV Andere' }, db)
    const other = insertFestival(db, 'Anderes Fest')
    const otherClub = createClub(other, { ...INPUT, clubName: 'TSV Beispielstadt e.V.' }, db)

    // Rechnung mit unbekannter (z. B. gelöschter) ID, Name anders geschrieben → über den Namen zugeordnet
    insertInvoice(99999, { number: '2025-001', clubName: 'tsv  beispielstadt e. V.' })
    // ID von B, aber anderer Name im Snapshot (ID neu vergeben) → nicht B
    insertInvoice(b.id, { number: '2025-002', clubName: 'Ganz anderer Verein' })
    // Einzelrechnung mit gleichem Namen zählt nicht
    insertInvoice(null, { number: '2025-003', clubName: 'SV Andere', kind: 'einzel' })

    expect(getClub(a.id, db).hasInvoice).toBe(true)
    expect(getClub(b.id, db).hasInvoice).toBe(false)
    // Rechnungen anderer Feste zählen nicht
    expect(getClub(otherClub.id, db).hasInvoice).toBe(false)
  })

  it('hasInvoice bei gleichnamigen Vereinen: ID entscheidet, sonst der erste nach Ansprechpartner', () => {
    const first = createClub(festivalId, { ...INPUT, clubName: 'FF Musterdorf', contactName: 'Anna' }, db)
    const second = createClub(festivalId, { ...INPUT, clubName: 'FF Musterdorf', contactName: 'Bernd' }, db)
    insertInvoice(second.id, { number: '2025-001' })
    expect(listClubs(festivalId, db).map((c) => [c.contactName, c.hasInvoice])).toEqual([
      ['Anna', false],
      ['Bernd', true]
    ])
    insertInvoice(null, { number: '2025-002', clubName: 'FF Musterdorf' })
    expect(getClub(first.id, db).hasInvoice).toBe(true)
  })

  it('hasInvoice: kaputter Kunden-Snapshot führt nicht zu einem Fehler', () => {
    const a = createClub(festivalId, INPUT, db)
    insertInvoice(a.id, { number: '2025-001' })
    db.exec('DROP TRIGGER trg_invoice_immutable')
    db.prepare("UPDATE invoice SET customer_json = 'kein json'").run()
    expect(getClub(a.id, db).hasInvoice).toBe(false)
  })

  it('Löschen ist auch mit Rechnung erlaubt, die Rechnung bleibt', () => {
    const a = createClub(festivalId, INPUT, db)
    insertInvoice(a.id, { number: '2025-001' })
    deleteClub(a.id, db)
    expect(listClubs(festivalId, db)).toEqual([])
    expect(db.prepare('SELECT COUNT(*) AS n FROM invoice WHERE club_id = ?').get(a.id)).toEqual({ n: 1 })
  })
})
