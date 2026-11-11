/**
 * Suche und Filter der Rechnungsliste: Suchfeld (Nummer, Kunde), Zeitraum (von/bis, „Heute“, „Alle“),
 * Zahlart, Status. Bricht bei schmalen Fenstern um.
 */
import { forwardRef, useState } from 'react'
import { CalendarRange, Search, X } from 'lucide-react'
import { todayIso } from '@shared/dates'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn, modKey } from '@/lib/utils'
import { describeRange, type ListFilters, type PaymentFilter, type StatusFilter } from './list-utils'

interface ListToolbarProps {
  filters: ListFilters
  onChange: (patch: Partial<ListFilters>) => void
}

export const ListToolbar = forwardRef<HTMLInputElement, ListToolbarProps>(function ListToolbar(
  { filters, onChange },
  searchRef
) {
  const today = todayIso()
  const [rangeOpen, setRangeOpen] = useState(false)
  const rangeActive = filters.from !== '' || filters.to !== ''
  const rangeInvalid = filters.from !== '' && filters.to !== '' && filters.from > filters.to

  return (
    <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Rechnungen filtern">
      <div className="relative min-w-0 basis-full sm:basis-64 sm:grow">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          ref={searchRef}
          type="search"
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && filters.search) {
              e.preventDefault()
              onChange({ search: '' })
            }
          }}
          placeholder="Nummer oder Kunde suchen …"
          aria-label="Rechnungen durchsuchen (Nummer, Kunde)"
          title={`Suchen (${modKey}+F)`}
          className="pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden"
          data-testid="invoice-search"
        />
        {filters.search ? (
          <button
            type="button"
            onClick={() => onChange({ search: '' })}
            className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Suche leeren"
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>

      <Popover open={rangeOpen} onOpenChange={setRangeOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn('min-w-0 shrink justify-start', rangeActive && 'border-primary/50 text-primary')}
            aria-label={`Zeitraum: ${describeRange(filters.from, filters.to, today)}`}
            data-testid="filter-range"
          >
            <CalendarRange aria-hidden />
            <span className="truncate">{describeRange(filters.from, filters.to, today)}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))] space-y-3">
          <p className="text-sm font-medium">Zeitraum (Rechnungsdatum)</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="filter-from" className="text-xs text-muted-foreground">
                Von
              </Label>
              <Input
                id="filter-from"
                type="date"
                value={filters.from}
                max={filters.to || undefined}
                onChange={(e) => onChange({ from: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-to" className="text-xs text-muted-foreground">
                Bis
              </Label>
              <Input
                id="filter-to"
                type="date"
                value={filters.to}
                min={filters.from || undefined}
                onChange={(e) => onChange({ to: e.target.value })}
              />
            </div>
          </div>
          {rangeInvalid ? <p className="text-xs text-destructive">„Von“ liegt nach „Bis“.</p> : null}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={filters.from === today && filters.to === today ? 'default' : 'outline'}
              className="flex-1"
              onClick={() => {
                onChange({ from: today, to: today })
                setRangeOpen(false)
              }}
            >
              Heute
            </Button>
            <Button
              size="sm"
              variant={!rangeActive ? 'default' : 'outline'}
              className="flex-1"
              onClick={() => {
                onChange({ from: '', to: '' })
                setRangeOpen(false)
              }}
            >
              Alle
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <Select value={filters.payment} onValueChange={(v) => onChange({ payment: v as PaymentFilter })}>
        <SelectTrigger
          className={cn('min-w-0 shrink', filters.payment !== 'all' && 'border-primary/50 text-primary')}
          aria-label="Zahlart"
          data-testid="filter-payment"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Alle Zahlarten</SelectItem>
          <SelectItem value="bar">Bar</SelectItem>
          <SelectItem value="ueberweisung">Überweisung</SelectItem>
        </SelectContent>
      </Select>

      <Select value={filters.status} onValueChange={(v) => onChange({ status: v as StatusFilter })}>
        <SelectTrigger
          className={cn('min-w-0 shrink', filters.status !== 'all' && 'border-primary/50 text-primary')}
          aria-label="Status"
          data-testid="filter-status"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Alle Status</SelectItem>
          <SelectItem value="abgeschlossen">abgeschlossen</SelectItem>
          <SelectItem value="storniert">storniert</SelectItem>
          <SelectItem value="storno">Storno</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
})
