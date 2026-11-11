import { Printer, RefreshCw, TriangleAlert } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { queryKeys } from '@/hooks/query-keys'
import { useAppSettings } from '@/hooks/use-app-settings'
import { usePrinters, usePrinterStatus } from '@/hooks/use-printers'
import { cn, errorMessage } from '@/lib/utils'

/** Warnsymbol, wenn der gespeicherte Drucker nicht verfügbar ist. */
export function PrinterWarning() {
  const { data: status } = usePrinterStatus()
  if (!status?.printer || status.available) return null
  const text = `Der gespeicherte Drucker „${status.printer}“ ist nicht verfügbar. Bitte einen anderen Drucker wählen.`
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="status"
          tabIndex={0}
          aria-label={text}
          data-testid="printer-warning"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-warning/25 px-2 text-sm font-medium text-warning-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60 dark:bg-warning/20 dark:text-warning"
        >
          <TriangleAlert className="size-4" aria-hidden />
          <span className="hidden xl:inline">Drucker nicht verfügbar</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Druckerauswahl (sofort änderbar, speichert `defaultPrinter` pro Rechner).
 * < md: nur Icon-Button; ab md: Icon + gekürzter Name.
 */
export function PrinterMenu() {
  const queryClient = useQueryClient()
  const { settings, updateSettings } = useAppSettings()
  const { data: printers = [], isLoading, isError } = usePrinters()
  const { data: status } = usePrinterStatus()

  const current = settings?.defaultPrinter ?? null
  const currentInfo = printers.find((p) => p.name === current)
  const unavailable = !!current && status?.available === false
  const label = current ? (currentInfo?.displayName ?? current) : 'Kein Drucker gewählt'
  const title = current ? `Drucker: ${label}${unavailable ? ' (nicht verfügbar)' : ''}` : 'Drucker wählen'

  async function select(name: string) {
    try {
      await updateSettings({ defaultPrinter: name })
      const display = printers.find((p) => p.name === name)?.displayName ?? name
      toast.success(`Drucker „${display}“ ausgewählt.`)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-9 min-w-0 max-w-[13rem] gap-2 px-2.5 lg:max-w-[16rem]"
          title={title}
          aria-label={title}
          data-testid="printer-menu"
        >
          <Printer className={cn(unavailable ? 'text-warning-foreground dark:text-warning' : 'text-muted-foreground')} aria-hidden />
          <span className={cn('hidden truncate text-sm md:inline', !current && 'text-muted-foreground')}>{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(20rem,calc(100vw-1rem))]">
        <DropdownMenuLabel>Drucker für „Abschließen &amp; drucken“</DropdownMenuLabel>
        {isLoading ? <p className="px-2 py-2 text-sm text-muted-foreground">Drucker werden gesucht …</p> : null}
        {isError ? <p className="px-2 py-2 text-sm text-destructive">Druckerliste nicht verfügbar.</p> : null}
        {!isLoading && !isError && printers.length === 0 ? (
          <p className="px-2 py-2 text-sm text-muted-foreground">Kein Drucker installiert.</p>
        ) : null}
        <DropdownMenuRadioGroup value={current ?? ''} onValueChange={(value) => void select(value)}>
          {printers.map((p) => (
            <DropdownMenuRadioItem key={p.name} value={p.name} title={p.displayName}>
              <span className="truncate">{p.displayName}</span>
              {p.isDefault ? <span className="ml-auto text-xs text-muted-foreground">System</span> : null}
            </DropdownMenuRadioItem>
          ))}
          {current && !currentInfo && !isLoading ? (
            <DropdownMenuRadioItem value={current} disabled title={current}>
              <span className="truncate">{current}</span>
              <span className="ml-auto text-xs text-destructive">nicht verfügbar</span>
            </DropdownMenuRadioItem>
          ) : null}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.printers })
            void queryClient.invalidateQueries({ queryKey: queryKeys.printerStatus })
          }}
        >
          <RefreshCw aria-hidden />
          Druckerliste aktualisieren
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
