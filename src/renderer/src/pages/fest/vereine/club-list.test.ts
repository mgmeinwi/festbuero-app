import { describe, expect, it } from 'vitest'
import type { Club, ClubImportPreview } from '@shared/types'
import {
  clubNameKey,
  clubStats,
  filterClubs,
  fileNameOf,
  formatPlace,
  importNeedsConfirmation,
  importResultMessage,
  parsePersonsInput,
  plural,
  sortClubs,
  toggleSort
} from './club-list'

let nextId = 1
function club(partial: Partial<Club>): Club {
  return {
    id: nextId++,
    festivalId: 1,
    contactName: '',
    clubName: 'Verein',
    street: '',
    zip: '',
    city: '',
    registeredPersons: 0,
    source: 'import',
    hasInvoice: false,
    ...partial
  }
}

const CLUBS = [
  club({ clubName: 'TSV Beispielstadt', contactName: 'Bernd Platzhalter', zip: '23456', city: 'Beispielstadt', registeredPersons: 38 }),
  club({ clubName: 'FF Musterdorf', contactName: 'Anna Beispiel', zip: '01067', city: 'Musterdorf', registeredPersons: 45, hasInvoice: true }),
  club({ clubName: 'Schützenverein Testingen e.V.', contactName: '', zip: '', city: 'Testingen', registeredPersons: 22, source: 'manual' }),
  club({ clubName: 'Ölmühle Fiktivried', contactName: 'Clara Muster', street: 'Mühlweg 2', zip: '45678', city: 'Fiktivried', registeredPersons: 5 })
]

describe('Suche', () => {
  it('findet über Verein, Name, Ort, PLZ und Straße', () => {
    expect(filterClubs(CLUBS, 'musterdorf').map((c) => c.clubName)).toEqual(['FF Musterdorf'])
    expect(filterClubs(CLUBS, 'Platzhalter').map((c) => c.clubName)).toEqual(['TSV Beispielstadt'])
    expect(filterClubs(CLUBS, '0106').map((c) => c.clubName)).toEqual(['FF Musterdorf'])
    expect(filterClubs(CLUBS, 'mühlweg').map((c) => c.clubName)).toEqual(['Ölmühle Fiktivried'])
    expect(filterClubs(CLUBS, '').length).toBe(4)
    expect(filterClubs(CLUBS, '   ').length).toBe(4)
  })

  it('ignoriert Groß-/Kleinschreibung, Umlaute und Satzzeichen; alle Begriffe müssen passen', () => {
    expect(filterClubs(CLUBS, 'SCHUETZENVEREIN').length).toBe(1)
    expect(filterClubs(CLUBS, 'e.v.').map((c) => c.clubName)).toEqual(['Schützenverein Testingen e.V.'])
    expect(filterClubs(CLUBS, 'oelmuehle').length).toBe(1)
    expect(filterClubs(CLUBS, 'beispiel anna').map((c) => c.clubName)).toEqual(['FF Musterdorf'])
    expect(filterClubs(CLUBS, 'beispiel xyz')).toEqual([])
  })
})

describe('Sortierung', () => {
  it('nach Verein (deutsche Sortierung) und Personen', () => {
    expect(sortClubs(CLUBS, { key: 'clubName', dir: 'asc' }).map((c) => c.clubName)).toEqual([
      'FF Musterdorf',
      'Ölmühle Fiktivried',
      'Schützenverein Testingen e.V.',
      'TSV Beispielstadt'
    ])
    expect(sortClubs(CLUBS, { key: 'registeredPersons', dir: 'desc' }).map((c) => c.registeredPersons)).toEqual([
      45, 38, 22, 5
    ])
  })

  it('leere Ansprechpartner und Orte stehen in beiden Richtungen am Ende', () => {
    const asc = sortClubs(CLUBS, { key: 'contactName', dir: 'asc' }).map((c) => c.contactName)
    const desc = sortClubs(CLUBS, { key: 'contactName', dir: 'desc' }).map((c) => c.contactName)
    expect(asc).toEqual(['Anna Beispiel', 'Bernd Platzhalter', 'Clara Muster', ''])
    expect(desc).toEqual(['Clara Muster', 'Bernd Platzhalter', 'Anna Beispiel', ''])
    expect(sortClubs(CLUBS, { key: 'place', dir: 'asc' }).map(formatPlace)).toEqual([
      '01067 Musterdorf',
      '23456 Beispielstadt',
      '45678 Fiktivried',
      'Testingen'
    ])
  })

  it('Status: Rechnung zuerst', () => {
    expect(sortClubs(CLUBS, { key: 'status', dir: 'asc' })[0]!.clubName).toBe('FF Musterdorf')
  })

  it('toggleSort wechselt die Richtung', () => {
    expect(toggleSort({ key: 'clubName', dir: 'asc' }, 'clubName')).toEqual({ key: 'clubName', dir: 'desc' })
    expect(toggleSort({ key: 'clubName', dir: 'desc' }, 'place')).toEqual({ key: 'place', dir: 'asc' })
    expect(toggleSort({ key: 'clubName', dir: 'asc' }, 'registeredPersons')).toEqual({
      key: 'registeredPersons',
      dir: 'desc'
    })
  })
})

describe('Hilfen', () => {
  it('Kennzahlen', () => {
    expect(clubStats(CLUBS)).toEqual({ count: 4, persons: 110, imported: 3, manual: 1, withInvoice: 1 })
  })

  it('Texte und Eingaben', () => {
    expect(plural(1, 'Verein', 'Vereine')).toBe('1 Verein')
    expect(plural(1200, 'Verein', 'Vereine')).toBe('1.200 Vereine')
    expect(parsePersonsInput('')).toBe(0)
    expect(parsePersonsInput(' 12 ')).toBe(12)
    expect(parsePersonsInput('ca. 12')).toBeNull()
    expect(parsePersonsInput('-1')).toBeNull()
    expect(parsePersonsInput('1,5')).toBeNull()
    expect(fileNameOf('/Users/x/Anmeldung.xlsx')).toBe('Anmeldung.xlsx')
    expect(fileNameOf('C:\\Daten\\Liste.xlsx')).toBe('Liste.xlsx')
    expect(clubNameKey('TSV Beispielstadt e. V.')).toBe(clubNameKey('tsv beispielstadt e.V.'))
  })

  it('Import: Bestätigung nur, wenn Vereine ersetzt werden', () => {
    const base: ClubImportPreview = {
      filePath: '/x.xlsx',
      sheetName: 'Tabelle1',
      totalRows: 2,
      validRows: 2,
      rows: [],
      missingColumns: [],
      existingImportedCount: 0,
      replacedManualClubs: []
    }
    expect(importNeedsConfirmation(base)).toBe(false)
    expect(importNeedsConfirmation({ ...base, existingImportedCount: 3 })).toBe(true)
    expect(importNeedsConfirmation({ ...base, replacedManualClubs: ['FF Musterdorf'] })).toBe(true)
  })

  it('Import: Ergebnismeldung', () => {
    expect(importResultMessage({ imported: 15, skipped: 0, removedImported: 0, removedManual: 0 })).toEqual({
      title: '15 Vereine importiert'
    })
    expect(importResultMessage({ imported: 1, skipped: 2, removedImported: 14, removedManual: 1 })).toEqual({
      title: '1 Verein importiert',
      description: '15 bisherige Vereine ersetzt · 2 fehlerhafte Zeilen übersprungen'
    })
  })
})
