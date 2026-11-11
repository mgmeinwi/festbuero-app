/**
 * Route: /festbuero (Start) – Festbüro-Maske.
 *
 * Links drei Schritte (Kunde → Personen → Positionen), darunter fest angedockt Zahlart, Datum,
 * Endbetrag und „Abschließen & drucken“; rechts (≥ xl) bzw. als Sheet die Live-Vorschau.
 * Komplett per Tastatur bedienbar: Suche (↑/↓, Enter) → Personen (Enter) → Mengen (Tab/Enter,
 * ↑/↓ ändern) → ⌘/Strg+Enter (über das Anwendungsmenü).
 *
 * URL-Vorbelegung: `?from=<invoiceId>` (Korrektur einer alten Rechnung), `?club=<clubId>` (Verein).
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { FilePen, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { todayIso } from '@shared/dates'
import {
  buildDraftRenderData,
  buildInvoiceDraft,
  calculateDraftTotals,
  defaultPaymentKind,
  draftFromInvoice,
  EMPTY_PREVIEW_CUSTOMER,
  getFinalizeBlocker,
  nextExtraKey
} from '@shared/invoice-draft'
import type { Club, Festival, FinalizeResult, PaymentMethod } from '@shared/types'
import { Button } from '@/components/ui/button'
import { queryKeys } from '@/hooks/query-keys'
import { useActiveFestival } from '@/hooks/use-active-festival'
import { useBreakpoint } from '@/hooks/use-media-query'
import { api } from '@/lib/api'
import { useMenuAction } from '@/lib/menu-actions'
import { updateMenuState, useCanFinalize } from '@/lib/menu-state'
import { errorMessage, modKey } from '@/lib/utils'
import { CustomerStep } from './CustomerStep'
import { useClubs, useLogoDataUrl, useNextNumberPreview, usePaymentMethods, useProducts, useTemplate } from './data'
import { FinalizeBar } from './FinalizeBar'
import {
  clearSavedDraft,
  initialMaskState,
  isDirty,
  maskReducer,
  personsOf,
  prefillContextOf,
  saveDraft,
  takeSavedDraft,
  type MaskState
} from './mask-state'
import { PersonsStep } from './PersonsStep'
import { PositionsStep, type PositionsHandlers } from './PositionsStep'
import { PreviewColumn, PreviewSheet, type PreviewContent } from './PreviewPane'
import { SuccessDialog } from './SuccessDialog'

const PREVIEW_PREF_KEY = 'festbuero.maske.previewOpen'
const NO_PAYMENT_METHODS: PaymentMethod[] = []

function readPreviewPref(): boolean {
  try {
    return window.localStorage.getItem(PREVIEW_PREF_KEY) !== '0'
  } catch {
    return true
  }
}

function writePreviewPref(open: boolean): void {
  try {
    window.localStorage.setItem(PREVIEW_PREF_KEY, open ? '1' : '0')
  } catch {
    // ignorieren
  }
}

export default function FestbueroPage() {
  const { festival } = useActiveFestival()
  if (!festival) return null
  // Neues Fest → neue Maske (andere Produkte, Vereine, Nummernkreis)
  return <FestbueroMask key={festival.id} festival={festival} />
}

type FocusTarget = 'search' | 'persons' | 'firstQuantity' | `extra:${string}`

function FestbueroMask({ festival }: { festival: Festival }) {
  const festivalId = festival.id
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  const productsQ = useProducts(festivalId)
  const clubsQ = useClubs(festivalId)
  const paymentQ = usePaymentMethods(festivalId)
  const templateQ = useTemplate(festivalId)
  const logoQ = useLogoDataUrl(festivalId, templateQ.data?.logoFile)
  const nextNumberQ = useNextNumberPreview(festival)

  const products = productsQ.data
  const clubs = clubsQ.data
  const paymentMethods = paymentQ.data ?? NO_PAYMENT_METHODS

  const [state, dispatch] = useReducer(
    maskReducer,
    festivalId,
    (id: number) => takeSavedDraft(id) ?? initialMaskState()
  )
  const [searching, setSearching] = useState(false)
  const [searchKey, setSearchKey] = useState(0)
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(state.customer ? 'firstQuantity' : 'search')
  const [finalizing, setFinalizing] = useState(false)
  const [result, setResult] = useState<FinalizeResult | null>(null)

  const isXl = useBreakpoint('xl')
  const [columnOpen, setColumnOpen] = useState(readPreviewPref)
  const [sheetOpen, setSheetOpen] = useState(false)

  // aktuelle Werte für stabile Handler
  const stateRef = useRef(state)
  stateRef.current = state
  const productsRef = useRef(products)
  productsRef.current = products
  const resultRef = useRef<FinalizeResult | null>(null)
  const finalizingRef = useRef(false)

  const searchRef = useRef<HTMLInputElement>(null)
  const personsRef = useRef<HTMLInputElement>(null)
  const qtyRefs = useRef(new Map<string, HTMLInputElement>())
  const extraNameRefs = useRef(new Map<string, HTMLInputElement>())

  /* ---------------- Daten abgleichen ---------------- */

  useEffect(() => {
    if (products) dispatch({ type: 'syncProducts', products })
  }, [products])

  // Angefangenen Entwurf beim Verlassen merken (z. B. kurzer Blick in die Rechnungsliste)
  useEffect(
    () => () => {
      if (resultRef.current) clearSavedDraft()
      else saveDraft(festivalId, stateRef.current)
    },
    [festivalId]
  )

  useEffect(() => {
    if (isXl) setSheetOpen(false)
  }, [isXl])

  /* ---------------- Abgeleitete Werte ---------------- */

  const today = todayIso()
  const ctx = prefillContextOf(state)
  const persons = personsOf(state)
  const paymentKind = state.paymentKind ?? defaultPaymentKind(paymentMethods)
  const invoiceDate = state.invoiceDate ?? today
  const serviceDate = state.serviceDate ?? festival.festivalDate
  const totals = useMemo(() => calculateDraftTotals(state.lines), [state.lines])
  const blocker = getFinalizeBlocker({ customer: state.customer, lines: state.lines, invoiceDate, serviceDate })
  const canFinalizeNow = blocker === null && !finalizing && result === null
  useCanFinalize(canFinalizeNow)

  const previewVisible = isXl ? columnOpen : sheetOpen
  const renderData = useMemo(
    () =>
      buildDraftRenderData({
        draft: buildInvoiceDraft({
          festivalId,
          customer: state.customer ?? EMPTY_PREVIEW_CUSTOMER,
          persons,
          paymentKind,
          invoiceDate,
          serviceDate,
          lines: state.lines
        }),
        festival,
        paymentMethods,
        number: nextNumberQ.data ?? null,
        today
      }),
    [
      festivalId,
      festival,
      state.customer,
      state.lines,
      persons,
      paymentKind,
      invoiceDate,
      serviceDate,
      paymentMethods,
      nextNumberQ.data,
      today
    ]
  )
  // Tippen bleibt flüssig, die Vorschau zieht nach
  const deferredRenderData = useDeferredValue(renderData)
  const previewContent: PreviewContent = {
    data: deferredRenderData,
    template: templateQ.data?.config ?? null,
    logoDataUrl: logoQ.data ?? null
  }

  /* ---------------- Fokus ---------------- */

  useEffect(() => {
    if (!focusTarget) return
    let el: HTMLInputElement | null | undefined = null
    if (focusTarget === 'search') el = searchRef.current
    else if (focusTarget === 'persons') el = personsRef.current
    else if (focusTarget === 'firstQuantity') {
      for (const line of state.lines) {
        el = qtyRefs.current.get(line.key)
        if (el) break
      }
    } else el = extraNameRefs.current.get(focusTarget.slice('extra:'.length))
    if (!el) return
    el.focus()
    el.select()
    setFocusTarget(null)
  })

  /* ---------------- Aktionen ---------------- */

  const handlers = useMemo<PositionsHandlers>(
    () => ({
      setQuantity: (key, quantity) => dispatch({ type: 'setQuantity', key, quantity }),
      quickPick: (key, pick) => dispatch({ type: 'quickPick', key, pick }),
      resetLine: (key) => dispatch({ type: 'resetLine', key }),
      updateExtra: (key, patch) => dispatch({ type: 'updateExtra', key, patch }),
      removeExtra: (key) => dispatch({ type: 'removeExtra', key }),
      addExtra: () => {
        const key = nextExtraKey(stateRef.current.lines)
        dispatch({ type: 'addExtra' })
        setFocusTarget(`extra:${key}`)
      },
      enterFrom: (key) => {
        const lines = stateRef.current.lines
        const index = lines.findIndex((l) => l.key === key)
        for (let i = index + 1; i < lines.length; i++) {
          const el = qtyRefs.current.get(lines[i]!.key)
          if (el) {
            el.focus()
            el.select()
            return
          }
        }
      },
      registerQuantity: (key, el) => {
        if (el) qtyRefs.current.set(key, el)
        else qtyRefs.current.delete(key)
      },
      registerExtraName: (key, el) => {
        if (el) extraNameRefs.current.set(key, el)
        else extraNameRefs.current.delete(key)
      }
    }),
    []
  )

  const clearUrlParams = useCallback(() => {
    if (searchParams.has('from') || searchParams.has('club')) setSearchParams({}, { replace: true })
  }, [searchParams, setSearchParams])

  /** Alles zurücksetzen, Fokus ins Suchfeld. `undo` bietet „Rückgängig“ an (Menü ⌘N bei angefangener Rechnung). */
  function newInvoice(opts: { undo?: boolean; focus?: FocusTarget } = {}) {
    const previous: MaskState = stateRef.current
    const offerUndo = opts.undo && !resultRef.current && isDirty(previous)
    dispatch({ type: 'reset', products: productsRef.current ?? [] })
    resultRef.current = null
    setResult(null)
    setSearching(false)
    setSearchKey((k) => k + 1)
    setFocusTarget(opts.focus ?? 'search')
    clearUrlParams()
    clearSavedDraft()
    if (offerUndo) {
      toast('Neue Rechnung begonnen.', {
        action: {
          label: 'Rückgängig',
          onClick: () => {
            dispatch({ type: 'restore', state: previous })
            if (productsRef.current) dispatch({ type: 'syncProducts', products: productsRef.current })
          }
        }
      })
    }
  }

  function selectClub(club: Club) {
    dispatch({ type: 'selectClub', club })
    setSearching(false)
    setFocusTarget('persons')
  }

  function selectEinzel() {
    dispatch({ type: 'selectEinzel' })
    setSearching(false)
    setFocusTarget('firstQuantity')
  }

  function openSearch() {
    if (resultRef.current) return
    if (stateRef.current.customer) setSearching(true)
    setFocusTarget('search')
  }

  function togglePreview() {
    if (isXl) {
      setColumnOpen((open) => {
        writePreviewPref(!open)
        return !open
      })
    } else {
      setSheetOpen((open) => !open)
    }
  }

  async function finalize() {
    if (finalizingRef.current || resultRef.current) return
    const current = stateRef.current
    const problem = getFinalizeBlocker({ customer: current.customer, lines: current.lines, invoiceDate, serviceDate })
    if (problem || !current.customer) {
      toast.error(problem ?? 'Die Rechnung kann noch nicht abgeschlossen werden.')
      return
    }
    const draft = buildInvoiceDraft({
      festivalId,
      customer: current.customer,
      persons: personsOf(current),
      paymentKind: current.paymentKind ?? defaultPaymentKind(paymentMethods),
      invoiceDate: current.invoiceDate ?? todayIso(),
      serviceDate: current.serviceDate ?? festival.festivalDate,
      lines: current.lines
    })
    finalizingRef.current = true
    setFinalizing(true)
    try {
      const res = await api.invoices.finalize(draft)
      resultRef.current = res
      setResult(res)
      clearSavedDraft()
      clearUrlParams()
      updateMenuState({ lastInvoiceId: res.invoice.id })
      for (const queryKey of [
        queryKeys.invoices(festivalId),
        queryKeys.clubs(festivalId),
        queryKeys.products(festivalId),
        queryKeys.evaluation(festivalId),
        queryKeys.festivals
      ]) {
        void queryClient.invalidateQueries({ queryKey })
      }
    } catch (err) {
      toast.error(errorMessage(err, 'Die Rechnung konnte nicht abgeschlossen werden.'))
    } finally {
      finalizingRef.current = false
      setFinalizing(false)
    }
  }

  useMenuAction('invoice.new', () => newInvoice({ undo: true }))
  useMenuAction('invoice.newEinzel', () => {
    newInvoice({ undo: true, focus: 'firstQuantity' })
    dispatch({ type: 'selectEinzel' })
  })
  useMenuAction('invoice.finalize', () => finalize())
  useMenuAction('preview.toggle', togglePreview)
  useMenuAction('search.focus', openSearch)

  /* ---------------- URL-Vorbelegung ---------------- */

  const fromParam = searchParams.get('from')
  const clubParam = searchParams.get('club')
  const appliedParams = useRef<string | null>(null)

  useEffect(() => {
    if (!fromParam && !clubParam) return
    if (!products) return
    const key = `${fromParam ?? ''}|${clubParam ?? ''}`
    if (appliedParams.current === key) return

    if (fromParam) {
      appliedParams.current = key
      const id = Number(fromParam)
      api.invoices
        .get(id)
        .then((invoice) => {
          if (invoice.festivalId !== festivalId) {
            toast.error(`Rechnung ${invoice.number} gehört zu einem anderen Gründungsfest.`)
            return
          }
          dispatch({
            type: 'applyInvoice',
            draft: draftFromInvoice(invoice, productsRef.current ?? products),
            correction: { id: invoice.id, number: invoice.number },
            festivalDate: festival.festivalDate
          })
          setSearching(false)
          setSearchKey((k) => k + 1)
          setFocusTarget(invoice.customer.kind === 'verein' ? 'persons' : 'firstQuantity')
        })
        .catch((err: unknown) => toast.error(errorMessage(err, 'Die Rechnung konnte nicht geladen werden.')))
        .finally(() => setSearchParams({}, { replace: true }))
      return
    }

    if (!clubs) return
    appliedParams.current = key
    const club = clubs.find((c) => c.id === Number(clubParam))
    if (club) {
      dispatch({ type: 'selectClub', club })
      setSearching(false)
      setFocusTarget('persons')
    } else {
      toast.error('Der Verein wurde nicht gefunden.')
    }
    setSearchParams({}, { replace: true })
  }, [fromParam, clubParam, products, clubs, festivalId, festival.festivalDate, setSearchParams])

  /* ---------------- Darstellung ---------------- */

  const isVerein = state.customer?.kind === 'verein'
  const dirty = isDirty(state)
  const productsError = productsQ.error ? errorMessage(productsQ.error) : null
  const clubsError = clubsQ.error ? errorMessage(clubsQ.error) : null

  return (
    <div className="flex h-full min-h-0" data-testid="festbuero-mask">
      <h1 className="sr-only">Festbüro – Rechnung erstellen</h1>
      <div className="@container/mask flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto" inert={finalizing} data-testid="mask-steps">
          <div className="mx-auto w-full max-w-3xl space-y-5 p-4 @lg/mask:p-5">
            {state.correction ? (
              <div
                role="status"
                className="flex items-start gap-2.5 rounded-lg border border-warning/60 bg-warning/15 px-3 py-2.5 text-sm"
                data-testid="correction-banner"
              >
                <FilePen className="mt-0.5 size-4 shrink-0 text-warning-foreground dark:text-warning" aria-hidden />
                <p className="min-w-0 flex-1">
                  <span className="font-semibold">Korrektur von Rechnung Nr. {state.correction.number}</span>
                  <span className="text-muted-foreground"> – übernommene Positionen sind als geändert markiert.</span>
                </p>
              </div>
            ) : null}

            <CustomerStep
              key={searchKey}
              clubs={clubs}
              clubsLoading={clubsQ.isLoading}
              clubsError={clubsError}
              customer={state.customer}
              searching={searching}
              onSearchingChange={(open) => {
                setSearching(open)
                if (open) setFocusTarget('search')
              }}
              onSelectClub={selectClub}
              onSelectEinzel={selectEinzel}
              onEinzelAddressChange={(address) => dispatch({ type: 'setEinzelAddress', address })}
              searchInputRef={searchRef}
              aside={
                dirty ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-muted-foreground"
                    onClick={() => newInvoice({ undo: true })}
                    title={`Neue Rechnung (${modKey}N)`}
                    data-testid="reset-mask"
                  >
                    <RotateCcw aria-hidden />
                    Neu beginnen
                  </Button>
                ) : null
              }
            />

            {isVerein ? (
              <PersonsStep
                personsInput={state.personsInput}
                registeredPersons={state.customer?.registeredPersons ?? null}
                onChange={(input) => dispatch({ type: 'setPersons', input })}
                onEnter={() => setFocusTarget('firstQuantity')}
                inputRef={personsRef}
              />
            ) : null}

            <PositionsStep
              step={isVerein ? 3 : 2}
              lines={state.lines}
              ctx={ctx}
              taxExempt={festival.taxExempt}
              loading={productsQ.isLoading}
              error={productsError}
              handlers={handlers}
            />
          </div>
        </div>

        <FinalizeBar
          totals={totals}
          taxExempt={festival.taxExempt}
          paymentMethods={paymentMethods}
          paymentKind={paymentKind}
          onPaymentChange={(kind) => dispatch({ type: 'setPayment', kind })}
          invoiceDate={invoiceDate}
          serviceDate={serviceDate}
          defaultInvoiceDate={today}
          defaultServiceDate={festival.festivalDate}
          onDatesChange={(dates) => dispatch({ type: 'setDates', ...dates })}
          nextNumber={nextNumberQ.data ?? null}
          blocker={blocker}
          canFinalize={canFinalizeNow}
          finalizing={finalizing}
          onFinalize={() => void finalize()}
          previewOpen={previewVisible}
          onTogglePreview={togglePreview}
        />
      </div>

      {isXl && columnOpen ? <PreviewColumn content={previewContent} onClose={togglePreview} /> : null}
      {!isXl ? <PreviewSheet content={previewContent} open={sheetOpen} onOpenChange={setSheetOpen} /> : null}

      {result ? <SuccessDialog key={result.invoice.id} result={result} onNewInvoice={() => newInvoice()} /> : null}
    </div>
  )
}
