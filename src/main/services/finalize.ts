/**
 * Abschluss einer Rechnung (architecture.md §7):
 * 1. Entwurf validieren, Summen NEU berechnen (Werte aus dem Renderer werden nie übernommen).
 * 2. EINE Transaktion (BEGIN IMMEDIATE): Nummer vergeben, Zähler erhöhen, Rechnung + Positionen mit
 *    allen Kopien speichern. Kollision mit einer existierenden Nummer → nichts gespeichert.
 * 3. PDF erzeugen und ablegen (Fehler → Rechnung bleibt gültig, `pdf_path` leer, wird nachgeholt).
 * 4. Gespeichertes PDF drucken (Fehler → Rechnung bleibt gültig, `print_error`).
 * 5. Status setzen, `FinalizeResult` zurückgeben.
 *
 * Zuständig: Bereich „Abschluss & Druck“.
 */
import { addDays, isValidIsoDate } from '@shared/dates'
import { getDefaultTemplateConfig } from '@shared/invoice-render/default-template'
import { formatInvoiceNumber } from '@shared/numbering'
import { calculateLineTotal, calculateTotals } from '@shared/tax'
import type {
  CustomerSnapshot,
  FinalizeResult,
  Invoice,
  InvoiceDraft,
  InvoiceListItem,
  InvoiceTotals,
  PaymentKind,
  TemplateConfig,
  VatRate
} from '@shared/types'
import { getDb, type Db } from '../db/connection'
import * as repo from '../db/repositories/invoices'
import { ensureInvoicePdf, requireDocumentsDir } from './filing'
import { printInvoice, type PrintDeps } from './printing'
import { getSettings } from './settings'

const MAX_TEXT_LENGTH = 300
const MAX_LINES = 500

export function numberCollisionMessage(number: string): string {
  return `Die Rechnungsnummer ${number} existiert bereits (anderes Fest?). Bitte Präfix oder Startnummer prüfen.`
}

export const ZERO_TOTAL_MESSAGE = 'Eine Rechnung mit Endbetrag 0 € kann nicht abgeschlossen werden.'

/* ------------------------------------------------------------------ */
/* Hilfen                                                              */
/* ------------------------------------------------------------------ */

function text(value: unknown, field: string): string {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`Ungültige Angabe: ${field}.`)
  const s = String(value).trim()
  if (s.length > MAX_TEXT_LENGTH) throw new Error(`${field} ist zu lang (höchstens ${MAX_TEXT_LENGTH} Zeichen).`)
  return s
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Prüft auf UNIQUE-Verletzung einer bestimmten Spalte (better-sqlite3-Fehler). */
export function isUniqueViolation(err: unknown, column: string): boolean {
  if (!(err instanceof Error)) return false
  const code = (err as Error & { code?: unknown }).code
  return (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT') && err.message.includes(column)
}

/** Aktuelle Vorlage des Fests als Snapshot (JSON-Text) – fehlt sie, gilt die Standardvorlage. */
export function templateSnapshot(db: Db, festivalId: number): { templateJson: string; logoFile: string | null } {
  const tpl = repo.readTemplate(db, festivalId)
  if (!tpl) return { templateJson: JSON.stringify(getDefaultTemplateConfig()), logoFile: null }
  let config: TemplateConfig
  try {
    config = JSON.parse(tpl.configJson) as TemplateConfig
  } catch {
    throw new Error('Die Rechnungsvorlage des Fests ist beschädigt. Bitte im Vorlagen-Editor prüfen oder zurücksetzen.')
  }
  return { templateJson: JSON.stringify(config), logoFile: tpl.logoFile }
}

/* ------------------------------------------------------------------ */
/* Validierung                                                         */
/* ------------------------------------------------------------------ */

export interface ValidatedDraft {
  festival: repo.FestivalForInvoice
  customer: CustomerSnapshot
  persons: number | null
  payment: repo.PaymentMethodForInvoice
  invoiceDate: string
  serviceDate: string
  dueDate: string
  lines: repo.InvoiceLineInsertValues[]
  totals: InvoiceTotals
}

function validateCustomer(raw: unknown): CustomerSnapshot {
  if (!raw || typeof raw !== 'object') throw new Error('Bitte einen Kunden wählen (Verein oder Einzelrechnung).')
  const c = raw as Partial<Record<keyof CustomerSnapshot, unknown>>
  if (c.kind !== 'verein' && c.kind !== 'einzel') throw new Error('Ungültige Kundenart.')
  const clubId = c.clubId === null || c.clubId === undefined ? null : c.clubId
  if (clubId !== null && !(typeof clubId === 'number' && Number.isSafeInteger(clubId) && clubId > 0)) {
    throw new Error('Ungültiger Verweis auf den Verein.')
  }
  const registered = c.registeredPersons === null || c.registeredPersons === undefined ? null : c.registeredPersons
  if (registered !== null && !isNonNegativeInt(registered)) throw new Error('Ungültige Zahl angemeldeter Personen.')
  const customer: CustomerSnapshot = {
    kind: c.kind,
    clubId: c.kind === 'verein' ? (clubId as number | null) : null,
    contactName: text(c.contactName, 'Name'),
    clubName: text(c.clubName, 'Verein'),
    street: text(c.street, 'Straße'),
    zip: text(c.zip, 'PLZ'),
    city: text(c.city, 'Ort'),
    registeredPersons: c.kind === 'verein' ? (registered as number | null) : null
  }
  if (customer.kind === 'verein' && customer.clubName === '') throw new Error('Bitte einen Verein auswählen.')
  return customer
}

/**
 * Prüft einen Entwurf gegen die aktuellen Stammdaten und rechnet Zeilensummen und Summen neu.
 * Muss innerhalb der Abschluss-Transaktion laufen (liest Fest und Zahlungsart).
 */
export function validateDraft(draft: InvoiceDraft, db: Db): ValidatedDraft {
  if (!draft || typeof draft !== 'object') throw new Error('Ungültiger Rechnungsentwurf.')
  const festival = Number.isSafeInteger(draft.festivalId) ? repo.readFestival(db, draft.festivalId) : null
  if (!festival) throw new Error('Das Gründungsfest wurde nicht gefunden.')
  if (festival.archived) {
    throw new Error(`Das Gründungsfest „${festival.name}“ ist archiviert. Für archivierte Feste können keine Rechnungen erstellt werden.`)
  }

  const customer = validateCustomer(draft.customer)
  let persons: number | null = null
  if (customer.kind === 'verein' && draft.persons !== null && draft.persons !== undefined) {
    if (!isNonNegativeInt(draft.persons)) throw new Error('Die Personenzahl muss eine ganze Zahl ab 0 sein.')
    persons = draft.persons
  }

  const kind = draft.paymentKind as PaymentKind
  if (kind !== 'bar' && kind !== 'ueberweisung') throw new Error('Bitte eine gültige Zahlungsart wählen.')
  const payment = repo.readPaymentMethod(db, festival.id, kind)
  if (!payment) throw new Error(`Die Zahlungsart „${kind === 'bar' ? 'Bar' : 'Überweisung'}“ ist für dieses Fest nicht eingerichtet.`)

  if (!isValidIsoDate(draft.invoiceDate)) throw new Error('Bitte ein gültiges Rechnungsdatum angeben.')
  if (!isValidIsoDate(draft.serviceDate)) throw new Error('Bitte ein gültiges Leistungsdatum angeben.')
  const dueDate = addDays(draft.invoiceDate, payment.dueDays)

  if (!Array.isArray(draft.lines) || draft.lines.length === 0) throw new Error('Die Rechnung enthält keine Positionen.')
  if (draft.lines.length > MAX_LINES) throw new Error(`Zu viele Positionen (höchstens ${MAX_LINES}).`)
  const productIds = repo.productIdsOfFestival(db, festival.id)
  const lines = draft.lines.map((raw, index): repo.InvoiceLineInsertValues => {
    if (!raw || typeof raw !== 'object') throw new Error(`Position ${index + 1}: ungültige Angaben.`)
    const name = text(raw.name, `Bezeichnung der Position ${index + 1}`)
    const label = name ? `Position ${index + 1} („${name}“)` : `Position ${index + 1}`
    if (name === '') throw new Error(`${label}: Die Bezeichnung fehlt.`)
    if (!isNonNegativeInt(raw.quantity)) throw new Error(`${label}: Die Menge muss eine ganze Zahl ab 0 sein.`)
    if (!isNonNegativeInt(raw.priceCents)) throw new Error(`${label}: Der Preis muss ein Betrag ab 0 € sein.`)
    if (raw.vatRate !== 7 && raw.vatRate !== 19) throw new Error(`${label}: Der MwSt-Satz muss 7 % oder 19 % sein.`)
    const productId = raw.productId === null || raw.productId === undefined ? null : raw.productId
    if (productId !== null && !(Number.isSafeInteger(productId) && productIds.has(productId))) {
      throw new Error(`${label}: Das Produkt gehört nicht zu diesem Fest.`)
    }
    return {
      productId,
      name,
      priceCents: raw.priceCents,
      vatRate: raw.vatRate as VatRate,
      quantity: raw.quantity,
      lineTotalCents: calculateLineTotal(raw.priceCents, raw.quantity)
    }
  })
  const totals = calculateTotals(lines)
  if (totals.grossCents === 0) throw new Error(ZERO_TOTAL_MESSAGE)

  return {
    festival,
    customer,
    persons,
    payment,
    invoiceDate: draft.invoiceDate,
    serviceDate: draft.serviceDate,
    dueDate,
    lines,
    totals
  }
}

/* ------------------------------------------------------------------ */
/* Nummernvergabe + Speichern (Transaktion)                            */
/* ------------------------------------------------------------------ */

/** Nächste laufende Nummer des Fests als Text (nur Anzeige, keine Reservierung). */
export function nextNumberPreview(festivalId: number, db: Db = getDb()): string {
  const festival = repo.readFestival(db, festivalId)
  if (!festival) throw new Error('Das Gründungsfest wurde nicht gefunden.')
  return formatInvoiceNumber(festival.numberPrefix, festival.numberNext, festival.numberDigits)
}

/**
 * Validiert den Entwurf und speichert die Rechnung in EINER Transaktion (BEGIN IMMEDIATE):
 * Nummer vergeben, Zähler erhöhen, Rechnung und Positionen mit allen Kopien speichern.
 * Bei jedem Fehler wird nichts gespeichert. Liefert die ID der neuen Rechnung.
 */
export function createInvoiceRecord(draft: InvoiceDraft, db: Db = getDb(), now: Date = new Date()): { id: number; number: string } {
  // Dokumentenordner vor der Nummernvergabe prüfen – ohne Ablage keine Rechnung
  requireDocumentsDir(getSettings(db).documentsDir)

  const tx = db.transaction(() => {
    const v = validateDraft(draft, db)
    const seq = v.festival.numberNext
    const number = formatInvoiceNumber(v.festival.numberPrefix, seq, v.festival.numberDigits)
    if (repo.numberExists(db, number)) throw new Error(numberCollisionMessage(number))
    const { templateJson, logoFile } = templateSnapshot(db, v.festival.id)
    const id = repo.insertInvoice(db, {
      festivalId: v.festival.id,
      number,
      seq,
      type: 'rechnung',
      originalInvoiceId: null,
      stornoReason: null,
      customer: v.customer,
      persons: v.persons,
      paymentKind: v.payment.kind,
      paymentLabel: v.payment.label,
      paymentText: v.payment.text,
      dueDays: v.payment.dueDays,
      invoiceDate: v.invoiceDate,
      serviceDate: v.serviceDate,
      dueDate: v.dueDate,
      totals: v.totals,
      taxExempt: v.festival.taxExempt,
      taxExemptText: v.festival.taxExemptText,
      festivalName: v.festival.name,
      templateJson,
      logoFile,
      createdAt: now.toISOString()
    })
    repo.insertLines(db, id, v.lines)
    repo.setFestivalNumberNext(db, v.festival.id, seq + 1)
    return { id, number }
  })

  try {
    return tx.immediate()
  } catch (err) {
    if (isUniqueViolation(err, 'invoice.number')) {
      const festival = repo.readFestival(db, draft.festivalId)
      const number = festival ? formatInvoiceNumber(festival.numberPrefix, festival.numberNext, festival.numberDigits) : '?'
      throw new Error(numberCollisionMessage(number))
    }
    throw err
  }
}

/* ------------------------------------------------------------------ */
/* Abschluss                                                           */
/* ------------------------------------------------------------------ */

function requireInvoice(db: Db, id: number): Invoice {
  const invoice = repo.findInvoice(db, id)
  if (!invoice) throw new Error('Die Rechnung wurde nicht gefunden.')
  return invoice
}

/** PDF ablegen und drucken – gemeinsamer Abschluss für Rechnung und Storno. */
export async function fileAndPrint(id: number, opts: { printer?: string } = {}, db: Db = getDb(), deps: PrintDeps = {}): Promise<FinalizeResult> {
  const pdf = await ensureInvoicePdf(id, db)
  const print = await printInvoice(id, { ...opts, pdf }, db, deps)
  return {
    invoice: requireInvoice(db, id),
    pdf: pdf.ok ? { ok: true, path: pdf.path } : { ok: false, path: null, ...(pdf.error ? { error: pdf.error } : {}) },
    print
  }
}

/** `invoices.finalize`: Nummer vergeben → PDF → ablegen → drucken → Status. */
export async function finalizeInvoice(
  draft: InvoiceDraft,
  opts: { printer?: string } = {},
  db: Db = getDb(),
  deps: PrintDeps = {}
): Promise<FinalizeResult> {
  const { id } = createInvoiceRecord(draft, db)
  return fileAndPrint(id, opts, db, deps)
}

/* ------------------------------------------------------------------ */
/* Lesen                                                               */
/* ------------------------------------------------------------------ */

export function listInvoices(festivalId: number, db: Db = getDb()): InvoiceListItem[] {
  if (!Number.isSafeInteger(festivalId)) throw new Error('Das Gründungsfest wurde nicht gefunden.')
  return repo.listInvoices(db, festivalId)
}

/** Rechnung mit Positionen; ein fehlendes PDF wird dabei automatisch nachgeholt (wirft deswegen nicht). */
export async function getInvoice(id: number, db: Db = getDb()): Promise<Invoice> {
  requireInvoice(db, id)
  await ensureInvoicePdf(id, db)
  return requireInvoice(db, id)
}
