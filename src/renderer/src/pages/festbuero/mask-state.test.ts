import { describe, expect, it } from 'vitest'
import type { Club, Product } from '@shared/types'
import {
  clearSavedDraft,
  initialMaskState,
  isDirty,
  maskReducer,
  personsOf,
  saveDraft,
  takeSavedDraft,
  type MaskState
} from './mask-state'

const products: Product[] = [
  {
    id: 1,
    festivalId: 1,
    name: 'Festzeichen',
    priceCents: 300,
    vatRate: 19,
    mode: 'pro_person',
    defaultQuantity: 0,
    sortOrder: 1,
    active: true,
    usedInInvoices: false
  },
  {
    id: 2,
    festivalId: 1,
    name: 'Festschrift',
    priceCents: 1500,
    vatRate: 7,
    mode: 'feste_anzahl',
    defaultQuantity: 1,
    sortOrder: 2,
    active: true,
    usedInInvoices: false
  }
]

const club: Club = {
  id: 9,
  festivalId: 1,
  contactName: 'Erika Beispiel',
  clubName: 'Musterverein e.V.',
  street: 'Musterweg 3',
  zip: '01234',
  city: 'Musterstadt',
  registeredPersons: 45,
  source: 'manual',
  hasInvoice: false
}

function run(state: MaskState, ...actions: Parameters<typeof maskReducer>[1][]): MaskState {
  return actions.reduce(maskReducer, state)
}

describe('maskReducer', () => {
  it('Verein wählen: Personen = angemeldete Zahl, Positionen vorbelegt', () => {
    const s = run(initialMaskState(products), { type: 'selectClub', club })
    expect(s.personsInput).toBe('45')
    expect(personsOf(s)).toBe(45)
    expect(s.lines.map((l) => l.quantity)).toEqual([45, 1])
  })

  it('Personenänderung nur bei Vereinen; Eingabe wird bereinigt', () => {
    const s = run(initialMaskState(products), { type: 'selectClub', club }, { type: 'setPersons', input: '5a0' })
    expect(s.personsInput).toBe('50')
    expect(s.lines[0]!.quantity).toBe(50)
    const einzel = run(initialMaskState(products), { type: 'selectEinzel' }, { type: 'setPersons', input: '12' })
    expect(einzel.personsInput).toBe('')
    expect(personsOf(einzel)).toBeNull()
  })

  it('Einzelrechnung: Anschrift nur für Einzelkunden änderbar', () => {
    const s = run(
      initialMaskState(products),
      { type: 'selectEinzel' },
      { type: 'setEinzelAddress', address: { contactName: 'Max ' } }
    )
    expect(s.customer).toMatchObject({ kind: 'einzel', contactName: 'Max ', clubName: '' })
    const v = run(
      initialMaskState(products),
      { type: 'selectClub', club },
      { type: 'setEinzelAddress', address: { contactName: 'X' } }
    )
    expect(v.customer?.contactName).toBe('Erika Beispiel')
  })

  it('applyInvoice: Leistungsdatum nur übernehmen, wenn es vom Festdatum abweicht', () => {
    const draft = {
      customer: {
        kind: 'verein' as const,
        clubId: 9,
        contactName: '',
        clubName: 'X',
        street: '',
        zip: '',
        city: '',
        registeredPersons: 45
      },
      persons: 40,
      paymentKind: 'ueberweisung' as const,
      serviceDate: '2025-06-01',
      lines: []
    }
    const same = maskReducer(initialMaskState(), {
      type: 'applyInvoice',
      draft,
      correction: { id: 1, number: '2025-001' },
      festivalDate: '2025-06-01'
    })
    expect(same.serviceDate).toBeNull()
    expect(same.invoiceDate).toBeNull()
    expect(same.personsInput).toBe('40')
    expect(same.correction).toEqual({ id: 1, number: '2025-001' })
    const other = maskReducer(initialMaskState(), {
      type: 'applyInvoice',
      draft: { ...draft, serviceDate: '2025-05-31' },
      correction: null,
      festivalDate: '2025-06-01'
    })
    expect(other.serviceDate).toBe('2025-05-31')
  })

  it('isDirty und Entwurf merken', () => {
    clearSavedDraft()
    const empty = initialMaskState(products)
    expect(isDirty(empty)).toBe(false)
    saveDraft(1, empty)
    expect(takeSavedDraft(1)).toBeNull()

    const filled = run(empty, { type: 'selectClub', club })
    expect(isDirty(filled)).toBe(true)
    saveDraft(1, filled)
    expect(takeSavedDraft(2)).toBeNull()
    expect(takeSavedDraft(1)).toBe(filled)
    clearSavedDraft()
    expect(takeSavedDraft(1)).toBeNull()
  })

  it('reset setzt alles zurück', () => {
    const s = run(
      initialMaskState(products),
      { type: 'selectClub', club },
      { type: 'setPayment', kind: 'ueberweisung' },
      { type: 'setDates', invoiceDate: '2025-06-02' },
      { type: 'reset', products }
    )
    expect(s).toEqual(initialMaskState(products))
  })
})
