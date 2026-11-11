import type { Product, ProductMode } from '@shared/types'

export const MODE_LABELS: Record<ProductMode, string> = {
  pro_person: 'pro Person',
  feste_anzahl: 'feste Anzahl'
}

export const MODE_DESCRIPTIONS: Record<ProductMode, string> = {
  pro_person: 'Menge = Zahl der kommenden Personen, z. B. Festzeichen oder Festessen.',
  feste_anzahl: 'Menge = Standardanzahl, z. B. 1 Festschrift pro Verein.'
}

/** „pro Person“ bzw. „feste Anzahl (1)“ */
export function modeSummary(product: Pick<Product, 'mode' | 'defaultQuantity'>): string {
  return product.mode === 'feste_anzahl' ? `feste Anzahl (${product.defaultQuantity})` : MODE_LABELS.pro_person
}

/** Verschiebt ein Element innerhalb eines Arrays (unveränderlich). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item as T)
  return next
}
