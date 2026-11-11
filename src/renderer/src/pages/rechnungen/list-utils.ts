/**
 * Reine Hilfsfunktionen der Rechnungsliste: Suche, Filter, Sortierung, Summen.
 * Ohne React/DOM, damit sie per Vitest testbar sind.
 */
import { formatDate } from '@shared/dates'
import type { InvoiceListItem, PaymentKind } from '@shared/types'

export type StatusKey = 'abgeschlossen' | 'storniert' | 'storno'
export type StatusFilter = 'all' | StatusKey
export type PaymentFilter = 'all' | PaymentKind

export interface ListFilters {
  search: string
  /** ISO-Datum oder '' */
  from: string
  /** ISO-Datum oder '' */
  to: string
  payment: PaymentFilter
  status: StatusFilter
}

export const EMPTY_FILTERS: ListFilters = { search: '', from: '', to: '', payment: 'all', status: 'all' }

export const STATUS_LABELS: Record<StatusKey, string> = {
  abgeschlossen: 'abgeschlossen',
  storniert: 'storniert',
  storno: 'Storno'
}

/** Status-Schlüssel eines Belegs: Stornobeleg → 'storno', sonst Status der Rechnung. */
export function statusKey(item: Pick<InvoiceListItem, 'type' | 'status'>): StatusKey {
  if (item.type === 'storno') return 'storno'
  return item.status === 'storniert' ? 'storniert' : 'abgeschlossen'
}

/** Suchtext normalisieren: Kleinschreibung, ohne Akzente (ä bleibt über NFD → a). */
export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('de')
    .replace(/\s+/g, ' ')
    .trim()
}

export function hasActiveFilters(filters: ListFilters): boolean {
  return (
    filters.search.trim() !== '' ||
    filters.from !== '' ||
    filters.to !== '' ||
    filters.payment !== 'all' ||
    filters.status !== 'all'
  )
}

export function matchesFilters(item: InvoiceListItem, filters: ListFilters): boolean {
  if (filters.payment !== 'all' && item.paymentKind !== filters.payment) return false
  if (filters.status !== 'all' && statusKey(item) !== filters.status) return false
  if (filters.from && item.invoiceDate < filters.from) return false
  if (filters.to && item.invoiceDate > filters.to) return false
  const terms = normalizeSearch(filters.search).split(' ').filter(Boolean)
  if (terms.length > 0) {
    const haystack = normalizeSearch(`${item.number} ${item.customerLabel}`)
    if (!terms.every((t) => haystack.includes(t))) return false
  }
  return true
}

export function filterInvoices(items: InvoiceListItem[], filters: ListFilters): InvoiceListItem[] {
  return items.filter((item) => matchesFilters(item, filters))
}

export type SortKey = 'number' | 'date' | 'customer' | 'persons' | 'payment' | 'amount' | 'status' | 'printed'
export type SortDir = 'asc' | 'desc'
export interface SortState {
  key: SortKey
  dir: SortDir
}

export const DEFAULT_SORT: SortState = { key: 'number', dir: 'desc' }

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' })
const STATUS_ORDER: Record<StatusKey, number> = { abgeschlossen: 0, storniert: 1, storno: 2 }

function compareBy(key: SortKey, a: InvoiceListItem, b: InvoiceListItem): number {
  switch (key) {
    case 'number':
      return collator.compare(a.number, b.number)
    case 'date':
      return a.invoiceDate < b.invoiceDate ? -1 : a.invoiceDate > b.invoiceDate ? 1 : 0
    case 'customer':
      return collator.compare(a.customerLabel, b.customerLabel)
    case 'persons':
      return (a.persons ?? -1) - (b.persons ?? -1)
    case 'payment':
      return collator.compare(a.paymentLabel, b.paymentLabel)
    case 'amount':
      return a.totalGrossCents - b.totalGrossCents
    case 'status':
      return STATUS_ORDER[statusKey(a)] - STATUS_ORDER[statusKey(b)]
    case 'printed':
      return Number(a.printed) - Number(b.printed)
  }
}

/** Sortiert stabil; bei Gleichstand nach Nummer (in derselben Richtung). */
export function sortInvoices(items: InvoiceListItem[], sort: SortState): InvoiceListItem[] {
  const factor = sort.dir === 'asc' ? 1 : -1
  return [...items].sort((a, b) => {
    const primary = compareBy(sort.key, a, b)
    if (primary !== 0) return primary * factor
    return (collator.compare(a.number, b.number) || a.id - b.id) * factor
  })
}

/** Nächster Sortierzustand beim Klick auf einen Spaltenkopf. */
export function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  // Zahlen/Beträge/Datum zuerst absteigend, Texte aufsteigend
  const descFirst: SortKey[] = ['number', 'date', 'persons', 'amount', 'printed']
  return { key, dir: descFirst.includes(key) ? 'desc' : 'asc' }
}

export interface ListSummary {
  count: number
  totalCents: number
}

export function summarize(items: InvoiceListItem[]): ListSummary {
  return { count: items.length, totalCents: items.reduce((sum, i) => sum + i.totalGrossCents, 0) }
}

/** Beschriftung des Zeitraum-Filters, z. B. „Alle Tage“, „Heute“, „01.06.–02.06.2025“. */
export function describeRange(from: string, to: string, today: string): string {
  if (!from && !to) return 'Alle Tage'
  if (from && to && from === to) return from === today ? 'Heute' : formatDate(from, 'DE')
  if (from && to) {
    const sameYear = from.slice(0, 4) === to.slice(0, 4)
    return `${formatDate(from, sameYear ? 'dd.MM.' : 'DE')}–${formatDate(to, 'DE')}`
  }
  if (from) return `ab ${formatDate(from, 'DE')}`
  return `bis ${formatDate(to, 'DE')}`
}

/** „1 Beleg“ / „3 Belege“ */
export function belegeLabel(count: number): string {
  return `${count} ${count === 1 ? 'Beleg' : 'Belege'}`
}

/** Dativ nach „mit“: „1 Beleg“ / „3 Belegen“ */
export function belegenLabel(count: number): string {
  return `${count} ${count === 1 ? 'Beleg' : 'Belegen'}`
}
