/**
 * Zustand der Festbüro-Maske (Reducer). Die Fachlogik steckt in `@shared/invoice-draft`.
 *
 * Datumsfelder: `null` = Standard (Rechnungsdatum heute, Leistungsdatum Festdatum). So bleibt „heute“
 * auch über Mitternacht korrekt und eine Überschreibung ist eindeutig erkennbar.
 */
import {
  addExtraLine,
  applyQuickPick,
  customerEinzel,
  customerFromClub,
  normalizeQuantity,
  reprefillLines,
  resetLine,
  removeLine,
  sanitizeQuantityInput,
  setLineQuantity,
  syncDraftLines,
  updateExtraLine,
  type DraftFromInvoice,
  type DraftLine,
  type EinzelAddress,
  type PrefillContext,
  type QuickPick
} from '@shared/invoice-draft'
import type { Club, CustomerSnapshot, IsoDate, PaymentKind, Product } from '@shared/types'

export interface MaskState {
  customer: CustomerSnapshot | null
  /** Text im Personenfeld (nur Vereine) */
  personsInput: string
  lines: DraftLine[]
  /** null = Standard-Zahlart des Fests */
  paymentKind: PaymentKind | null
  /** null = heute */
  invoiceDate: IsoDate | null
  /** null = Festdatum */
  serviceDate: IsoDate | null
  /** Korrektur einer alten Rechnung („Stornieren und neu erstellen“) */
  correction: { id: number; number: string } | null
}

export type MaskAction =
  | { type: 'syncProducts'; products: Product[] }
  | { type: 'selectClub'; club: Club }
  | { type: 'selectEinzel' }
  | { type: 'setEinzelAddress'; address: EinzelAddress }
  | { type: 'setPersons'; input: string }
  | { type: 'setQuantity'; key: string; quantity: number }
  | { type: 'quickPick'; key: string; pick: QuickPick }
  | { type: 'resetLine'; key: string }
  | { type: 'addExtra' }
  | {
      type: 'updateExtra'
      key: string
      patch: Partial<Pick<DraftLine, 'name' | 'priceCents' | 'vatRate' | 'quantity'>>
    }
  | { type: 'removeExtra'; key: string }
  | { type: 'setPayment'; kind: PaymentKind }
  | { type: 'setDates'; invoiceDate?: IsoDate | null; serviceDate?: IsoDate | null }
  | {
      type: 'applyInvoice'
      draft: DraftFromInvoice
      correction: { id: number; number: string } | null
      festivalDate: IsoDate
    }
  | { type: 'reset'; products: Product[] }
  | { type: 'restore'; state: MaskState }

export function initialMaskState(products: Product[] = []): MaskState {
  return {
    customer: null,
    personsInput: '',
    lines: syncDraftLines([], products, { customerKind: null, persons: null }),
    paymentKind: null,
    invoiceDate: null,
    serviceDate: null,
    correction: null
  }
}

/** Kommende Personen (null bei Einzelrechnung bzw. ohne Kunde). */
export function personsOf(state: Pick<MaskState, 'customer' | 'personsInput'>): number | null {
  return state.customer?.kind === 'verein' ? normalizeQuantity(state.personsInput) : null
}

export function prefillContextOf(state: Pick<MaskState, 'customer' | 'personsInput'>): PrefillContext {
  return { customerKind: state.customer?.kind ?? null, persons: personsOf(state) }
}

/** true, sobald etwas eingegeben wurde (für „Rückgängig“ nach dem Zurücksetzen). */
export function isDirty(state: MaskState): boolean {
  return (
    state.customer !== null ||
    state.lines.some((l) => l.manual || l.quantity !== 0) ||
    state.paymentKind !== null ||
    state.invoiceDate !== null ||
    state.serviceDate !== null
  )
}

export function maskReducer(state: MaskState, action: MaskAction): MaskState {
  switch (action.type) {
    case 'syncProducts':
      return { ...state, lines: syncDraftLines(state.lines, action.products, prefillContextOf(state)) }

    case 'selectClub': {
      const customer = customerFromClub(action.club)
      const personsInput = String(normalizeQuantity(action.club.registeredPersons))
      const next = { ...state, customer, personsInput }
      return { ...next, lines: reprefillLines(state.lines, prefillContextOf(next)) }
    }

    case 'selectEinzel': {
      const customer = state.customer?.kind === 'einzel' ? state.customer : customerEinzel()
      const next = { ...state, customer, personsInput: '' }
      return { ...next, lines: reprefillLines(state.lines, prefillContextOf(next)) }
    }

    case 'setEinzelAddress': {
      if (state.customer?.kind !== 'einzel') return state
      const merged = { ...state.customer, ...action.address }
      // nicht trimmen während der Eingabe (sonst verschwinden Leerzeichen beim Tippen)
      return { ...state, customer: { ...merged, kind: 'einzel', clubId: null, clubName: '', registeredPersons: null } }
    }

    case 'setPersons': {
      if (state.customer?.kind !== 'verein') return state
      const personsInput = sanitizeQuantityInput(action.input)
      if (personsInput === state.personsInput) return state
      const next = { ...state, personsInput }
      return { ...next, lines: reprefillLines(state.lines, prefillContextOf(next)) }
    }

    case 'setQuantity':
      return { ...state, lines: setLineQuantity(state.lines, action.key, action.quantity, prefillContextOf(state)) }

    case 'quickPick':
      return { ...state, lines: applyQuickPick(state.lines, action.key, action.pick, prefillContextOf(state)) }

    case 'resetLine':
      return { ...state, lines: resetLine(state.lines, action.key, prefillContextOf(state)) }

    case 'addExtra':
      return { ...state, lines: addExtraLine(state.lines) }

    case 'updateExtra':
      return { ...state, lines: updateExtraLine(state.lines, action.key, action.patch) }

    case 'removeExtra':
      return { ...state, lines: removeLine(state.lines, action.key) }

    case 'setPayment':
      return { ...state, paymentKind: action.kind }

    case 'setDates':
      return {
        ...state,
        invoiceDate: action.invoiceDate !== undefined ? action.invoiceDate : state.invoiceDate,
        serviceDate: action.serviceDate !== undefined ? action.serviceDate : state.serviceDate
      }

    case 'applyInvoice': {
      const { draft } = action
      return {
        customer: draft.customer,
        personsInput: draft.persons === null ? '' : String(draft.persons),
        lines: draft.lines,
        paymentKind: draft.paymentKind,
        invoiceDate: null,
        serviceDate: draft.serviceDate && draft.serviceDate !== action.festivalDate ? draft.serviceDate : null,
        correction: action.correction
      }
    }

    case 'reset':
      return initialMaskState(action.products)

    case 'restore':
      return action.state
  }
}

/* ------------------------------------------------------------------ */
/* Entwurf beim Verlassen der Seite merken                             */
/* ------------------------------------------------------------------ */

let savedDraft: { festivalId: number; state: MaskState } | null = null

/** Merkt einen angefangenen Entwurf (z. B. kurzer Blick in die Rechnungsliste). */
export function saveDraft(festivalId: number, state: MaskState): void {
  savedDraft = isDirty(state) ? { festivalId, state } : null
}

/**
 * Liefert einen gemerkten Entwurf für das Fest (oder null). Wird nicht verbraucht – beim nächsten
 * Verlassen der Seite überschreibt `saveDraft` ihn ohnehin (robust gegen doppelte Initialisierung).
 */
export function takeSavedDraft(festivalId: number): MaskState | null {
  if (!savedDraft || savedDraft.festivalId !== festivalId) return null
  return savedDraft.state
}

export function clearSavedDraft(): void {
  savedDraft = null
}
