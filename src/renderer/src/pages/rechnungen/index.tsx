/**
 * Route: /rechnungen – Rechnungsliste des aktiven Fests (Bereich „Liste & Auswertung“).
 *
 * Suche (Nummer, Kunde), Filter (Zeitraum, Zahlart, Status), Sortierung per Spaltenkopf,
 * Einzelaktionen (Vorschau, PDF öffnen, erneut drucken, PDF exportieren, stornieren),
 * Mehrfachauswahl (ZIP, Bulk-Druck, Excel). Menüaktionen: invoices.exportListExcel,
 * invoices.exportZip, search.focus.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { FileArchive, FileSpreadsheet, FilterX, Printer, ReceiptText, X } from 'lucide-react'
import { formatEuro } from '@shared/money'
import type { InvoiceListItem } from '@shared/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { queryKeys } from '@/hooks/query-keys'
import { useActiveFestival } from '@/hooks/use-active-festival'
import { api, isNotAvailableError } from '@/lib/api'
import { useMenuAction } from '@/lib/menu-actions'
import { errorMessage } from '@/lib/utils'
import { InvoiceTable } from './InvoiceTable'
import { ListToolbar } from './ListToolbar'
import { PreviewDialog } from './PreviewDialog'
import { PrintDialog, PrintResultsDialog } from './PrintDialog'
import { StornoDialog, type StornoMode } from './StornoDialog'
import {
  belegeLabel,
  DEFAULT_SORT,
  EMPTY_FILTERS,
  filterInvoices,
  hasActiveFilters,
  nextSort,
  sortInvoices,
  summarize,
  type ListFilters,
  type SortKey,
  type SortState
} from './list-utils'
import { useInvoiceActions, type InvoiceRef, type PrintOutcome } from './use-invoice-actions'

export default function RechnungenPage() {
  const { festival } = useActiveFestival()
  if (!festival) return null
  // eigener Zustand pro Fest (Filter/Auswahl zurücksetzen beim Wechsel)
  return <InvoiceListPage key={festival.id} festivalId={festival.id} festivalName={festival.name} copies={festival.copies} />
}

const ref = (i: Pick<InvoiceListItem, 'id' | 'number'>): InvoiceRef => ({ id: i.id, number: i.number })

function InvoiceListPage({ festivalId, festivalName, copies }: { festivalId: number; festivalName: string; copies: number }) {
  const navigate = useNavigate()
  const actions = useInvoiceActions(festivalId)
  const searchRef = useRef<HTMLInputElement>(null)

  const query = useQuery({
    queryKey: queryKeys.invoices(festivalId),
    queryFn: () => api.invoices.list(festivalId)
  })
  const all = useMemo(() => query.data ?? [], [query.data])

  const [filters, setFilters] = useState<ListFilters>(EMPTY_FILTERS)
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT)
  const [selected, setSelected] = useState<Set<number>>(() => new Set())

  const filtered = useMemo(() => sortInvoices(filterInvoices(all, filters), sort), [all, filters, sort])
  const summary = useMemo(() => summarize(filtered), [filtered])
  const selectedItems = useMemo(() => filtered.filter((i) => selected.has(i.id)), [filtered, selected])
  const filterActive = hasActiveFilters(filters)

  const [preview, setPreview] = useState<InvoiceListItem | null>(null)
  const [stornoTarget, setStornoTarget] = useState<InvoiceListItem | null>(null)
  const [printTargets, setPrintTargets] = useState<InvoiceRef[] | null>(null)
  const [printOutcomes, setPrintOutcomes] = useState<PrintOutcome[] | null>(null)

  const updateFilters = useCallback((patch: Partial<ListFilters>) => setFilters((f) => ({ ...f, ...patch })), [])
  const onSort = useCallback((key: SortKey) => setSort((s) => nextSort(s, key)), [])
  const onToggle = useCallback((id: number, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])
  const onToggleAll = useCallback(
    (checked: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev)
        for (const i of filtered) {
          if (checked) next.add(i.id)
          else next.delete(i.id)
        }
        return next
      })
    },
    [filtered]
  )
  const clearSelection = useCallback(() => setSelected(new Set()), [])

  /* Export-Ziele: Auswahl, sonst die angezeigte (gefilterte) Liste */
  const exportTargets = useCallback((): InvoiceListItem[] => (selectedItems.length > 0 ? selectedItems : filtered), [selectedItems, filtered])

  const exportExcel = useCallback(async () => {
    const targets = exportTargets()
    const ids = selectedItems.length > 0 || filterActive ? targets.map((i) => i.id) : undefined
    await actions.exportExcel(ids, targets.length)
  }, [actions, exportTargets, selectedItems.length, filterActive])

  const exportZip = useCallback(async () => {
    await actions.exportZip(exportTargets().map((i) => i.id))
  }, [actions, exportTargets])

  useMenuAction('search.focus', () => {
    searchRef.current?.focus()
    searchRef.current?.select()
  })
  useMenuAction('invoices.exportListExcel', exportExcel)
  useMenuAction('invoices.exportZip', exportZip)

  /* Druck */
  const confirmPrint = useCallback(
    async (targets: InvoiceRef[], printer: string | undefined) => {
      let outcomes: PrintOutcome[]
      try {
        outcomes = await actions.print(targets, printer)
      } catch (err) {
        toast.error(errorMessage(err))
        return
      }
      setPrintTargets(null)
      const failed = outcomes.filter((o) => !o.result.ok)
      if (outcomes.length === 1) {
        const o = outcomes[0]!
        actions.toastPrint(o.number, o.result, () => setPrintTargets([{ id: o.id, number: o.number }]))
      } else if (failed.length === 0) {
        const first = outcomes[0]?.result
        toast.success(`${belegeLabel(outcomes.length)} gedruckt`, {
          description: first
            ? `je ${first.copies} ${first.copies === 1 ? 'Kopie' : 'Kopien'} auf „${actions.printerLabel(first.printer)}“${first.dryRun ? ' – Testmodus, nur simuliert' : ''}`
            : undefined
        })
      } else {
        setPrintOutcomes(outcomes)
      }
    },
    [actions]
  )

  /* Storno */
  const confirmStorno = useCallback(
    async (item: InvoiceListItem, reason: string, mode: StornoMode) => {
      const result = await actions.storno(ref(item), reason)
      setStornoTarget(null)
      const storno = result.invoice
      toast.success(`Storno ${storno.number} zu Rechnung ${item.number} erstellt`, {
        description: `${formatEuro(storno.totals.grossCents)} · Rechnung ${item.number} ist jetzt storniert.`
      })
      if (!result.pdf.ok) {
        toast.warning('Das PDF des Stornobelegs wurde noch nicht erstellt', {
          description: result.pdf.error ?? 'Es wird beim nächsten Öffnen automatisch nachgeholt.',
          duration: 12_000
        })
      }
      if (result.print.ok) actions.toastPrint(`Storno ${storno.number}`, result.print)
      else actions.toastPrint(`Storno ${storno.number}`, result.print, () => setPrintTargets([ref(storno)]))
      if (mode === 'recreate') void navigate(`/festbuero?from=${item.id}`)
    },
    [actions, navigate]
  )

  const rowHandlers = useMemo(
    () => ({
      onPreview: (i: InvoiceListItem) => setPreview(i),
      onOpenPdf: (i: InvoiceListItem) => void actions.openPdf(ref(i)),
      onPrint: (i: InvoiceListItem) => setPrintTargets([ref(i)]),
      onExportPdf: (i: InvoiceListItem) => void actions.exportPdf(ref(i)),
      onStorno: (i: InvoiceListItem) => setStornoTarget(i)
    }),
    [actions]
  )

  const total = all.length
  const notAvailable = query.isError && isNotAvailableError(query.error)

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="invoices-page">
      <div className="shrink-0 space-y-3 border-b px-4 pt-4 pb-3 sm:px-6 sm:pt-5">
        <PageHeader
          title="Rechnungen"
          description={
            <span className="block truncate" title={festivalName}>
              {festivalName}
              {total > 0 ? ` · ${belegeLabel(total)}` : ''}
            </span>
          }
          className="[&>div:first-child]:min-w-0 [&>div:first-child]:flex-1"
          actions={
            total > 0 ? (
              <>
                <Button variant="outline" size="sm" onClick={() => void exportExcel()} title="Angezeigte Liste nach Excel exportieren">
                  <FileSpreadsheet aria-hidden />
                  <span className="hidden sm:inline">Excel</span>
                  <span className="sr-only sm:hidden">Excel-Export</span>
                </Button>
                <Button variant="outline" size="sm" onClick={() => void exportZip()} title="PDFs der angezeigten Belege als ZIP exportieren">
                  <FileArchive aria-hidden />
                  <span className="hidden sm:inline">ZIP</span>
                  <span className="sr-only sm:hidden">ZIP-Export</span>
                </Button>
              </>
            ) : null
          }
        />
        {total > 0 ? <ListToolbar ref={searchRef} filters={filters} onChange={updateFilters} /> : null}
        {selectedItems.length > 0 ? (
          <div
            className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2"
            role="toolbar"
            aria-label="Aktionen für die Auswahl"
            data-testid="bulk-bar"
          >
            <span className="mr-auto text-sm font-medium">{selectedItems.length} ausgewählt</span>
            <Button size="sm" onClick={() => setPrintTargets(selectedItems.map(ref))}>
              <Printer aria-hidden />
              Drucken …
            </Button>
            <Button size="sm" variant="outline" onClick={() => void actions.exportZip(selectedItems.map((i) => i.id))}>
              <FileArchive aria-hidden />
              ZIP
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void actions.exportExcel(selectedItems.map((i) => i.id), selectedItems.length)}
            >
              <FileSpreadsheet aria-hidden />
              Excel
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={clearSelection} aria-label="Auswahl aufheben" title="Auswahl aufheben">
              <X aria-hidden />
            </Button>
          </div>
        ) : null}
      </div>

      <div className="@container min-h-0 flex-1 overflow-auto" data-testid="invoice-scroll">
        {query.isLoading ? (
          <div className="space-y-2 p-4 sm:px-6" aria-label="Rechnungen werden geladen">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <div className="p-6 text-center text-sm" role="alert">
            <p className={notAvailable ? 'text-muted-foreground' : 'text-destructive'}>
              {notAvailable
                ? 'Die Rechnungsliste ist noch nicht verfügbar.'
                : `Die Rechnungen konnten nicht geladen werden: ${errorMessage(query.error)}`}
            </p>
          </div>
        ) : total === 0 ? (
          <EmptyState onGo={() => void navigate('/festbuero')} />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center" data-testid="invoices-filter-empty">
            <FilterX className="size-8 text-muted-foreground" aria-hidden />
            <p className="font-medium">Keine Belege für diese Suche bzw. Filter</p>
            <Button variant="outline" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
              Filter zurücksetzen
            </Button>
          </div>
        ) : (
          <InvoiceTable
            items={filtered}
            sort={sort}
            onSort={onSort}
            selected={selected}
            onToggle={onToggle}
            onToggleAll={onToggleAll}
            {...rowHandlers}
          />
        )}
      </div>

      {total > 0 ? (
        <div
          className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t bg-muted/40 px-4 py-2.5 text-sm sm:px-6"
          data-testid="invoice-footer"
        >
          <span className="text-muted-foreground">
            {belegeLabel(summary.count)}
            {filterActive ? ` von ${total}` : ''}
            {filterActive ? (
              <Button variant="link" size="sm" className="ml-1 h-auto p-0" onClick={() => setFilters(EMPTY_FILTERS)}>
                Filter zurücksetzen
              </Button>
            ) : null}
          </span>
          <span>
            <span className="text-muted-foreground">Summe </span>
            <span className="font-semibold tabular-nums" data-testid="invoice-sum">
              {formatEuro(summary.totalCents)}
            </span>
          </span>
        </div>
      ) : null}

      <PreviewDialog
        invoice={preview}
        onOpenChange={(open) => !open && setPreview(null)}
        onOpenPdf={(i) => void actions.openPdf(ref(i))}
        onPrint={(i) => {
          setPreview(null)
          setPrintTargets([ref(i)])
        }}
        onExportPdf={(i) => void actions.exportPdf(ref(i))}
        onStorno={(i) => {
          setPreview(null)
          setStornoTarget(i)
        }}
      />
      <StornoDialog invoice={stornoTarget} onOpenChange={(open) => !open && setStornoTarget(null)} onConfirm={confirmStorno} />
      <PrintDialog
        targets={printTargets}
        copies={copies}
        onOpenChange={(open) => !open && setPrintTargets(null)}
        onConfirm={confirmPrint}
      />
      <PrintResultsDialog
        outcomes={printOutcomes}
        onOpenChange={(open) => !open && setPrintOutcomes(null)}
        onRetry={(failed) => {
          setPrintOutcomes(null)
          setPrintTargets(failed)
        }}
      />
    </div>
  )
}

function EmptyState({ onGo }: { onGo: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-16 text-center" data-testid="invoices-empty">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <ReceiptText className="size-7" aria-hidden />
      </span>
      <div className="max-w-sm space-y-1.5">
        <p className="text-base font-semibold">Noch keine Rechnungen</p>
        <p className="text-sm text-muted-foreground">
          Rechnungen entstehen in der Festbüro-Maske. Sobald eine Rechnung abgeschlossen ist, erscheint sie hier.
        </p>
      </div>
      <Button onClick={onGo}>
        <ReceiptText aria-hidden />
        Zur Festbüro-Maske
      </Button>
    </div>
  )
}
