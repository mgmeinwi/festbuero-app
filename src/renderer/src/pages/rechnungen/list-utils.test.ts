import { describe, expect, it } from 'vitest'
import type { InvoiceListItem } from '@shared/types'
import {
  belegeLabel,
  belegenLabel,
  describeRange,
  EMPTY_FILTERS,
  filterInvoices,
  hasActiveFilters,
  nextSort,
  sortInvoices,
  statusKey,
  summarize
} from './list-utils'

function item(partial: Partial<InvoiceListItem> & Pick<InvoiceListItem, 'id' | 'number'>): InvoiceListItem {
  return {
    type: 'rechnung',
    status: 'abgeschlossen',
    invoiceDate: '2025-06-01',
    dueDate: '2025-06-08',
    customerLabel: 'Musterverein e.V.',
    customerKind: 'verein',
    clubId: 1,
    persons: 10,
    paymentKind: 'bar',
    paymentLabel: 'Bar',
    totalGrossCents: 10000,
    printed: true,
    printedAt: null,
    pdfPath: null,
    originalNumber: null,
    stornoNumber: null,
    createdAt: '2025-06-01T10:00:00.000Z',
    ...partial
  }
}

const ITEMS: InvoiceListItem[] = [
  item({ id: 1, number: '2025-009', customerLabel: 'Sportfreunde Beispielstadt', totalGrossCents: 32000 }),
  item({
    id: 2,
    number: '2025-010',
    status: 'storniert',
    stornoNumber: '2025-012',
    paymentKind: 'ueberweisung',
    paymentLabel: 'Überweisung',
    totalGrossCents: 16700
  }),
  item({ id: 3, number: '2025-011', customerLabel: 'Einzelrechnung', customerKind: 'einzel', persons: null, invoiceDate: '2025-06-02', totalGrossCents: 1300, printed: false }),
  item({
    id: 4,
    number: '2025-012',
    type: 'storno',
    originalNumber: '2025-010',
    paymentKind: 'ueberweisung',
    paymentLabel: 'Überweisung',
    invoiceDate: '2025-06-02',
    totalGrossCents: -16700
  }),
  item({ id: 5, number: '2025-100', customerLabel: 'Trachtenverein Mühlbach', invoiceDate: '2025-06-03', totalGrossCents: 5000 })
]

describe('Rechnungsliste: Filter, Suche, Sortierung', () => {
  it('Status-Schlüssel', () => {
    expect(ITEMS.map(statusKey)).toEqual(['abgeschlossen', 'storniert', 'abgeschlossen', 'storno', 'abgeschlossen'])
  })

  it('sucht über Nummer und Kunde (mehrere Begriffe, ohne Akzente)', () => {
    const ids = (search: string) => filterInvoices(ITEMS, { ...EMPTY_FILTERS, search }).map((i) => i.id)
    expect(ids('011')).toEqual([3])
    expect(ids('sport')).toEqual([1])
    expect(ids('muhlbach')).toEqual([5])
    expect(ids('MUSTER 010')).toEqual([2])
    expect(ids('  ')).toEqual([1, 2, 3, 4, 5])
  })

  it('filtert nach Zeitraum (inklusive), Zahlart und Status', () => {
    const ids = (f: Partial<typeof EMPTY_FILTERS>) => filterInvoices(ITEMS, { ...EMPTY_FILTERS, ...f }).map((i) => i.id)
    expect(ids({ from: '2025-06-02', to: '2025-06-02' })).toEqual([3, 4])
    expect(ids({ from: '2025-06-02' })).toEqual([3, 4, 5])
    expect(ids({ to: '2025-06-01' })).toEqual([1, 2])
    expect(ids({ payment: 'ueberweisung' })).toEqual([2, 4])
    expect(ids({ status: 'storno' })).toEqual([4])
    expect(ids({ status: 'storniert' })).toEqual([2])
    expect(ids({ status: 'abgeschlossen', payment: 'bar' })).toEqual([1, 3, 5])
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false)
    expect(hasActiveFilters({ ...EMPTY_FILTERS, status: 'storno' })).toBe(true)
  })

  it('sortiert numerisch nach Nummer, Betrag, Kunde und Status', () => {
    const numbers = (key: Parameters<typeof nextSort>[1], dir: 'asc' | 'desc') =>
      sortInvoices(ITEMS, { key, dir }).map((i) => i.number)
    expect(numbers('number', 'desc')).toEqual(['2025-100', '2025-012', '2025-011', '2025-010', '2025-009'])
    expect(numbers('amount', 'asc')[0]).toBe('2025-012')
    expect(numbers('customer', 'asc')[0]).toBe('2025-011') // „Einzelrechnung“
    expect(numbers('status', 'desc')[0]).toBe('2025-012')
    expect(numbers('persons', 'asc')[0]).toBe('2025-011') // ohne Personen zuerst
  })

  it('Spaltenkopf schaltet die Richtung um', () => {
    expect(nextSort({ key: 'number', dir: 'desc' }, 'number')).toEqual({ key: 'number', dir: 'asc' })
    expect(nextSort({ key: 'number', dir: 'desc' }, 'customer')).toEqual({ key: 'customer', dir: 'asc' })
    expect(nextSort({ key: 'customer', dir: 'asc' }, 'amount')).toEqual({ key: 'amount', dir: 'desc' })
  })

  it('Summe mit gegengerechnetem Storno', () => {
    expect(summarize(ITEMS)).toEqual({ count: 5, totalCents: 32000 + 16700 + 1300 - 16700 + 5000 })
    expect(belegeLabel(1)).toBe('1 Beleg')
    expect(belegeLabel(3)).toBe('3 Belege')
    expect(belegenLabel(1)).toBe('1 Beleg')
    expect(belegenLabel(3)).toBe('3 Belegen')
  })

  it('beschreibt den Zeitraum', () => {
    expect(describeRange('', '', '2025-06-02')).toBe('Alle Tage')
    expect(describeRange('2025-06-02', '2025-06-02', '2025-06-02')).toBe('Heute')
    expect(describeRange('2025-06-01', '2025-06-01', '2025-06-02')).toBe('01.06.2025')
    expect(describeRange('2025-06-01', '2025-06-03', '2025-06-02')).toBe('01.06.–03.06.2025')
    expect(describeRange('2025-06-01', '', '2025-06-02')).toBe('ab 01.06.2025')
    expect(describeRange('', '2025-06-03', '2025-06-02')).toBe('bis 03.06.2025')
  })
})
