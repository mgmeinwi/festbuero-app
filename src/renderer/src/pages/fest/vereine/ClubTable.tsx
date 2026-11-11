import { ArrowDown, ArrowUp, ChevronsUpDown, Ellipsis, Pencil, ReceiptText, Trash2 } from 'lucide-react'
import type { Club } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { formatNumber, formatPlace, type ClubSort, type ClubSortKey } from './club-list'

/*
 * Spalten je nach Breite der Tabelle (Container-Queries, unabhängig von der Seitenleiste):
 *   immer      Verein (+ Ansprechpartner/Ort als zweite Zeile, solange die Spalten fehlen), Personen
 *   ≥ @2xl     PLZ Ort
 *   ≥ @3xl     Ansprechpartner, Aktionen als Buttons (sonst „…“-Menü)
 *   ≥ @4xl     Status (Quelle + Rechnung vorhanden; sonst nur Rechnungs-Badge neben dem Namen)
 */

interface ClubTableProps {
  clubs: Club[]
  sort: ClubSort
  onSortChange: (key: ClubSortKey) => void
  onEdit: (club: Club) => void
  onDelete: (club: Club) => void
}

export function ClubTable({ clubs, sort, onSortChange, onEdit, onDelete }: ClubTableProps) {
  const header = (key: ClubSortKey, label: string, className?: string, align: 'left' | 'right' = 'left') => (
    <SortableHead sortKey={key} label={label} sort={sort} onSortChange={onSortChange} className={className} align={align} />
  )

  return (
    <div className="@container overflow-hidden rounded-xl border bg-card" data-testid="club-table">
      <Table>
        <TableHeader className="bg-muted/40">
          <TableRow className="hover:bg-transparent">
            {header('clubName', 'Verein', 'w-full pl-2.5')}
            {header('contactName', 'Ansprechpartner', 'hidden @3xl:table-cell')}
            {header('place', 'PLZ Ort', 'hidden @2xl:table-cell')}
            {header('registeredPersons', 'Personen', 'pr-2.5', 'right')}
            {header('status', 'Status', 'hidden @4xl:table-cell')}
            <TableHead className="pr-3">
              <span className="sr-only">Aktionen</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {clubs.map((club) => (
            <ClubRow key={club.id} club={club} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function SortableHead({
  sortKey,
  label,
  sort,
  onSortChange,
  className,
  align
}: {
  sortKey: ClubSortKey
  label: string
  sort: ClubSort
  onSortChange: (key: ClubSortKey) => void
  className?: string
  align: 'left' | 'right'
}) {
  const active = sort.key === sortKey
  const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
  const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
  return (
    <TableHead className={cn('px-1.5', align === 'right' && 'text-right', className)} aria-sort={ariaSort}>
      <button
        type="button"
        onClick={() => onSortChange(sortKey)}
        className={cn(
          'inline-flex h-9 max-w-full items-center gap-1 rounded-md px-1.5 font-medium outline-none transition-colors',
          'hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60',
          align === 'right' && 'flex-row-reverse',
          active && 'text-foreground'
        )}
        title={`Nach „${label}“ sortieren`}
      >
        <span className="truncate">{label}</span>
        <Icon className={cn('size-3.5 shrink-0', !active && 'opacity-50')} aria-hidden />
      </button>
    </TableHead>
  )
}

function SourceBadge({ club }: { club: Club }) {
  return club.source === 'import' ? (
    <Badge variant="secondary" title="Aus dem Excel-Import">
      Import
    </Badge>
  ) : (
    <Badge variant="outline" title="Manuell angelegt">
      Manuell
    </Badge>
  )
}

function InvoiceBadge({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <Badge variant="success" className={className} title="Für diesen Verein gibt es bereits eine Rechnung">
      <ReceiptText aria-hidden />
      {compact ? <span className="sr-only @md:not-sr-only">Rechnung</span> : 'Rechnung vorhanden'}
    </Badge>
  )
}

function ClubRow({ club, onEdit, onDelete }: { club: Club; onEdit: (c: Club) => void; onDelete: (c: Club) => void }) {
  const place = formatPlace(club)
  return (
    <TableRow
      data-testid="club-row"
      data-club-id={club.id}
      className="group"
      onDoubleClick={() => onEdit(club)}
    >
      {/* max-w-0 + w-full: Spalte nimmt den Restplatz, langer Text wird gekürzt */}
      <TableCell className="w-full max-w-0 pl-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium" title={club.clubName} data-testid="club-name">
            {club.clubName}
          </span>
          {club.hasInvoice ? <InvoiceBadge compact className="@4xl:hidden" /> : null}
        </div>
        {club.contactName || place ? (
          <div className="truncate text-xs text-muted-foreground @3xl:hidden">
            {club.contactName ? <span>{club.contactName}</span> : null}
            {place ? (
              <span className="@2xl:hidden">
                {club.contactName ? ' · ' : ''}
                {place}
              </span>
            ) : null}
          </div>
        ) : null}
      </TableCell>
      <TableCell className="hidden px-3 @3xl:table-cell">
        <span className="block max-w-[11rem] truncate @5xl:max-w-[14rem]" title={club.contactName || undefined}>
          {club.contactName || <span className="text-muted-foreground">–</span>}
        </span>
      </TableCell>
      <TableCell className="hidden px-3 @2xl:table-cell">
        <span className="block max-w-[10rem] truncate @3xl:max-w-[12rem] @5xl:max-w-[15rem]" title={place || undefined}>
          {place || <span className="text-muted-foreground">–</span>}
        </span>
      </TableCell>
      <TableCell className="pr-4 text-right font-medium tabular-nums" data-testid="club-persons">
        {formatNumber(club.registeredPersons)}
      </TableCell>
      <TableCell className="hidden @4xl:table-cell">
        <div className="flex items-center gap-1.5">
          <SourceBadge club={club} />
          {club.hasInvoice ? <InvoiceBadge /> : null}
        </div>
      </TableCell>
      <TableCell className="pr-3 text-right">
        <div className="hidden justify-end gap-1 @3xl:flex">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={() => onEdit(club)} aria-label={`„${club.clubName}“ bearbeiten`}>
                <Pencil />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Bearbeiten</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={() => onDelete(club)}
                aria-label={`„${club.clubName}“ löschen`}
              >
                <Trash2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Löschen</TooltipContent>
          </Tooltip>
        </div>
        <div className="flex justify-end @3xl:hidden">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Aktionen für „${club.clubName}“`}>
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <div className="px-2 py-1.5">
                <SourceBadge club={club} />
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onEdit(club)}>
                <Pencil /> Bearbeiten
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => onDelete(club)}>
                <Trash2 /> Löschen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  )
}
