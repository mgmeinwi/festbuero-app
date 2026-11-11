/**
 * Storno einer abgeschlossenen Rechnung.
 *
 * Zuständig: Bereich „Abschluss & Druck“.
 *
 * - Grund ist Pflicht. Nur Rechnungen (`type='rechnung'`) mit Status `abgeschlossen`, nur einmal
 *   (zusätzlich Unique-Index `idx_invoice_one_storno`).
 * - EINE Transaktion: neue Nummer aus derselben Reihe, Positionen mit negierter Menge (Einzelpreis gleich,
 *   Zeilensumme negativ), Summen über `calculateTotals` (exakte Negation), Kunde/Zahlart/Leistungsdatum
 *   vom Original, Rechnungsdatum heute, Personen positiv wie im Original (die Auswertung zieht
 *   Storno-Personen ab), Vorlage = aktuelle Vorlage des Fests. Original → `storniert`.
 * - Danach PDF unter `Stornos/` ablegen und drucken wie eine Rechnung.
 */
import { addDays, todayIso } from '@shared/dates'
import { formatInvoiceNumber } from '@shared/numbering'
import { calculateLineTotal, calculateTotals } from '@shared/tax'
import type { FinalizeResult } from '@shared/types'
import { getDb, type Db } from '../db/connection'
import * as repo from '../db/repositories/invoices'
import { fileAndPrint, isUniqueViolation, numberCollisionMessage, templateSnapshot } from './finalize'
import type { PrintDeps } from './printing'

const MAX_REASON_LENGTH = 500

export const STORNO_REASON_REQUIRED = 'Bitte einen Grund für das Storno angeben.'

function alreadyCancelledMessage(number: string, stornoNumber: string | null): string {
  return stornoNumber
    ? `Die Rechnung ${number} wurde bereits storniert (Stornobeleg ${stornoNumber}).`
    : `Die Rechnung ${number} wurde bereits storniert.`
}

function normalizeReason(reason: unknown): string {
  if (typeof reason !== 'string' || reason.trim() === '') throw new Error(STORNO_REASON_REQUIRED)
  const r = reason.trim()
  if (r.length > MAX_REASON_LENGTH) throw new Error(`Der Storno-Grund ist zu lang (höchstens ${MAX_REASON_LENGTH} Zeichen).`)
  return r
}

/**
 * Legt den Stornobeleg in EINER Transaktion an und markiert das Original als storniert.
 * Bei jedem Fehler wird nichts gespeichert. Liefert ID und Nummer des Stornobelegs.
 */
export function createStornoRecord(
  originalId: number,
  reason: string,
  db: Db = getDb(),
  now: Date = new Date()
): { id: number; number: string } {
  const stornoReason = normalizeReason(reason)
  let originalNumber = ''

  const tx = db.transaction(() => {
    const original = repo.findInvoice(db, originalId)
    if (!original) throw new Error('Die Rechnung wurde nicht gefunden.')
    originalNumber = original.number
    if (original.type !== 'rechnung') throw new Error('Ein Stornobeleg kann nicht storniert werden.')
    if (original.status !== 'abgeschlossen' || original.stornoInvoiceId !== null) {
      throw new Error(alreadyCancelledMessage(original.number, original.stornoNumber))
    }
    const festival = repo.readFestival(db, original.festivalId)
    if (!festival) throw new Error('Das Gründungsfest der Rechnung wurde nicht gefunden.')

    const seq = festival.numberNext
    const number = formatInvoiceNumber(festival.numberPrefix, seq, festival.numberDigits)
    if (repo.numberExists(db, number)) throw new Error(numberCollisionMessage(number))

    const lines = original.lines.map((l) => {
      const quantity = l.quantity === 0 ? 0 : -l.quantity
      return {
        productId: l.productId,
        name: l.name,
        priceCents: l.priceCents,
        vatRate: l.vatRate,
        quantity,
        lineTotalCents: calculateLineTotal(l.priceCents, quantity)
      }
    })
    const totals = calculateTotals(lines)
    const invoiceDate = todayIso(now)
    const { templateJson, logoFile } = templateSnapshot(db, festival.id)

    const id = repo.insertInvoice(db, {
      festivalId: original.festivalId,
      number,
      seq,
      type: 'storno',
      originalInvoiceId: original.id,
      stornoReason,
      customer: original.customer,
      persons: original.persons,
      paymentKind: original.paymentKind,
      paymentLabel: original.paymentLabel,
      paymentText: original.paymentText,
      dueDays: original.dueDays,
      invoiceDate,
      serviceDate: original.serviceDate,
      dueDate: addDays(invoiceDate, original.dueDays),
      totals,
      taxExempt: original.taxExempt,
      taxExemptText: original.taxExemptText,
      // gleicher Ablageordner wie das Original (Festname-Snapshot)
      festivalName: original.festivalName,
      templateJson,
      logoFile,
      createdAt: now.toISOString()
    })
    repo.insertLines(db, id, lines)
    repo.markStorniert(db, original.id)
    repo.setFestivalNumberNext(db, festival.id, seq + 1)
    return { id, number }
  })

  try {
    return tx.immediate()
  } catch (err) {
    if (isUniqueViolation(err, 'invoice.original_invoice_id')) {
      const stornoId = repo.findStornoIdFor(db, originalId)
      const storno = stornoId !== null ? repo.findInvoice(db, stornoId) : null
      throw new Error(alreadyCancelledMessage(originalNumber || '?', storno?.number ?? null))
    }
    if (isUniqueViolation(err, 'invoice.number')) {
      const original = repo.findInvoice(db, originalId)
      const festival = original ? repo.readFestival(db, original.festivalId) : null
      const number = festival ? formatInvoiceNumber(festival.numberPrefix, festival.numberNext, festival.numberDigits) : '?'
      throw new Error(numberCollisionMessage(number))
    }
    throw err
  }
}

/** `invoices.storno`: Stornobeleg anlegen, unter `Stornos/` ablegen und drucken. */
export async function stornoInvoice(
  id: number,
  reason: string,
  opts: { printer?: string } = {},
  db: Db = getDb(),
  deps: PrintDeps = {}
): Promise<FinalizeResult> {
  const { id: stornoId } = createStornoRecord(id, reason, db)
  return fileAndPrint(stornoId, opts, db, deps)
}
