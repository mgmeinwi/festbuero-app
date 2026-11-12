import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { ReceiptText } from 'lucide-react'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useBreakpoint } from '@/hooks/use-media-query'
import { api, onMainEvent } from '@/lib/api'
import { dispatchMenuAction, useMenuAction } from '@/lib/menu-actions'
import { getMenuState, updateMenuState } from '@/lib/menu-state'
import { errorMessage } from '@/lib/utils'
import { AppHeader } from './AppHeader'
import { NewFestivalDialog } from './NewFestivalDialog'
import { ShortcutsDialog } from './ShortcutsDialog'
import { NavList, Sidebar } from './Sidebar'

const SIDEBAR_KEY = 'festbuero.sidebarHidden'

function readSidebarHidden(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === '1'
  } catch {
    return false
  }
}

function writeSidebarHidden(hidden: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_KEY, hidden ? '1' : '0')
  } catch {
    // ignorieren (z. B. Speicher gesperrt)
  }
}

/**
 * Grundlayout: fixe Kopfleiste (= Titelleiste), Navigation (Seitenleiste ab lg, Sheet darunter),
 * Inhaltsbereich. `<main>` scrollt intern; das Fenster selbst scrollt nie.
 * Seiten mit eigenen Scrollbereichen (z. B. Maske mit Vorschau) nutzen `h-full` + `min-h-0`.
 *
 * Zentrale Menüaktionen: Neues Fest, Navigation ein/aus, Tastaturkurzbefehle, letzte Rechnung
 * erneut drucken / PDF öffnen (über `lastInvoiceId` aus dem Menüzustand).
 */
export function AppShell() {
  const [navOpen, setNavOpen] = useState(false)
  const [sidebarHidden, setSidebarHidden] = useState(readSidebarHidden)
  const [newFestivalOpen, setNewFestivalOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const isLg = useBreakpoint('lg')
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const go = useCallback((path: string) => void navigate(path), [navigate])

  // Menü-/Shortcut-Navigation und Menüaktionen aus dem Main-Prozess
  useEffect(() => onMainEvent('app.navigate', ({ path }) => go(path)), [go])
  useEffect(() => onMainEvent('menu.action', ({ action }) => dispatchMenuAction(action, go)), [go])

  // Route an das Menü melden; Sheet bei Navigation schließen
  useEffect(() => {
    updateMenuState({ route: pathname })
    setNavOpen(false)
  }, [pathname])

  // Neue Seite beginnt oben (der Inhaltsbereich behielte sonst die Scrollposition der vorherigen Seite)
  const mainRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0
  }, [pathname])

  const toggleNav = useCallback(() => {
    if (isLg) {
      setSidebarHidden((hidden) => {
        writeSidebarHidden(!hidden)
        return !hidden
      })
    } else {
      setNavOpen((open) => !open)
    }
  }, [isLg])

  useMenuAction('nav.toggle', toggleNav)
  useMenuAction('festival.new', () => setNewFestivalOpen(true))
  useMenuAction('help.shortcuts', () => setShortcutsOpen(true))
  useMenuAction('setup.open', () => go('/setup'))
  useMenuAction('invoice.reprintLast', async () => {
    const id = getMenuState().lastInvoiceId
    if (id === null) return void toast.info('Es wurde noch keine Rechnung abgeschlossen.')
    try {
      const result = await api.invoices.print(id)
      if (result.ok) toast.success(result.dryRun ? 'Druck simuliert.' : 'Rechnung wird gedruckt.')
      else toast.error(result.error ?? 'Drucken fehlgeschlagen.')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  })
  useMenuAction('invoice.openLastPdf', async () => {
    const id = getMenuState().lastInvoiceId
    if (id === null) return void toast.info('Es wurde noch keine Rechnung abgeschlossen.')
    try {
      await api.invoices.openPdf(id)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  })

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <AppHeader onToggleNav={toggleNav} />
      <div className="flex min-h-0 flex-1">
        <Sidebar hidden={sidebarHidden} />
        <main ref={mainRef} id="main-content" data-testid="main-content" className="min-h-0 min-w-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="w-72 max-w-[85vw] gap-0 bg-sidebar p-0" closeButtonClassName="top-2">
          <SheetHeader className="app-titlebar h-12 justify-center border-b py-0">
            <SheetTitle className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <ReceiptText className="size-4" aria-hidden />
              </span>
              Festbüro
            </SheetTitle>
            <SheetDescription className="sr-only">Navigation</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <NavList onNavigate={() => setNavOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      <NewFestivalDialog open={newFestivalOpen} onOpenChange={setNewFestivalOpen} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  )
}
