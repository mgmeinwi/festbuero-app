import { useEffect, useRef } from 'react'
import { Link, Outlet, useLocation } from 'react-router'
import { cn } from '@/lib/utils'
import { FEST_NAV, isNavItemActive } from './nav-items'

/**
 * Rahmen für `/fest/*`: Tab-Leiste mit den Unterpunkten der Fest-Einstellungen
 * (Allgemein, Nummern, Produkte, Zahlarten, Vereine, Vorlage). Bei schmalen Fenstern scrollt
 * nur die Tab-Leiste horizontal (aktiver Tab wird eingeblendet), nie das Fenster.
 */
export function FestSettingsLayout() {
  const { pathname } = useLocation()
  const activeRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [pathname])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav
        aria-label="Fest-Einstellungen"
        className="shrink-0 overflow-x-auto border-b bg-background px-3 sm:px-6"
        data-testid="fest-nav"
      >
        <ul className="flex min-w-max gap-1 py-2">
          {FEST_NAV.map((item) => {
            const active = isNavItemActive(item, pathname)
            const Icon = item.icon
            return (
              <li key={item.to}>
                <Link
                  ref={active ? activeRef : undefined}
                  to={item.to}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground outline-none transition-colors',
                    'hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60',
                    active && 'bg-accent text-accent-foreground'
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
      <div className="min-h-0 flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  )
}
