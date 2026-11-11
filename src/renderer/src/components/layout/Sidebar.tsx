import { Link, useLocation } from 'react-router'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useBreakpoint } from '@/hooks/use-media-query'
import { cn, modKey } from '@/lib/utils'
import { isNavItemActive, MAIN_NAV, type NavItem, SETTINGS_NAV } from './nav-items'

interface NavEntryProps {
  item: NavItem
  /** nur Icon (Tooltip mit Beschriftung) */
  compact?: boolean
  onNavigate?: () => void
}

function NavEntry({ item, compact = false, onNavigate }: NavEntryProps) {
  const { pathname } = useLocation()
  const active = isNavItemActive(item, pathname)
  const Icon = item.icon
  const link = (
    <Link
      to={item.to}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      aria-label={compact ? item.label : undefined}
      data-active={active || undefined}
      data-testid={`nav-${item.to.replace(/^\//, '').replace(/\//g, '-')}`}
      className={cn(
        'flex h-10 items-center gap-3 rounded-md text-sm font-medium text-sidebar-foreground outline-none transition-colors',
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60',
        'data-[active]:bg-sidebar-accent data-[active]:text-sidebar-accent-foreground data-[active]:font-semibold',
        compact ? 'w-10 justify-center' : 'px-3'
      )}
    >
      <Icon className={cn('size-[18px] shrink-0', active ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
      {!compact && <span className="truncate">{item.label}</span>}
    </Link>
  )
  if (!compact) return link
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">
        {item.label}
        {item.shortcut ? <span className="ml-2 opacity-70">{`${modKey}+${item.shortcut}`}</span> : null}
      </TooltipContent>
    </Tooltip>
  )
}

/** Navigationsliste (auch im Menü-Sheet für kleine Fenster verwendet). */
export function NavList({ compact = false, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  return (
    <nav aria-label="Hauptnavigation" className="flex h-full flex-col">
      <ul className={cn('flex flex-col gap-1', compact && 'items-center')}>
        {MAIN_NAV.map((item) => (
          <li key={item.to}>
            <NavEntry item={item} compact={compact} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
      <ul className={cn('mt-auto flex flex-col gap-1 pt-4', compact && 'items-center')}>
        <li>
          <NavEntry item={SETTINGS_NAV} compact={compact} onNavigate={onNavigate} />
        </li>
      </ul>
    </nav>
  )
}

/**
 * Seitenleiste:
 * - ≥ xl (1280 px): mit Beschriftung
 * - lg–xl (1024–1279 px): nur Icons mit Tooltip
 * - < lg: ausgeblendet (Navigation über den Menü-Button in der Kopfleiste)
 * - `hidden`: per „Navigation ein-/ausblenden“ (⌃⌘S) auch ab lg ausgeblendet
 */
export function Sidebar({ hidden = false }: { hidden?: boolean }) {
  const wide = useBreakpoint('xl')
  return (
    <aside
      data-testid="sidebar"
      className={cn(
        'hidden w-16 shrink-0 overflow-y-auto border-r border-sidebar-border bg-sidebar px-3 py-4 xl:w-56',
        !hidden && 'lg:block'
      )}
    >
      <NavList compact={!wide} />
    </aside>
  )
}
