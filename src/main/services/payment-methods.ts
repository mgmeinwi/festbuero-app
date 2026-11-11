/**
 * Fachlogik Zahlungsarten: list, update. Pro Fest gibt es genau eine Standard-Zahlart.
 * Zuständig: Bereich „Fest-Einstellungen“.
 */
import type { PaymentMethod, PaymentMethodUpdateInput } from '@shared/types'
import { getDb, type Db } from '../db/connection'
import * as repo from '../db/repositories/payment-methods'
import { getFestival } from './festivals'

export const MAX_DUE_DAYS = 365
export const MAX_PAYMENT_LABEL_LENGTH = 40
export const MAX_PAYMENT_TEXT_LENGTH = 20_000

/** Prüft die angegebenen Felder und wirft bei Fehlern eine deutsche Meldung. */
export function validatePaymentMethodFields(fields: PaymentMethodUpdateInput): void {
  if (fields.label !== undefined) {
    if (typeof fields.label !== 'string' || fields.label.trim() === '') {
      throw new Error('Bitte einen Anzeigenamen für die Zahlungsart angeben.')
    }
    if (fields.label.trim().length > MAX_PAYMENT_LABEL_LENGTH) {
      throw new Error(`Der Anzeigename ist zu lang (höchstens ${MAX_PAYMENT_LABEL_LENGTH} Zeichen).`)
    }
  }
  if (fields.text !== undefined) {
    if (typeof fields.text !== 'string') throw new Error('Ungültiger Zahlungstext.')
    if (fields.text.length > MAX_PAYMENT_TEXT_LENGTH) throw new Error('Der Zahlungstext ist zu lang.')
  }
  if (fields.dueDays !== undefined) {
    if (!Number.isInteger(fields.dueDays) || fields.dueDays < 0) {
      throw new Error('Die Zahlungsfrist muss eine ganze Zahl ab 0 Tagen sein.')
    }
    if (fields.dueDays > MAX_DUE_DAYS) throw new Error(`Die Zahlungsfrist darf höchstens ${MAX_DUE_DAYS} Tage betragen.`)
  }
  if (fields.isDefault !== undefined && typeof fields.isDefault !== 'boolean') {
    throw new Error('Ungültiger Wert für „Standard“.')
  }
}

export function listPaymentMethods(festivalId: number, db: Db = getDb()): PaymentMethod[] {
  getFestival(festivalId, db)
  return repo.listPaymentMethods(db, festivalId)
}

export function getPaymentMethod(id: number, db: Db = getDb()): PaymentMethod {
  const method = Number.isInteger(id) ? repo.findPaymentMethod(db, id) : null
  if (!method) throw new Error('Die Zahlungsart wurde nicht gefunden.')
  return method
}

/**
 * Ändert Anzeigename, Text, Frist und Standard. Wird eine Zahlart Standard, verliert die bisherige
 * Standard-Zahlart diesen Status in derselben Transaktion. Wird die Standard-Zahlart abgewählt,
 * übernimmt eine andere Zahlart des Fests (es gibt immer genau eine).
 */
export function updatePaymentMethod(id: number, patch: PaymentMethodUpdateInput, db: Db = getDb()): PaymentMethod {
  if (!patch || typeof patch !== 'object') throw new Error('Ungültige Änderungen an der Zahlungsart.')
  const existing = getPaymentMethod(id, db)
  const clean: repo.PaymentMethodUpdateValues = {
    label: typeof patch.label === 'string' ? patch.label.trim() : patch.label,
    text: patch.text,
    dueDays: patch.dueDays,
    isDefault: patch.isDefault
  }
  validatePaymentMethodFields(clean)

  db.transaction(() => {
    if (clean.isDefault === true) {
      repo.clearDefaultPaymentMethods(db, existing.festivalId, id)
    } else if (clean.isDefault === false && existing.isDefault) {
      const other = repo.listPaymentMethods(db, existing.festivalId).find((m) => m.id !== id)
      if (!other) throw new Error('Es muss immer eine Standard-Zahlungsart geben.')
      repo.updatePaymentMethodRow(db, other.id, { isDefault: true })
    }
    repo.updatePaymentMethodRow(db, id, clean)
  })()
  return getPaymentMethod(id, db)
}
