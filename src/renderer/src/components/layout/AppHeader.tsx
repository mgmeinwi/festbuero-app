import type { MouseEvent } from 'react'
import { Menu, PanelLeft, ReceiptText, Settings } from 'lucide-react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppInfo } from '@/hooks/use-app-settings'
import { api } from '@/lib/api'
import { modKey } from '@/lib/utils'
import { FestivalSwitcher } from './FestivalSwitcher'
import { PrinterMenu, PrinterWarning } from './PrinterMenu'
import { ThemeMenu } from './ThemeMenu'

interface AppHeaderProps {
  /** Navigation ein-/ausblenden (≥ lg: Seitenleiste, < lg: Sheet) */
  onToggleNav: () => void
}

function openAppMenu(event: MouseEvent<HTMLButtonElement>) {
  const rect = event.currentTarget.getBoundingClientRect()
  void api.app.showAppMenu({ x: rect.left, y: rect.bottom + 4 })
}

/**
 * Kopfleiste = Titelleiste des Fensters (Drag-Region). macOS: Ampel links (Platz über `.app-titlebar`),
 * Windows/Linux: native Fensterknöpfe rechts + Menü-Button links.
 * Enthält: aktives Fest, Drucker (+ Warnung), Darstellung, App-Einstellungen.
 */
export function AppHeader({ onToggleNav }: AppHeaderProps) {
  const { data: info } = useAppInfo()
  return (
    <header
      data-testid="app-header"
      className="app-titlebar app-drag flex h-12 shrink-0 items-center gap-1 border-b bg-background sm:gap-2"
    >
      <Button
        variant="ghost"
        size="icon-sm"
        className="mac:hidden"
        onClick={openAppMenu}
        aria-label="Menü"
        title="Menü"
        data-testid="app-menu-button"
      >
        <Menu aria-hidden />
      </Button>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleNav}
            aria-label="Navigation ein-/ausblenden"
            data-testid="nav-menu-button"
          >
            <PanelLeft aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Navigation ein-/ausblenden
          <span className="ml-2 opacity-70">{modKey === '⌘' ? '⌃⌘S' : 'Strg+Umschalt+B'}</span>
        </TooltipContent>
      </Tooltip>

      <Link
        to="/festbuero"
        className="hidden shrink-0 items-center gap-2 rounded-md px-1 py-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60 md:flex"
        aria-label="Festbüro – zur Festbüro-Maske"
      >
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <ReceiptText className="size-4" aria-hidden />
        </span>
        <span className="hidden text-[15px] font-semibold tracking-tight xl:inline">Festbüro</span>
      </Link>

      <div className="flex min-w-0 flex-1 items-center">
        <FestivalSwitcher />
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {info?.printDryRun ? (
          <Badge
            variant="outline"
            className="hidden h-7 text-muted-foreground xl:inline-flex"
            title="Entwicklungsmodus: Druckaufträge werden nur simuliert."
          >
            Druck simuliert
          </Badge>
        ) : null}
        <PrinterWarning />
        <PrinterMenu />
        <ThemeMenu />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" asChild>
              <Link to="/einstellungen" aria-label="App-Einstellungen" data-testid="header-settings">
                <Settings aria-hidden />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            App-Einstellungen <span className="ml-2 opacity-70">{`${modKey}+,`}</span>
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
