import { describe, expect, it } from 'vitest'
import type { Club } from '@shared/types'
import { createClubSearcher } from './club-search'

let id = 1
function club(clubName: string, contactName: string, zip: string, city: string): Club {
  return {
    id: id++,
    festivalId: 1,
    clubName,
    contactName,
    street: 'Musterweg 1',
    zip,
    city,
    registeredPersons: 10,
    source: 'manual',
    hasInvoice: false
  }
}

const clubs = [
  club('Trachtenverein Beispielhausen', 'Erika Beispiel', '01234', 'Beispielhausen'),
  club('Musterverein e.V.', 'Max Mustermann', '12345', 'Musterstadt'),
  club('Schützengesellschaft Talheim', 'Hans Probe', '54321', 'Talheim'),
  club('Feuerwehr Bergdorf', 'Anna Test', '98765', 'Bergdorf')
]

describe('Vereinssuche', () => {
  const searcher = createClubSearcher(clubs)

  it('ohne Suchbegriff: alle Vereine alphabetisch', () => {
    expect(searcher.search('  ').map((c) => c.clubName)).toEqual([
      'Feuerwehr Bergdorf',
      'Musterverein e.V.',
      'Schützengesellschaft Talheim',
      'Trachtenverein Beispielhausen'
    ])
  })

  it('findet über Verein, Ansprechpartner, Ort und PLZ', () => {
    expect(searcher.search('muster')[0]!.clubName).toBe('Musterverein e.V.')
    expect(searcher.search('Hans Probe')[0]!.clubName).toBe('Schützengesellschaft Talheim')
    expect(searcher.search('Bergdorf')[0]!.clubName).toBe('Feuerwehr Bergdorf')
    expect(searcher.search('543')[0]!.clubName).toBe('Schützengesellschaft Talheim')
  })

  it('ist fehlertolerant (Tippfehler, Umlaute)', () => {
    expect(searcher.search('Musterferein')[0]!.clubName).toBe('Musterverein e.V.')
    expect(searcher.search('Schuetzen')[0]!.clubName).toBe('Schützengesellschaft Talheim')
    expect(searcher.search('schutzen')[0]!.clubName).toBe('Schützengesellschaft Talheim')
    expect(searcher.search('Feuerwer')[0]!.clubName).toBe('Feuerwehr Bergdorf')
  })

  it('liefert nichts bei völlig fremden Begriffen', () => {
    expect(searcher.search('xyzqwv')).toEqual([])
  })
})
