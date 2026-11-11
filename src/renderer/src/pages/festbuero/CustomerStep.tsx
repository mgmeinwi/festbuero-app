import { useEffect, useId, useMemo, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { Link } from 'react-router'
import { ChevronDown, ChevronUp, Search, User, Users } from 'lucide-react'
import type { EinzelAddress } from '@shared/invoice-draft'
import type { Club, CustomerSnapshot } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { createClubSearcher } from './club-search'
import { StepSection } from './StepSection'

interface CustomerStepProps {
  clubs: Club[] | undefined
  clubsLoading: boolean
  clubsError: string | null
  customer: CustomerSnapshot | null
  /** Suche geöffnet, obwohl schon ein Kunde gewählt ist („Ändern“) */
  searching: boolean
  onSearchingChange: (searching: boolean) => void
  onSelectClub: (club: Club) => void
  onSelectEinzel: () => void
  onEinzelAddressChange: (address: EinzelAddress) => void
  searchInputRef: Ref<HTMLInputElement>
  /** rechts in der Kopfzeile (z. B. „Neu beginnen“) */
  aside?: ReactNode
}

export function CustomerStep(props: CustomerStepProps) {
  const { customer, searching } = props
  const showSearch = !customer || searching
  return (
    <StepSection id="kunde" step={1} title="Kunde" done={!!customer && !searching} aside={props.aside}>
      {showSearch ? (
        <ClubSearch {...props} />
      ) : customer.kind === 'verein' ? (
        <ClubCard
          customer={customer}
          hasInvoice={!!props.clubs?.find((c) => c.id === customer.clubId)?.hasInvoice}
          onChange={() => props.onSearchingChange(true)}
        />
      ) : (
        <EinzelCard
          customer={customer}
          onChange={() => props.onSearchingChange(true)}
          onAddressChange={props.onEinzelAddressChange}
        />
      )}
    </StepSection>
  )
}

function personsLabel(n: number): string {
  return n === 1 ? '1 Person' : `${n} Personen`
}

function ClubSearch({
  clubs,
  clubsLoading,
  clubsError,
  customer,
  onSearchingChange,
  onSelectClub,
  onSelectEinzel,
  searchInputRef
}: CustomerStepProps) {
  const listId = useId()
  const [query, setQuery] = useState('')
  // Ohne Suchbegriff ist kein Treffer vorausgewählt: ein versehentliches Enter wählt nichts aus.
  const [active, setActive] = useState(-1)
  const searcher = useMemo(() => createClubSearcher(clubs ?? []), [clubs])
  const results = useMemo(() => searcher.search(query), [searcher, query])
  const activeIndex = results.length === 0 || active < 0 ? -1 : Math.min(active, results.length - 1)
  const optionId = (club: Club) => `${listId}-club-${club.id}`
  const activeClub = activeIndex >= 0 ? results[activeIndex] : undefined

  const activeOptionId = activeClub ? optionId(activeClub) : null
  useEffect(() => {
    if (activeOptionId) document.getElementById(activeOptionId)?.scrollIntoView({ block: 'nearest' })
  }, [activeOptionId])

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(Math.min(activeIndex + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(Math.max(activeIndex - 1, 0))
    } else if (e.key === 'PageDown') {
      e.preventDefault()
      setActive(Math.min(activeIndex + 5, results.length - 1))
    } else if (e.key === 'PageUp') {
      e.preventDefault()
      setActive(Math.max(activeIndex - 5, 0))
    } else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      if (activeClub) onSelectClub(activeClub)
    } else if (e.key === 'Escape') {
      if (query) {
        e.preventDefault()
        setQuery('')
        setActive(-1)
      } else if (customer) {
        e.preventDefault()
        onSearchingChange(false)
      }
    }
  }

  const noClubs = !clubsLoading && !clubsError && (clubs?.length ?? 0) === 0

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            ref={searchInputRef}
            role="combobox"
            aria-label="Verein suchen"
            aria-expanded={results.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeOptionId ?? undefined}
            placeholder="Verein, Name, Ort oder PLZ …"
            autoComplete="off"
            spellCheck={false}
            className="h-12 pl-11 text-base"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(e.target.value.trim() === '' ? -1 : 0)
            }}
            onKeyDown={onKeyDown}
            data-testid="club-search"
          />
        </div>
        <Button variant="outline" className="h-12 px-4" onClick={onSelectEinzel} data-testid="einzel-button">
          <User aria-hidden />
          Einzelrechnung
        </Button>
        {customer ? (
          <Button variant="ghost" className="h-12" onClick={() => onSearchingChange(false)}>
            Abbrechen
          </Button>
        ) : null}
      </div>

      {clubsLoading ? (
        <div className="space-y-2 rounded-lg border p-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : clubsError ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          Vereine konnten nicht geladen werden: {clubsError}
        </p>
      ) : noClubs ? (
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Für dieses Fest sind noch keine Vereine angelegt.{' '}
          <Link to="/fest/vereine" className="font-medium text-primary underline-offset-4 hover:underline">
            Vereine importieren oder anlegen
          </Link>{' '}
          – oder eine Einzelrechnung erstellen.
        </div>
      ) : (
        <ul
          id={listId}
          role="listbox"
          aria-label="Gefundene Vereine"
          className="max-h-[min(18rem,38vh)] min-h-[3.25rem] overflow-y-auto overscroll-contain rounded-lg border bg-card p-1"
          data-testid="club-results"
        >
          {results.length === 0 ? (
            <li className="px-3 py-3 text-sm text-muted-foreground" role="presentation">
              Kein Verein gefunden. Suchbegriff ändern oder Einzelrechnung wählen.
            </li>
          ) : (
            results.map((club, i) => (
              <li
                key={club.id}
                id={optionId(club)}
                role="option"
                aria-selected={i === activeIndex}
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => i !== activeIndex && setActive(i)}
                onClick={() => onSelectClub(club)}
                className={cn(
                  'flex min-h-12 cursor-pointer items-center gap-3 rounded-md px-3 py-2',
                  i === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium" title={club.clubName}>
                    {club.clubName || '(ohne Vereinsnamen)'}
                  </div>
                  <div className="truncate text-sm text-muted-foreground">
                    {[club.contactName, [club.zip, club.city].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}
                  </div>
                </div>
                {club.hasInvoice ? (
                  <Badge variant="warning" className="hidden @md/mask:inline-flex">
                    bereits abgerechnet
                  </Badge>
                ) : null}
                <div className="shrink-0 text-right text-sm text-muted-foreground tabular-nums">
                  {personsLabel(club.registeredPersons)}
                  {club.hasInvoice ? (
                    <div className="text-xs font-medium text-warning-foreground @md/mask:hidden dark:text-warning">
                      abgerechnet
                    </div>
                  ) : null}
                </div>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

function ClubCard({
  customer,
  hasInvoice,
  onChange
}: {
  customer: CustomerSnapshot
  hasInvoice: boolean
  onChange: () => void
}) {
  const address = [customer.street, [customer.zip, customer.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-3" data-testid="customer-card">
      <span className="hidden size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary @sm/mask:flex">
        <Users className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-semibold" title={customer.clubName}>
            {customer.clubName || customer.contactName}
          </span>
          {hasInvoice ? <Badge variant="warning">bereits abgerechnet</Badge> : null}
        </div>
        <div
          className="truncate text-sm text-muted-foreground"
          title={[customer.contactName, address].filter(Boolean).join(' · ')}
        >
          {[customer.contactName, address].filter(Boolean).join(' · ') || '–'}
        </div>
      </div>
      <Button variant="outline" onClick={onChange} aria-label="Kunde ändern">
        Ändern
      </Button>
    </div>
  )
}

function EinzelCard({
  customer,
  onChange,
  onAddressChange
}: {
  customer: CustomerSnapshot
  onChange: () => void
  onAddressChange: (address: EinzelAddress) => void
}) {
  const hasAddress = !!(customer.contactName || customer.street || customer.zip || customer.city)
  const [open, setOpen] = useState(hasAddress)
  const formId = useId()
  const summary = hasAddress
    ? [customer.contactName, customer.street, [customer.zip, customer.city].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join(', ')
    : 'Im Anschriftfeld steht „Einzelrechnung“.'
  return (
    <div className="rounded-lg border bg-card p-3" data-testid="customer-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="hidden size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary @sm/mask:flex">
          <User className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 basis-40">
          <div className="font-semibold">Einzelrechnung</div>
          <div className="truncate text-sm text-muted-foreground" title={summary}>
            {summary}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={formId}
            className="text-muted-foreground"
          >
            Anschrift
            {open ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
          </Button>
          <Button variant="outline" onClick={onChange} aria-label="Kunde ändern">
            Ändern
          </Button>
        </div>
      </div>
      {open ? (
        <div id={formId} className="mt-3 grid gap-2 @lg/mask:grid-cols-2">
          <AddressField
            label="Name"
            value={customer.contactName}
            onChange={(v) => onAddressChange({ contactName: v })}
            autoFocus={!hasAddress}
          />
          <AddressField label="Straße" value={customer.street} onChange={(v) => onAddressChange({ street: v })} />
          <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 @lg/mask:col-span-2">
            <AddressField label="PLZ" value={customer.zip} onChange={(v) => onAddressChange({ zip: v })} />
            <AddressField label="Ort" value={customer.city} onChange={(v) => onAddressChange({ city: v })} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function AddressField({
  label,
  value,
  onChange,
  autoFocus
}: {
  label: string
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
}) {
  const id = useId()
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        autoFocus={autoFocus}
      />
    </div>
  )
}
