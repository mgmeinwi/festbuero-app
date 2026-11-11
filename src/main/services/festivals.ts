/**
 * Fachlogik Gründungsfeste: list, get, create, update (inkl. Archivieren/Wiederherstellen), copy.
 * Zuständig: Bereich „Fest-Einstellungen“.
 */
import { isValidIsoDate } from '@shared/dates'
import { DEFAULT_FILENAME_PATTERN, validateFilenamePattern } from '@shared/filename'
import { getDefaultTemplateConfig } from '@shared/invoice-render/default-template'
import { MAX_NUMBER_DIGITS, MIN_NUMBER_DIGITS } from '@shared/numbering'
import type { Festival, FestivalCopyInput, FestivalCreateInput, FestivalUpdateInput, PaymentKind } from '@shared/types'
import { getDb, type Db } from '../db/connection'
import * as repo from '../db/repositories/festivals'
import * as paymentRepo from '../db/repositories/payment-methods'
import * as productRepo from '../db/repositories/products'

export const DEFAULT_TAX_EXEMPT_TEXT = 'Als Kleinunternehmer im Sinne von § 19 UStG wird keine Umsatzsteuer berechnet.'
export const DEFAULT_COPIES = 2
export const DEFAULT_DUE_DAYS = 7

/** Standard-Zahlungsarten (Spezifikation „Zahlungsarten“); Texte sind Rich-Text (HTML). */
export const DEFAULT_PAYMENT_METHODS: ReadonlyArray<{
  kind: PaymentKind
  label: string
  text: string
  dueDays: number
  isDefault: boolean
}> = [
  {
    kind: 'bar',
    label: 'Bar',
    text: '<p>Betrag bar erhalten ____________________</p>',
    dueDays: DEFAULT_DUE_DAYS,
    isDefault: true
  },
  {
    kind: 'ueberweisung',
    label: 'Überweisung',
    text:
      '<p>Bitte überweisen Sie den Betrag von {Gesamtbetrag} bis zum {Fälligkeitsdatum} unter Angabe der ' +
      'Rechnungsnummer {Rechnungsnummer} auf das unten genannte Konto.</p>',
    dueDays: DEFAULT_DUE_DAYS,
    isDefault: false
  }
]

type FestivalFields = FestivalUpdateInput

/** Prüft die angegebenen Felder und liefert eine deutsche Fehlermeldung (oder wirft). */
export function validateFestivalFields(fields: FestivalFields): void {
  if (fields.name !== undefined) {
    if (typeof fields.name !== 'string' || fields.name.trim() === '') {
      throw new Error('Bitte einen Namen für das Gründungsfest angeben.')
    }
    if (fields.name.trim().length > 120) throw new Error('Der Name des Fests ist zu lang (höchstens 120 Zeichen).')
  }
  if (fields.festivalDate !== undefined && !isValidIsoDate(fields.festivalDate)) {
    throw new Error('Bitte ein gültiges Festdatum angeben.')
  }
  if (fields.numberPrefix !== undefined) {
    if (typeof fields.numberPrefix !== 'string') throw new Error('Ungültiges Präfix.')
    if (fields.numberPrefix.length > 20) throw new Error('Das Präfix ist zu lang (höchstens 20 Zeichen).')
  }
  if (fields.numberStart !== undefined) {
    if (!Number.isSafeInteger(fields.numberStart) || fields.numberStart < 0) {
      throw new Error('Die Startnummer muss eine ganze Zahl ab 0 sein.')
    }
  }
  if (fields.numberDigits !== undefined) {
    if (
      !Number.isInteger(fields.numberDigits) ||
      fields.numberDigits < MIN_NUMBER_DIGITS ||
      fields.numberDigits > MAX_NUMBER_DIGITS
    ) {
      throw new Error(`Die Stellenzahl muss zwischen ${MIN_NUMBER_DIGITS} und ${MAX_NUMBER_DIGITS} liegen.`)
    }
  }
  if (fields.copies !== undefined) {
    if (!Number.isInteger(fields.copies) || fields.copies < 1 || fields.copies > 20) {
      throw new Error('Die Kopienzahl muss zwischen 1 und 20 liegen.')
    }
  }
  if (fields.taxExempt !== undefined && typeof fields.taxExempt !== 'boolean') {
    throw new Error('Ungültiger Wert für die Steuerbefreiung.')
  }
  if (fields.taxExemptText !== undefined) {
    if (typeof fields.taxExemptText !== 'string') throw new Error('Ungültiger Hinweistext zur Steuerbefreiung.')
    if (fields.taxExemptText.length > 1000) {
      throw new Error('Der Hinweistext zur Steuerbefreiung ist zu lang (höchstens 1000 Zeichen).')
    }
  }
  if (fields.filenamePattern !== undefined) {
    const check = validateFilenamePattern(fields.filenamePattern)
    if (!check.valid) throw new Error(check.error)
  }
  if (fields.archived !== undefined && typeof fields.archived !== 'boolean') {
    throw new Error('Ungültiger Wert für „archiviert“.')
  }
}

export function listFestivals(opts: { includeArchived?: boolean } = {}, db: Db = getDb()): Festival[] {
  return repo.listFestivals(db, opts)
}

export function getFestival(id: number, db: Db = getDb()): Festival {
  const festival = Number.isInteger(id) ? repo.findFestival(db, id) : null
  if (!festival) throw new Error('Das Gründungsfest wurde nicht gefunden.')
  return festival
}

/** Legt ein Fest an – in EINER Transaktion mit beiden Standard-Zahlungsarten und der Standard-Vorlage. */
export function createFestival(input: FestivalCreateInput, db: Db = getDb()): Festival {
  if (!input || typeof input !== 'object') throw new Error('Ungültige Angaben zum Gründungsfest.')
  const values: repo.FestivalInsertValues = {
    name: (input.name ?? '').trim(),
    festivalDate: input.festivalDate,
    numberPrefix: input.numberPrefix ?? '',
    numberStart: input.numberStart,
    numberDigits: input.numberDigits,
    copies: input.copies ?? DEFAULT_COPIES,
    taxExempt: input.taxExempt ?? true,
    taxExemptText: input.taxExemptText ?? DEFAULT_TAX_EXEMPT_TEXT,
    filenamePattern: (input.filenamePattern ?? DEFAULT_FILENAME_PATTERN).trim()
  }
  validateFestivalFields(values)

  const id = db.transaction(() => {
    const festivalId = repo.insertFestival(db, values)
    for (const pm of DEFAULT_PAYMENT_METHODS) paymentRepo.insertPaymentMethodRow(db, festivalId, pm)
    repo.insertTemplateRow(db, festivalId, getDefaultTemplateConfig(), null)
    return festivalId
  })()
  return getFestival(id, db)
}

/** Meldung, wenn die Startnummer nach dem ersten Beleg geändert werden soll. */
export const NUMBER_START_LOCKED_MESSAGE =
  'Die Startnummer kann nicht mehr geändert werden, weil für dieses Fest bereits Rechnungen abgeschlossen wurden.'

/**
 * Ändert Einstellungen eines Fests (auch `archived` zum Archivieren/Wiederherstellen).
 * - Startnummer nur ohne Belege änderbar; ändert sie sich, wird die nächste Nummer mitgezogen.
 * - Bei Steuerbefreiung ist ein Hinweistext Pflicht.
 */
export function updateFestival(id: number, patch: FestivalUpdateInput, db: Db = getDb()): Festival {
  if (!patch || typeof patch !== 'object') throw new Error('Ungültige Änderungen am Gründungsfest.')
  const existing = getFestival(id, db)
  const clean: FestivalUpdateInput = { ...patch }
  if (typeof clean.name === 'string') clean.name = clean.name.trim()
  if (typeof clean.filenamePattern === 'string') clean.filenamePattern = clean.filenamePattern.trim()
  if (typeof clean.taxExemptText === 'string') clean.taxExemptText = clean.taxExemptText.trim()
  validateFestivalFields(clean)

  const taxExempt = clean.taxExempt ?? existing.taxExempt
  const taxExemptText = clean.taxExemptText ?? existing.taxExemptText
  if (taxExempt && taxExemptText.trim() === '') {
    throw new Error('Bitte einen Hinweistext zur Steuerbefreiung angeben (z. B. den Hinweis nach § 19 UStG).')
  }

  const extra: Record<string, number> = {}
  if (clean.numberStart !== undefined && clean.numberStart !== existing.numberStart) {
    if (existing.hasInvoices) throw new Error(NUMBER_START_LOCKED_MESSAGE)
    // Ohne Belege beginnt die Vergabe wieder bei der (neuen) Startnummer.
    extra.number_next = clean.numberStart
  }
  try {
    db.transaction(() => repo.updateFestivalRow(db, id, clean, extra))()
  } catch (err) {
    // Rückfall: Trigger trg_festival_number_start_locked (z. B. Beleg zwischenzeitlich entstanden)
    if (err instanceof Error && /Startnummer/.test(err.message)) throw new Error(NUMBER_START_LOCKED_MESSAGE)
    throw err
  }
  return getFestival(id, db)
}

/**
 * Kopiert ein Fest in EINER Transaktion: neues Fest mit Name, Datum, Präfix und Startnummer aus
 * `input` (nächste Nummer = Startnummer). Übernommen werden Stellenzahl, Kopien, Steuerbefreiung
 * samt Text, Dateinamensmuster, alle Produkte (inkl. inaktiver, Reihenfolge und Aktiv-Status), die
 * Vorlage (inkl. Logo-Datei) und die Zahlungsarten. Vereine und Rechnungen werden nicht kopiert.
 */
export function copyFestival(sourceId: number, input: FestivalCopyInput, db: Db = getDb()): Festival {
  if (!input || typeof input !== 'object') throw new Error('Ungültige Angaben für die Kopie des Gründungsfests.')
  const source = getFestival(sourceId, db)
  const values: repo.FestivalInsertValues = {
    name: (input.name ?? '').trim(),
    festivalDate: input.festivalDate,
    numberPrefix: input.numberPrefix ?? '',
    numberStart: input.numberStart,
    numberDigits: source.numberDigits,
    copies: source.copies,
    taxExempt: source.taxExempt,
    taxExemptText: source.taxExemptText,
    filenamePattern: source.filenamePattern
  }
  validateFestivalFields(values)

  const id = db.transaction(() => {
    const festivalId = repo.insertFestival(db, values)
    productRepo.copyProducts(db, source.id, festivalId)
    const copiedPayments = paymentRepo.copyPaymentMethods(db, source.id, festivalId)
    if (copiedPayments === 0) {
      for (const pm of DEFAULT_PAYMENT_METHODS) paymentRepo.insertPaymentMethodRow(db, festivalId, pm)
    }
    if (!repo.copyTemplateRow(db, source.id, festivalId)) {
      repo.insertTemplateRow(db, festivalId, getDefaultTemplateConfig(), null)
    }
    return festivalId
  })()
  return getFestival(id, db)
}
