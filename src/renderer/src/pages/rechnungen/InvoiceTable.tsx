/**
 * Tabelle der Rechnungsliste. Spaltenauswahl per Container-Queries (abhängig von der Breite des
 * Inhaltsbereichs, nicht des Fensters): schmal nur Nummer, Kunde, Betrag, Status und „…“-Menü;
 * Datum, Zahlart, Personen, Gedruckt und Direkt-Aktionen kommen mit zunehmender Breite dazu.
 */
import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Check, Eye, FileDown, FileText, MoreHorizontal, Printer, Undo2, X } from 'lucide-react'
import { formatDate, formatDateTime } from '@shared/dates'
import { formatEuro } from '@shared/money'
import type { InvoiceListItem } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { StatusBadge } from './StatusBadge'
import { statusKey, type SortKey, type SortState } from './list-utils'

export interface RowHandlers {
  onPreview: (item: InvoiceListItem) => void
  onOpenPdf: (item: InvoiceListItem) => void
  onPrint: (item: InvoiceListItem) => void
  onExportPdf: (item: InvoiceListItem) => void
  onStorno: (item: InvoiceListItem) => void
}

interface InvoiceTableProps extends RowHandlers {
  items: InvoiceListItem[]
  sort: SortState
  onSort: (key: SortKey) => void
  selected: ReadonlySet<number>
  onToggle: (id: number, checked: boolean) => void
  onToggleAll: (checked: boolean) => void
}

/* Sichtbarkeit der Spalten (Container-Breite des Scrollbereichs) */
const COL_DATE = 'hidden @2xl:table-cell'
const COL_PAYMENT = 'hidden @3xl:table-cell'
const COL_PERSONS = 'hidden @4xl:table-cell'
const COL_PRINTED = 'hidden @4xl:table-cell'

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  className,
  align = 'left',
  children
}: {
  label: string
  sortKey: SortKey
  sort: SortState
  onSort: (key: SortKey) => void
  className?: string
  align?: 'left' | 'right'
  /** abweichender Inhalt (z. B. Symbol bei schmaler Breite); `label` bleibt Tooltip/Name */
  children?: ReactNode
}) {
  const active = sort.key === sortKey
  const Icon = active ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('sticky top-0 z-10 h-10 bg-background px-2 text-left align-middle font-medium whitespace-nowrap', className)}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          '-mx-1 inline-flex h-8 items-center gap-1 rounded px-1 text-muted-foreground hover:text-foreground focus-visible:text-foreground',
          align === 'right' && 'flex-row-reverse',
          active && 'text-foreground'
        )}
        title={`Nach ${label} sortieren`}
        aria-label={children ? label : undefined}
      >
        {children ?? label}
        <Icon className={cn('size-3.5', !active && 'opacity-40')} aria-hidden />
      </button>
    </th>
  )
}

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" onClick={onClick} aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function RowActions({ item, handlers }: { item: InvoiceListItem; handlers: RowHandlers }) {
  const canStorno = statusKey(item) === 'abgeschlossen'
  return (
    <div className="flex items-center justify-end gap-0.5">
      <span className="hidden @3xl:contents">
        <IconAction label={`Vorschau ${item.number}`} onClick={() => handlers.onPreview(item)}>
          <Eye aria-hidden />
        </IconAction>
      </span>
      <span className="hidden @6xl:contents">
        <IconAction label={`PDF ${item.number} öffnen`} onClick={() => handlers.onOpenPdf(item)}>
          <FileText aria-hidden />
        </IconAction>
        <IconAction label={`${item.number} erneut drucken`} onClick={() => handlers.onPrint(item)}>
          <Printer aria-hidden />
        </IconAction>
      </span>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Aktionen für ${item.number}`} data-testid="row-actions">
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="tabular-nums">
            {item.type === 'storno' ? 'Storno' : 'Rechnung'} {item.number}
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => handlers.onPreview(item)}>
            <Eye aria-hidden />
            Vorschau
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => handlers.onOpenPdf(item)}>
            <FileText aria-hidden />
            PDF öffnen
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => handlers.onPrint(item)}>
            <Printer aria-hidden />
            Erneut drucken …
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => handlers.onExportPdf(item)}>
            <FileDown aria-hidden />
            PDF exportieren …
          </DropdownMenuItem>
          {canStorno ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => handlers.onStorno(item)}>
                <Undo2 aria-hidden />
                Stornieren …
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function InvoiceTable({ items, sort, onSort, selected, onToggle, onToggleAll, ...handlers }: InvoiceTableProps) {
  const selectedCount = items.reduce((n, i) => n + (selected.has(i.id) ? 1 : 0), 0)
  const allState: boolean | 'indeterminate' =
    items.length > 0 && selectedCount === items.length ? true : selectedCount > 0 ? 'indeterminate' : false

  return (
    <table className="w-full table-fixed border-separate border-spacing-0 text-sm" data-testid="invoice-table">
      <thead className="[&_th]:border-b">
        <tr>
          <th scope="col" className="sticky top-0 z-10 h-10 w-11 bg-background pr-1 pl-3 text-left align-middle">
            <Checkbox
              checked={allState}
              onCheckedChange={(v) => onToggleAll(v === true)}
              aria-label="Alle angezeigten Belege auswählen"
              disabled={items.length === 0}
              data-testid="select-all"
            />
          </th>
          <SortHeader label="Nummer" sortKey="number" sort={sort} onSort={onSort} className="w-28" />
          <SortHeader label="Datum" sortKey="date" sort={sort} onSort={onSort} className={cn(COL_DATE, 'w-24')} />
          <SortHeader label="Kunde" sortKey="customer" sort={sort} onSort={onSort} />
          <SortHeader label="Personen" sortKey="persons" sort={sort} onSort={onSort} className={cn(COL_PERSONS, 'w-24 text-right')} align="right" />
          <SortHeader label="Zahlart" sortKey="payment" sort={sort} onSort={onSort} className={cn(COL_PAYMENT, 'w-28')} />
          <SortHeader label="Betrag" sortKey="amount" sort={sort} onSort={onSort} className="w-28 text-right" align="right" />
          <SortHeader label="Status" sortKey="status" sort={sort} onSort={onSort} className="w-[8.5rem]" />
          <SortHeader label="Gedruckt" sortKey="printed" sort={sort} onSort={onSort} className={cn(COL_PRINTED, 'w-14 @6xl:w-24')}>
            <Printer className="size-4 @6xl:hidden" aria-hidden />
            <span className="hidden @6xl:inline">Gedruckt</span>
          </SortHeader>
          <th scope="col" className="sticky top-0 z-10 h-10 w-12 bg-background px-2 @3xl:w-[5.5rem] @6xl:w-[8rem]">
            <span className="sr-only">Aktionen</span>
          </th>
        </tr>
      </thead>
      <tbody className="[&_td]:border-b [&_tr:last-child_td]:border-b-0">
        {items.map((item) => {
          const isSelected = selected.has(item.id)
          const key = statusKey(item)
          return (
            <tr
              key={item.id}
              data-state={isSelected ? 'selected' : undefined}
              data-testid="invoice-row"
              data-number={item.number}
              className="group transition-colors hover:bg-muted/50 data-[state=selected]:bg-primary/5"
            >
              <td className="py-2 pr-1 pl-3 align-middle">
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={(v) => onToggle(item.id, v === true)}
                  aria-label={`${item.number} auswählen`}
                />
              </td>
              <td className="px-2 py-2 align-middle">
                <button
                  type="button"
                  onClick={() => handlers.onPreview(item)}
                  className="rounded font-medium tabular-nums hover:text-primary hover:underline focus-visible:text-primary"
                  title={`Vorschau ${item.number}`}
                >
                  {item.number}
                </button>
                <div className="text-xs text-muted-foreground tabular-nums @2xl:hidden">
                  {formatDate(item.invoiceDate, 'DE')}
                </div>
              </td>
              <td className={cn('px-2 py-2 align-middle tabular-nums', COL_DATE)}>{formatDate(item.invoiceDate, 'DE')}</td>
              <td className="min-w-0 px-2 py-2 align-middle">
                <div className="truncate" title={item.customerLabel}>
                  {item.customerLabel}
                </div>
                <div className="truncate text-xs text-muted-foreground @3xl:hidden">
                  {item.paymentLabel}
                  {item.persons !== null ? ` · ${item.persons} P.` : ''}
                </div>
              </td>
              <td className={cn('px-2 py-2 text-right align-middle tabular-nums', COL_PERSONS)}>
                {item.persons ?? <span className="text-muted-foreground">–</span>}
              </td>
              <td className={cn('truncate px-2 py-2 align-middle', COL_PAYMENT)} title={item.paymentLabel}>
                {item.paymentLabel}
              </td>
              <td
                className={cn(
                  'px-2 py-2 text-right align-middle font-medium whitespace-nowrap tabular-nums',
                  key === 'storniert' && 'text-muted-foreground line-through decoration-muted-foreground/60',
                  item.totalGrossCents < 0 && 'text-destructive'
                )}
              >
                {formatEuro(item.totalGrossCents)}
              </td>
              <td className="px-2 py-2 align-middle">
                <StatusBadge item={item} />
              </td>
              <td className={cn('px-2 py-2 align-middle', COL_PRINTED)}>
                {item.printed ? (
                  <span
                    className="inline-flex items-center gap-1 text-success"
                    title={item.printedAt ? `Gedruckt am ${formatDateTime(item.printedAt)}` : 'Gedruckt'}
                  >
                    <Check className="size-4" aria-hidden />
                    <span className="sr-only @6xl:not-sr-only">ja</span>
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center gap-1 text-warning-foreground dark:text-warning"
                    title="Nicht gedruckt – über „Erneut drucken“ nachholen"
                  >
                    <X className="size-4" aria-hidden />
                    <span className="sr-only @6xl:not-sr-only">nein</span>
                  </span>
                )}
              </td>
              <td className="py-2 pr-2 pl-1 align-middle">
                <RowActions item={item} handlers={handlers} />
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
