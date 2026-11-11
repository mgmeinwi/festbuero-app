/**
 * Fehlertolerante Vereinssuche (Fuse.js) über Verein, Ansprechpartner, Ort und PLZ.
 * Ohne Suchbegriff: alle Vereine alphabetisch. PLZ-Präfixe („012“) und exakte Teiltreffer werden
 * vor unscharfen Treffern einsortiert.
 */
import Fuse, { type IFuseOptions } from 'fuse.js'
import type { Club } from '@shared/types'

const FUSE_OPTIONS: IFuseOptions<Club> = {
  keys: [
    { name: 'clubName', weight: 3 },
    { name: 'contactName', weight: 1.5 },
    { name: 'city', weight: 1 },
    { name: 'zip', weight: 1 }
  ],
  threshold: 0.38,
  ignoreLocation: true,
  ignoreDiacritics: true,
  includeScore: true,
  minMatchCharLength: 1
}

const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true })

export function compareClubs(a: Club, b: Club): number {
  return collator.compare(a.clubName, b.clubName) || collator.compare(a.contactName, b.contactName) || a.id - b.id
}

function normalize(text: string): string {
  return text.toLocaleLowerCase('de').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').trim()
}

/** Vorbereiteter Suchindex; bei geänderter Vereinsliste neu erzeugen. */
export interface ClubSearcher {
  search(query: string): Club[]
}

export function createClubSearcher(clubs: ReadonlyArray<Club>): ClubSearcher {
  const sorted = [...clubs].sort(compareClubs)
  const fuse = new Fuse(sorted, FUSE_OPTIONS)
  return {
    search(query: string): Club[] {
      const q = query.trim()
      if (q === '') return sorted
      const nq = normalize(q)
      const results = fuse.search(q)
      // Exakte Teiltreffer (z. B. PLZ-Anfang, Wortanfang im Vereinsnamen) nach vorn
      const rank = (club: Club, score: number): number => {
        const name = normalize(club.clubName)
        if (club.zip.startsWith(q) || name.startsWith(nq)) return -2 + score
        if (name.includes(nq) || normalize(club.contactName).includes(nq) || normalize(club.city).startsWith(nq)) {
          return -1 + score
        }
        return score
      }
      return results
        .map((r) => ({ club: r.item, rank: rank(r.item, r.score ?? 1) }))
        .sort((a, b) => a.rank - b.rank || compareClubs(a.club, b.club))
        .map((r) => r.club)
    }
  }
}
