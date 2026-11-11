/**
 * Route: /auswertung – Auswertung des aktiven Fests (Bereich „Liste & Auswertung“).
 *
 * Kennzahlen, Umsatz/Menge pro Produkt, Steuersätze (wenn relevant), Umsatz pro Tag, Vereine ohne
 * Rechnung (Klick → Festbüro-Maske mit Verein). Stornos sind in allen Summen gegengerechnet.
 * Excel-Export per Button und Menüaktion `evaluation.exportExcel`.
 */
import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import {
  Banknote,
  ChevronRight,
  CircleCheck,
  FileSpreadsheet,
  Landmark,
  Loader2,
  ReceiptText,
  Undo2,
  Users,
  Wallet
} from 'lucide-react'
import { formatDate } from '@shared/dates'
import { formatEuro } from '@shared/money'
import type { EvaluationData } from '@shared/types'
import { PageContainer, PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { queryKeys } from '@/hooks/query-keys'
import { useActiveFestival } from '@/hooks/use-active-festival'
import { api, isNotAvailableError } from '@/lib/api'
import { useMenuAction } from '@/lib/menu-actions'
import { cn, errorMessage } from '@/lib/utils'
import { EmptyNote, Section, ShareBar, StatTile } from './parts'

const numberFormat = new Intl.NumberFormat('de-DE')

function percentOf(part: number, total: number): string {
  if (total <= 0) return '–'
  return `${Math.round((part / total) * 100)} %`
}

/** Unterzeile der Zahlart-Kacheln: Anteil am Umsatz (ohne Umsatz kein Prozentwert). */
function shareSub(part: number, total: number): string {
  return total > 0 ? `davon ${percentOf(part, total)} vom Umsatz` : 'noch kein Umsatz'
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

export default function AuswertungPage() {
  const { festival } = useActiveFestival()
  if (!festival) return null
  return <EvaluationPage key={festival.id} festivalId={festival.id} festivalName={festival.name} />
}

function EvaluationPage({ festivalId, festivalName }: { festivalId: number; festivalName: string }) {
  const navigate = useNavigate()
  const [exporting, setExporting] = useState(false)
  const query = useQuery({
    queryKey: queryKeys.evaluation(festivalId),
    queryFn: () => api.evaluation.get(festivalId),
    staleTime: 0
  })
  const clubs = useQuery({
    queryKey: queryKeys.clubs(festivalId),
    queryFn: () => api.clubs.list(festivalId)
  })

  const exportExcel = useCallback(async () => {
    if (exporting) return
    setExporting(true)
    try {
      const path = await api.evaluation.exportExcel(festivalId)
      if (path) {
        toast.success('Auswertung gespeichert', {
          description: baseName(path),
          action: {
            label: 'Im Ordner zeigen',
            onClick: () => {
              api.app.showItemInFolder(path).catch((err: unknown) => toast.error(errorMessage(err)))
            }
          }
        })
      }
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setExporting(false)
    }
  }, [festivalId, exporting])

  useMenuAction('evaluation.exportExcel', exportExcel)

  const data = query.data
  return (
    <div className="@container" data-testid="evaluation-page">
      <PageContainer className="max-w-7xl">
        <PageHeader
          title="Auswertung"
          description={
            <span className="block truncate" title={festivalName}>
              {festivalName} · Stornos gegengerechnet
            </span>
          }
          className="[&>div:first-child]:min-w-0 [&>div:first-child]:flex-1"
          actions={
            <Button onClick={() => void exportExcel()} disabled={exporting || !data} data-testid="evaluation-export">
              {exporting ? <Loader2 className="animate-spin" aria-hidden /> : <FileSpreadsheet aria-hidden />}
              Nach Excel exportieren
            </Button>
          }
        />

        {query.isLoading ? (
          <LoadingState />
        ) : query.isError || !data ? (
          <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground" role="alert">
            {isNotAvailableError(query.error)
              ? 'Die Auswertung ist noch nicht verfügbar.'
              : `Die Auswertung konnte nicht geladen werden: ${errorMessage(query.error)}`}
          </p>
        ) : (
          <EvaluationContent
            data={data}
            clubCount={clubs.data?.length ?? null}
            onClub={(id) => void navigate(`/festbuero?club=${id}`)}
            onGoClubs={() => void navigate('/fest/vereine')}
          />
        )}
      </PageContainer>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="space-y-6" aria-label="Auswertung wird geladen">
      <div className="grid grid-cols-2 gap-3 @xl:grid-cols-3 @6xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-[6.25rem]" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  )
}

function EvaluationContent({
  data,
  clubCount,
  onClub,
  onGoClubs
}: {
  data: EvaluationData
  clubCount: number | null
  onClub: (id: number) => void
  onGoClubs: () => void
}) {
  const hasDocs = data.invoiceCount + data.stornoCount > 0
  const maxProduct = Math.max(0, ...data.products.map((p) => Math.abs(p.grossCents)))
  const maxDay = Math.max(0, ...data.perDay.map((d) => Math.abs(d.grossCents)))
  const productTotal = data.products.reduce((s, p) => s + p.grossCents, 0)
  const showTax = data.showTaxRates ?? data.taxRates.some((t) => t.vatCents !== 0)
  const taxTotals = data.taxRates.reduce(
    (acc, t) => ({ net: acc.net + t.netCents, vat: acc.vat + t.vatCents, gross: acc.gross + t.grossCents }),
    { net: 0, vat: 0, gross: 0 }
  )

  return (
    <div className="space-y-6">
      {/* Kennzahlen */}
      <div className="grid grid-cols-2 gap-3 @xl:grid-cols-3 @6xl:grid-cols-6" data-testid="evaluation-kpis">
        <StatTile label="Rechnungen" value={numberFormat.format(data.invoiceCount)} sub="inkl. stornierter" icon={ReceiptText} testId="kpi-invoices" />
        <StatTile label="Stornos" value={numberFormat.format(data.stornoCount)} sub="gegengerechnet" icon={Undo2} testId="kpi-stornos" />
        <StatTile label="Gesamtumsatz" value={formatEuro(data.totalGrossCents)} sub="nach Stornos" icon={Wallet} emphasis testId="kpi-total" />
        <StatTile
          label="Bar"
          value={formatEuro(data.cashCents)}
          sub={shareSub(data.cashCents, data.totalGrossCents)}
          icon={Banknote}
          testId="kpi-cash"
        />
        <StatTile
          label="Überweisung"
          value={formatEuro(data.transferCents)}
          sub={shareSub(data.transferCents, data.totalGrossCents)}
          icon={Landmark}
          testId="kpi-transfer"
        />
        <StatTile label="Personen" value={numberFormat.format(data.persons)} sub="abgerechnet" icon={Users} testId="kpi-persons" />
      </div>

      <div className="grid gap-6 @5xl:grid-cols-5 @5xl:items-start">
        {/* Produkte */}
        <Section
          title="Umsatz und Menge pro Produkt"
          description="Zusatzpositionen stehen am Ende."
          className="@5xl:col-span-3"
          testId="evaluation-products"
        >
          {data.products.length === 0 ? (
            <EmptyNote>Noch keine Rechnungen – Umsätze erscheinen hier nach dem ersten Abschluss.</EmptyNote>
          ) : (
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Produkt
                  </th>
                  <th scope="col" className="w-20 px-2 py-2 text-right font-medium">
                    Menge
                  </th>
                  <th scope="col" className="w-32 py-2 pr-4 pl-2 text-right font-medium">
                    Umsatz
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.products.map((p, idx) => (
                  <tr key={`${p.productId ?? 'x'}-${p.name}-${idx}`} className="border-b last:border-0" data-testid="product-row">
                    <td className="min-w-0 px-4 py-2.5 align-top">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate" title={p.name}>
                          {p.name}
                        </span>
                        {p.productId === null ? (
                          <Badge variant="secondary" className="shrink-0">
                            Zusatz
                          </Badge>
                        ) : null}
                      </div>
                      <ShareBar
                        value={p.grossCents}
                        max={maxProduct}
                        label={`${p.name}: ${formatEuro(p.grossCents)} (${percentOf(p.grossCents, productTotal)} vom Umsatz)`}
                      />
                    </td>
                    <td className="px-2 py-2.5 text-right align-top tabular-nums">{numberFormat.format(p.quantity)}</td>
                    <td className={cn('py-2.5 pr-4 pl-2 text-right align-top font-medium whitespace-nowrap tabular-nums', p.grossCents < 0 && 'text-destructive')}>
                      {formatEuro(p.grossCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/40">
                  <th scope="row" colSpan={2} className="px-4 py-2.5 text-left font-medium">
                    Summe
                  </th>
                  <td className="py-2.5 pr-4 pl-2 text-right font-semibold whitespace-nowrap tabular-nums">{formatEuro(productTotal)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </Section>

        <div className="flex min-w-0 flex-col gap-6 @5xl:col-span-2">
          {/* Pro Tag */}
          <Section title="Umsatz pro Tag" description="nach Rechnungsdatum" testId="evaluation-days">
            {data.perDay.length === 0 ? (
              <EmptyNote>Noch keine Rechnungen.</EmptyNote>
            ) : (
              <table className="w-full table-fixed text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th scope="col" className="px-4 py-2 text-left font-medium">
                      Tag
                    </th>
                    <th scope="col" className="w-24 px-2 py-2 text-right font-medium">
                      Rechnungen
                    </th>
                    <th scope="col" className="w-32 py-2 pr-4 pl-2 text-right font-medium">
                      Umsatz
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.perDay.map((d) => (
                    <tr key={d.date} className="border-b last:border-0" data-testid="day-row">
                      <td className="min-w-0 px-4 py-2.5 align-top">
                        <span className="truncate tabular-nums">{formatDate(d.date, 'EEE, dd.MM.yyyy')}</span>
                        <ShareBar value={d.grossCents} max={maxDay} label={`${formatDate(d.date, 'DE')}: ${formatEuro(d.grossCents)}`} />
                      </td>
                      <td className="px-2 py-2.5 text-right align-top tabular-nums">{numberFormat.format(d.invoiceCount)}</td>
                      <td className={cn('py-2.5 pr-4 pl-2 text-right align-top font-medium whitespace-nowrap tabular-nums', d.grossCents < 0 && 'text-destructive')}>
                        {formatEuro(d.grossCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          {/* Steuersätze */}
          {showTax ? (
            <Section title="Umsatz nach Steuersatz" description="aus den Summen der einzelnen Belege" testId="evaluation-tax">
              {data.taxRates.length === 0 ? (
                <EmptyNote>Noch keine Umsätze.</EmptyNote>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th scope="col" className="px-4 py-2 text-left font-medium">
                          Satz
                        </th>
                        <th scope="col" className="px-2 py-2 text-right font-medium">
                          Netto
                        </th>
                        <th scope="col" className="px-2 py-2 text-right font-medium">
                          MwSt
                        </th>
                        <th scope="col" className="py-2 pr-4 pl-2 text-right font-medium">
                          Brutto
                        </th>
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {data.taxRates.map((t) => (
                        <tr key={t.rate} className="border-b last:border-0" data-testid="tax-row">
                          <td className="px-4 py-2.5">{t.rate} %</td>
                          <td className="px-2 py-2.5 text-right whitespace-nowrap">{formatEuro(t.netCents)}</td>
                          <td className="px-2 py-2.5 text-right whitespace-nowrap">{formatEuro(t.vatCents)}</td>
                          <td className="py-2.5 pr-4 pl-2 text-right font-medium whitespace-nowrap">{formatEuro(t.grossCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="tabular-nums">
                      <tr className="border-t bg-muted/40">
                        <th scope="row" className="px-4 py-2.5 text-left font-medium">
                          Summe
                        </th>
                        <td className="px-2 py-2.5 text-right whitespace-nowrap">{formatEuro(taxTotals.net)}</td>
                        <td className="px-2 py-2.5 text-right whitespace-nowrap">{formatEuro(taxTotals.vat)}</td>
                        <td className="py-2.5 pr-4 pl-2 text-right font-semibold whitespace-nowrap">{formatEuro(taxTotals.gross)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </Section>
          ) : null}
        </div>
      </div>

      {/* Vereine ohne Rechnung */}
      <Section
        title={
          <span className="flex items-center gap-2">
            Vereine ohne Rechnung
            <Badge variant={data.clubsWithoutInvoice.length > 0 ? 'warning' : 'success'} data-testid="clubs-without-count">
              {data.clubsWithoutInvoice.length}
            </Badge>
          </span>
        }
        description="Vereine aus dem Stamm ohne gültige Rechnung. Ein Klick öffnet die Festbüro-Maske mit dem Verein."
        testId="evaluation-clubs"
      >
        {data.clubsWithoutInvoice.length === 0 ? (
          clubCount === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-sm text-muted-foreground">
              Es ist noch kein Vereinsstamm angelegt.
              <Button variant="outline" size="sm" onClick={onGoClubs}>
                Zum Vereinsstamm
              </Button>
            </div>
          ) : (
            <p className="flex items-center justify-center gap-2 px-4 py-8 text-center text-sm text-muted-foreground">
              <CircleCheck className="size-4 text-success" aria-hidden />
              {hasDocs ? 'Alle Vereine aus dem Stamm haben eine Rechnung.' : 'Keine offenen Vereine.'}
            </p>
          )
        ) : (
          <ul className="grid gap-2 p-3 @2xl:grid-cols-2 @5xl:grid-cols-3">
            {data.clubsWithoutInvoice.map((club) => (
              <li key={club.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => onClub(club.id)}
                  className="group flex w-full min-w-0 items-center gap-3 rounded-lg border bg-background px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-accent focus-visible:border-ring"
                  title={`Rechnung für ${club.clubName} erstellen`}
                  data-testid="club-without-invoice"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium" title={club.clubName}>
                      {club.clubName}
                    </div>
                    <div className="flex min-w-0 items-baseline justify-between gap-3 text-xs text-muted-foreground">
                      <span className="truncate">{[club.contactName, club.city].filter(Boolean).join(' · ') || '–'}</span>
                      <span className="shrink-0 tabular-nums">angemeldet: {club.registeredPersons}</span>
                    </div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
