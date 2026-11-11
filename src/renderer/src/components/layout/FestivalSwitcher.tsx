import { useState } from 'react'
import { ChevronsUpDown, PartyPopper, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { formatDate } from '@shared/dates'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useActiveFestival } from '@/hooks/use-active-festival'
import { errorMessage } from '@/lib/utils'
import { NewFestivalDialog } from './NewFestivalDialog'

/** Auswahl des aktiven Gründungsfests + „Neues Fest anlegen …“ (Kopfleiste). */
export function FestivalSwitcher() {
  const { festival, festivals, setActiveFestival, isLoading } = useActiveFestival()
  const [dialogOpen, setDialogOpen] = useState(false)

  const label = festival ? festival.name : isLoading ? 'Lädt …' : 'Kein Fest angelegt'
  const title = festival ? `${festival.name} – ${formatDate(festival.festivalDate, 'DE')}` : label

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-10 min-w-0 max-w-[10rem] justify-start gap-2 px-2 sm:max-w-[14rem] lg:max-w-[18rem] xl:max-w-[22rem]"
            title={title}
            aria-label={`Aktives Gründungsfest: ${label}. Fest wechseln`}
            data-testid="festival-switcher"
          >
            <PartyPopper className="text-primary" aria-hidden />
            <span className="flex min-w-0 flex-col items-start leading-tight">
              <span className="w-full truncate text-sm font-semibold">{label}</span>
              {festival ? (
                <span className="hidden w-full truncate text-xs font-normal text-muted-foreground lg:block">
                  {formatDate(festival.festivalDate, 'Lang')}
                </span>
              ) : null}
            </span>
            <ChevronsUpDown className="ml-auto opacity-60" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[min(22rem,calc(100vw-1rem))]">
          <DropdownMenuLabel>Gründungsfest wählen</DropdownMenuLabel>
          {festivals.length > 0 ? (
            <DropdownMenuRadioGroup
              value={festival ? String(festival.id) : ''}
              onValueChange={(value) => {
                setActiveFestival(Number(value)).catch((err) => toast.error(errorMessage(err)))
              }}
            >
              {festivals.map((f) => (
                <DropdownMenuRadioItem key={f.id} value={String(f.id)} title={f.name}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{f.name}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(f.festivalDate, 'Lang')}</span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          ) : (
            <p className="px-2 py-2 text-sm text-muted-foreground">Noch kein Gründungsfest angelegt.</p>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDialogOpen(true)} data-testid="festival-new">
            <Plus aria-hidden />
            Neues Fest anlegen …
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NewFestivalDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  )
}
