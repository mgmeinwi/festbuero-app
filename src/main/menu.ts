/**
 * Anwendungsmenü (deutsch). macOS: globale Menüleiste. Windows/Linux: dasselbe Menü als Popup über
 * den Menü-Button in der Kopfleiste (`app.showAppMenu`); Tastenkürzel werden dort über
 * `before-input-event` ausgewertet (funktioniert auch ohne sichtbare Menüleiste, löst genau einmal aus).
 *
 * Das Menü wird neu aufgebaut, wenn sich Feste, Drucker, Einstellungen (Theme, Fest, Drucker) oder der
 * Renderer-Zustand (`app.updateMenuState`) ändern.
 *
 * Aufteilung:
 * - Navigation, Fest-/Drucker-/Theme-Wechsel, Ordner öffnen → hier im Main.
 * - Seitenspezifische Aktionen → Event `menu.action` an den Renderer (`useMenuAction`).
 */
import { app, Menu, type Input, type MenuItemConstructorOptions } from 'electron'
import type { MenuAction, MenuState } from '@shared/ipc'
import { matchesAccelerator, parseAccelerator, type ParsedAccelerator } from './accelerators'
import type { Festival, PrinterInfo, ThemePreference } from '@shared/types'
import { changeSettings, onSettingsChanged, safeGetSettings } from './app-state'
import { getUserDataDir } from './env'
import { onHandled } from './ipc/handle'
import { isShuttingDown, registerShutdownHook } from './lifecycle'
import { listFestivals } from './services/festivals'
import { getPrinterStatus, listPrinters } from './services/printing'
import { openPath } from './services/shell'
import { emitToRenderer, getMainWindow } from './window'

const isMac = process.platform === 'darwin'

let menuState: MenuState = { route: '/festbuero', canFinalize: false, lastInvoiceId: null }
let printers: PrinterInfo[] = []
let rebuildTimer: ReturnType<typeof setTimeout> | null = null
let initialized = false

interface Shortcut {
  accelerator: ParsedAccelerator
  run: () => void
}
let shortcuts: Shortcut[] = []

/* ------------------------------------------------------------------ */
/* Öffentliche API                                                     */
/* ------------------------------------------------------------------ */

/** Einmalig nach `registerAllIpc()` aufrufen. */
export function initMenu(): void {
  if (initialized) return
  initialized = true
  onSettingsChanged(() => scheduleMenuRebuild())
  onHandled((channel, _args, result) => {
    if (channel === 'printing.listPrinters' && Array.isArray(result)) {
      printers = result as PrinterInfo[]
      scheduleMenuRebuild()
    } else if (
      (channel.startsWith('festivals.') && channel !== 'festivals.list' && channel !== 'festivals.get') ||
      channel === 'app.createSampleFestival'
    ) {
      scheduleMenuRebuild()
    }
  })
  registerShutdownHook('menu-rebuild-timer', () => {
    if (rebuildTimer) clearTimeout(rebuildTimer)
    rebuildTimer = null
  })
  rebuildMenu()
}

/** Renderer-Zustand übernehmen (IPC `app.updateMenuState`). */
export function setMenuState(state: MenuState): void {
  menuState = {
    route: typeof state?.route === 'string' ? state.route : menuState.route,
    canFinalize: state?.canFinalize === true,
    lastInvoiceId: Number.isInteger(state?.lastInvoiceId) ? (state.lastInvoiceId as number) : null
  }
  scheduleMenuRebuild()
}

export function getMenuState(): MenuState {
  return menuState
}

/** Menü (entprellt) neu aufbauen. */
export function scheduleMenuRebuild(): void {
  if (rebuildTimer || isShuttingDown()) return
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null
    rebuildMenu()
  }, 30)
}

/** Druckerliste neu laden (für das Menü „Drucker“) und Status an den Renderer melden. */
export async function refreshPrinters(notifyRenderer = false): Promise<void> {
  if (!getMainWindow() || isShuttingDown()) return
  try {
    printers = await listPrinters()
    scheduleMenuRebuild()
    if (notifyRenderer) emitToRenderer('printing.statusChanged', await getPrinterStatus())
  } catch (err) {
    console.error('[menu] Druckerliste nicht verfügbar:', err)
  }
}

/** Öffnet das Anwendungsmenü als Popup (Windows/Linux-Menü-Button). */
export function popupAppMenu(pos?: { x: number; y: number }): void {
  const win = getMainWindow()
  const menu = Menu.getApplicationMenu()
  if (!win || !menu) return
  const options: Electron.PopupOptions = { window: win }
  if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
    options.x = Math.round(pos.x)
    options.y = Math.round(pos.y)
  }
  menu.popup(options)
}

/**
 * Windows/Linux: Tastenkürzel aus dem Menü auswerten (in `before-input-event`). Liefert true, wenn
 * ein Kürzel ausgelöst wurde – dann `event.preventDefault()`, damit nichts doppelt auslöst.
 * macOS: immer false (die native Menüleiste verarbeitet die Kürzel).
 */
export function handleShortcutInput(input: Input): boolean {
  if (isMac || input.type !== 'keyDown' || input.isAutoRepeat) return false
  for (const s of shortcuts) {
    if (matchesAccelerator(s.accelerator, input)) {
      s.run()
      return true
    }
  }
  return false
}

/* ------------------------------------------------------------------ */
/* Menü-Aufbau                                                         */
/* ------------------------------------------------------------------ */

function sendAction(action: MenuAction): void {
  const win = getMainWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  emitToRenderer('menu.action', { action })
}

function navigate(path: string): void {
  emitToRenderer('app.navigate', { path })
}

function actionItem(
  action: MenuAction,
  label: string,
  accelerator?: string,
  extra: Partial<MenuItemConstructorOptions> = {}
): MenuItemConstructorOptions {
  return { id: action, label, ...(accelerator ? { accelerator } : {}), click: () => sendAction(action), ...extra }
}

function navItem(path: string, label: string, accelerator?: string): MenuItemConstructorOptions {
  return { id: `nav:${path}`, label, ...(accelerator ? { accelerator } : {}), click: () => navigate(path) }
}

function safeFestivals(): Festival[] {
  try {
    return listFestivals()
  } catch {
    return []
  }
}

function openFolder(path: string | null | undefined, fallbackRoute: string): void {
  if (!path) {
    navigate(fallbackRoute)
    return
  }
  openPath(path).catch((err: unknown) => {
    console.error('[menu] Ordner konnte nicht geöffnet werden:', err)
    navigate(fallbackRoute)
  })
}

function festivalMenu(): MenuItemConstructorOptions[] {
  const festivals = safeFestivals()
  const settings = safeGetSettings()
  const activeId = festivals.find((f) => f.id === settings?.lastFestivalId)?.id ?? festivals[0]?.id ?? null
  const items: MenuItemConstructorOptions[] =
    festivals.length > 0
      ? festivals.map((f) => ({
          id: `festival:${f.id}`,
          label: f.name,
          type: 'radio' as const,
          checked: f.id === activeId,
          click: () => changeSettings({ lastFestivalId: f.id })
        }))
      : [{ id: 'festival:none', label: 'Noch kein Gründungsfest angelegt', enabled: false }]
  return [
    ...items,
    { type: 'separator' },
    actionItem('festival.new', 'Neues Gründungsfest …'),
    actionItem('festival.copy', 'Fest kopieren …', undefined, { enabled: festivals.length > 0 }),
    { type: 'separator' },
    navItem('/fest/allgemein', 'Allgemein'),
    navItem('/fest/nummern', 'Nummernkreis'),
    navItem('/fest/produkte', 'Produkte'),
    navItem('/fest/zahlarten', 'Zahlungsarten'),
    navItem('/fest/vereine', 'Vereine'),
    navItem('/fest/vorlage', 'Rechnungsvorlage')
  ]
}

function printerMenu(): MenuItemConstructorOptions[] {
  const current = safeGetSettings()?.defaultPrinter ?? null
  const items: MenuItemConstructorOptions[] = printers.map((p) => ({
    id: `printer:${p.name}`,
    label: p.displayName || p.name,
    type: 'radio' as const,
    checked: p.name === current,
    click: () => {
      changeSettings({ defaultPrinter: p.name })
      void getPrinterStatus()
        .then((status) => emitToRenderer('printing.statusChanged', status))
        .catch(() => undefined)
    }
  }))
  if (current && !printers.some((p) => p.name === current)) {
    items.push({ id: 'printer:missing', label: `${current} (nicht verfügbar)`, type: 'radio', checked: true, enabled: false })
  }
  if (items.length === 0) items.push({ id: 'printer:none', label: 'Kein Drucker gefunden', enabled: false })
  return [
    ...items,
    { type: 'separator' },
    { id: 'printing.refresh', label: 'Druckerliste aktualisieren', click: () => void refreshPrinters(true) },
    actionItem('printing.testPage', 'Testseite drucken …')
  ]
}

function themeMenu(): MenuItemConstructorOptions[] {
  const theme = safeGetSettings()?.theme ?? 'system'
  const options: Array<[ThemePreference, string]> = [
    ['system', 'System'],
    ['light', 'Hell'],
    ['dark', 'Dunkel']
  ]
  return options.map(([value, label]) => ({
    id: `theme:${value}`,
    label,
    type: 'radio' as const,
    checked: theme === value,
    click: () => changeSettings({ theme: value })
  }))
}

export function buildMenuTemplate(): MenuItemConstructorOptions[] {
  const settings = safeGetSettings()
  const inMask = menuState.route.startsWith('/festbuero')
  const hasLast = menuState.lastInvoiceId !== null
  const folderApp = isMac ? 'Finder' : 'Explorer'
  const template: MenuItemConstructorOptions[] = []

  if (isMac) {
    template.push({
      label: 'Festbüro',
      submenu: [
        { role: 'about', label: 'Über Festbüro' },
        { type: 'separator' },
        navItem('/einstellungen', 'Einstellungen …', 'Cmd+,'),
        { type: 'separator' },
        { role: 'services', label: 'Dienste' },
        { type: 'separator' },
        { role: 'hide', label: 'Festbüro ausblenden' },
        { role: 'hideOthers', label: 'Andere ausblenden' },
        { role: 'unhide', label: 'Alle einblenden' },
        { type: 'separator' },
        { role: 'quit', label: 'Festbüro beenden' }
      ]
    })
  }

  template.push({
    label: isMac ? 'Ablage' : 'Datei',
    submenu: [
      actionItem('invoice.new', 'Neue Rechnung', 'CmdOrCtrl+N'),
      actionItem('invoice.newEinzel', 'Neue Einzelrechnung', 'CmdOrCtrl+Shift+N'),
      { type: 'separator' },
      actionItem('invoice.finalize', 'Abschließen & drucken', 'CmdOrCtrl+Enter', {
        enabled: inMask && menuState.canFinalize
      }),
      actionItem('invoice.reprintLast', 'Letzte Rechnung erneut drucken', 'CmdOrCtrl+P', { enabled: hasLast }),
      actionItem('invoice.openLastPdf', 'PDF der letzten Rechnung öffnen', 'CmdOrCtrl+Shift+O', { enabled: hasLast }),
      { type: 'separator' },
      actionItem('clubs.import', 'Vereine aus Excel importieren …', 'CmdOrCtrl+I'),
      actionItem('clubs.exportTemplate', 'Anmelde-Vorlage exportieren …'),
      { type: 'separator' },
      actionItem('invoices.exportListExcel', 'Rechnungsliste nach Excel exportieren …'),
      actionItem('invoices.exportZip', 'Alle PDFs als ZIP exportieren …'),
      actionItem('evaluation.exportExcel', 'Auswertung nach Excel exportieren …', 'CmdOrCtrl+Shift+E'),
      { type: 'separator' },
      {
        id: 'app.openDocumentsDir',
        label: `Dokumentenordner im ${folderApp} öffnen`,
        click: () => openFolder(settings?.documentsDir, '/einstellungen')
      },
      actionItem('app.backup', 'Datensicherung erstellen …'),
      ...(isMac
        ? []
        : ([
            { type: 'separator' },
            navItem('/einstellungen', 'Einstellungen …', 'Ctrl+,'),
            { type: 'separator' },
            { role: 'quit', label: 'Beenden' }
          ] as MenuItemConstructorOptions[]))
    ]
  })

  template.push({
    label: 'Bearbeiten',
    submenu: [
      { role: 'undo', label: 'Widerrufen' },
      { role: 'redo', label: 'Wiederholen' },
      { type: 'separator' },
      { role: 'cut', label: 'Ausschneiden' },
      { role: 'copy', label: 'Kopieren' },
      { role: 'paste', label: 'Einfügen' },
      { role: 'selectAll', label: 'Alles auswählen' },
      { type: 'separator' },
      actionItem('search.focus', 'Suchen', 'CmdOrCtrl+F')
    ]
  })

  template.push({ label: 'Fest', submenu: festivalMenu() })

  const viewMenu: MenuItemConstructorOptions[] = [
    navItem('/festbuero', 'Festbüro', 'CmdOrCtrl+1'),
    navItem('/rechnungen', 'Rechnungen', 'CmdOrCtrl+2'),
    navItem('/auswertung', 'Auswertung', 'CmdOrCtrl+3'),
    navItem('/fest/allgemein', 'Fest-Einstellungen', 'CmdOrCtrl+4'),
    { type: 'separator' },
    actionItem('preview.toggle', 'Vorschau ein-/ausblenden', isMac ? 'Alt+Cmd+P' : 'Ctrl+Alt+P'),
    actionItem('nav.toggle', 'Navigation ein-/ausblenden', isMac ? 'Ctrl+Cmd+S' : 'Ctrl+Shift+B'),
    { type: 'separator' },
    { label: 'Erscheinungsbild', submenu: themeMenu() },
    { type: 'separator' },
    { role: 'resetZoom', label: 'Originalgröße' },
    { role: 'zoomIn', label: 'Vergrößern' },
    { role: 'zoomOut', label: 'Verkleinern' },
    { type: 'separator' },
    { role: 'togglefullscreen', label: 'Vollbild' }
  ]
  if (!app.isPackaged) {
    viewMenu.push(
      { type: 'separator' },
      { role: 'reload', label: 'Neu laden' },
      { role: 'forceReload', label: 'Neu laden (ohne Cache)' },
      { role: 'toggleDevTools', label: 'Entwicklerwerkzeuge' }
    )
  }
  template.push({ label: isMac ? 'Darstellung' : 'Ansicht', submenu: viewMenu })

  template.push({ label: 'Drucker', submenu: printerMenu() })

  template.push(
    isMac
      ? { role: 'windowMenu', label: 'Fenster' }
      : {
          label: 'Fenster',
          submenu: [
            { role: 'minimize', label: 'Minimieren' },
            { role: 'close', label: 'Schließen' }
          ]
        }
  )

  template.push({
    role: 'help',
    label: 'Hilfe',
    submenu: [
      actionItem('help.shortcuts', 'Tastaturkurzbefehle', 'CmdOrCtrl+/'),
      {
        id: 'help.showDataDir',
        label: `Datenordner im ${folderApp} anzeigen`,
        click: () => openFolder(getUserDataDir(), '/einstellungen')
      },
      { id: 'setup.open', label: 'Einrichtungsassistent öffnen', click: () => navigate('/setup') }
    ]
  })

  return template
}

function rebuildMenu(): void {
  if (isShuttingDown()) return
  const template = buildMenuTemplate()
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  shortcuts = collectShortcuts(template)
}

/* ------------------------------------------------------------------ */
/* Tastenkürzel (Windows/Linux)                                         */
/* ------------------------------------------------------------------ */

function collectShortcuts(items: MenuItemConstructorOptions[]): Shortcut[] {
  const result: Shortcut[] = []
  const walk = (list: MenuItemConstructorOptions[]) => {
    for (const item of list) {
      if (Array.isArray(item.submenu)) walk(item.submenu as MenuItemConstructorOptions[])
      if (!item.accelerator || !item.click || item.enabled === false || item.role) continue
      const parsed = parseAccelerator(String(item.accelerator))
      if (!parsed) continue
      const click = item.click
      result.push({
        accelerator: parsed,
        run: () => (click as () => void)()
      })
    }
  }
  walk(items)
  return result
}
