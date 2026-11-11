import {
  CalendarDays,
  ChartColumn,
  Files,
  Hash,
  LayoutTemplate,
  type LucideIcon,
  Package,
  ReceiptText,
  Settings,
  SlidersHorizontal,
  Users,
  Wallet
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Pfadpräfix, für den der Eintrag als aktiv gilt (Standard: `to`) */
  activePrefix?: string
  /** Tastenkürzel (Anzeige), siehe Menü „Ansicht“ im Main-Prozess */
  shortcut?: string
}

/** Hauptnavigation (Reihenfolge laut Spezifikation „UX-Grundsätze“). */
export const MAIN_NAV: readonly NavItem[] = [
  { to: '/festbuero', label: 'Festbüro', icon: ReceiptText, shortcut: '1' },
  { to: '/rechnungen', label: 'Rechnungen', icon: Files, shortcut: '2' },
  { to: '/auswertung', label: 'Auswertung', icon: ChartColumn, shortcut: '3' },
  { to: '/fest/allgemein', label: 'Fest-Einstellungen', icon: SlidersHorizontal, activePrefix: '/fest/', shortcut: '4' }
]

export const SETTINGS_NAV: NavItem = { to: '/einstellungen', label: 'App-Einstellungen', icon: Settings, shortcut: ',' }

/** Unterpunkte der Fest-Einstellungen (Tab-Leiste über den Seiten `/fest/*`). */
export const FEST_NAV: readonly NavItem[] = [
  { to: '/fest/allgemein', label: 'Allgemein', icon: CalendarDays },
  { to: '/fest/nummern', label: 'Nummern', icon: Hash },
  { to: '/fest/produkte', label: 'Produkte', icon: Package },
  { to: '/fest/zahlarten', label: 'Zahlarten', icon: Wallet },
  { to: '/fest/vereine', label: 'Vereine', icon: Users },
  { to: '/fest/vorlage', label: 'Vorlage', icon: LayoutTemplate }
]

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.activePrefix) return pathname.startsWith(item.activePrefix)
  return pathname === item.to || pathname.startsWith(`${item.to}/`)
}
