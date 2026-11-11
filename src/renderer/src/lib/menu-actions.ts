/**
 * Menüaktionen (Anwendungsmenü, Tastenkürzel) im Renderer.
 *
 *   useMenuAction('clubs.import', () => openImportDialog())
 *
 * Ablauf: Der Main-Prozess sendet `menu.action`. Ist ein Handler registriert, wird der zuletzt
 * registrierte aufgerufen. Sonst navigiert die Shell zur passenden Route (ACTION_ROUTES) und stellt die
 * Aktion zu, sobald die Seite ihren Handler registriert (max. 5 s, danach Hinweis-Toast).
 * Zuständigkeiten: siehe docs/dev-notes.md, Abschnitt „Menüaktionen“.
 */
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import type { MenuAction } from '@shared/ipc'

type Handler = () => void | Promise<void>

/** Route, auf der die Aktion behandelt wird (falls gerade kein Handler registriert ist). */
export const ACTION_ROUTES: Partial<Record<MenuAction, string>> = {
  'invoice.new': '/festbuero',
  'invoice.newEinzel': '/festbuero',
  'invoice.finalize': '/festbuero',
  'invoice.reprintLast': '/festbuero',
  'invoice.openLastPdf': '/festbuero',
  'preview.toggle': '/festbuero',
  'search.focus': '/festbuero',
  'clubs.import': '/fest/vereine',
  'clubs.exportTemplate': '/fest/vereine',
  'invoices.exportListExcel': '/rechnungen',
  'invoices.exportZip': '/rechnungen',
  'evaluation.exportExcel': '/auswertung',
  'festival.copy': '/fest/allgemein',
  'app.backup': '/einstellungen',
  'printing.testPage': '/einstellungen'
}

const PENDING_TIMEOUT_MS = 5000

const handlers = new Map<MenuAction, Array<{ current: Handler }>>()
let pending: { action: MenuAction; timer: ReturnType<typeof setTimeout> } | null = null

function run(action: MenuAction, handler: Handler): void {
  try {
    const result = handler()
    if (result && typeof (result as Promise<void>).catch === 'function') {
      ;(result as Promise<void>).catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : `Aktion „${action}“ fehlgeschlagen.`)
      })
    }
  } catch (err) {
    toast.error(err instanceof Error ? err.message : `Aktion „${action}“ fehlgeschlagen.`)
  }
}

function clearPending(): void {
  if (pending) clearTimeout(pending.timer)
  pending = null
}

/** true, wenn für die Aktion gerade ein Handler registriert ist. */
export function hasMenuActionHandler(action: MenuAction): boolean {
  return (handlers.get(action)?.length ?? 0) > 0
}

/**
 * Führt eine Menüaktion aus (auch für Buttons nutzbar). Ohne Handler: zur Route navigieren und die
 * Aktion zustellen, sobald die Seite bereit ist.
 */
export function dispatchMenuAction(action: MenuAction, navigate: (path: string) => void): void {
  const list = handlers.get(action)
  const top = list?.[list.length - 1]
  if (top) {
    clearPending()
    run(action, top.current)
    return
  }
  const route = ACTION_ROUTES[action]
  if (!route) {
    toast.info('Diese Funktion ist noch nicht verfügbar.')
    return
  }
  clearPending()
  pending = {
    action,
    timer: setTimeout(() => {
      if (pending?.action === action) {
        pending = null
        toast.info('Diese Funktion ist hier noch nicht verfügbar.')
      }
    }, PENDING_TIMEOUT_MS)
  }
  navigate(route)
}

/**
 * Registriert einen Handler für eine Menüaktion, solange die Komponente gemountet ist.
 * Der Handler darf sich bei jedem Render ändern (es wird immer der aktuelle aufgerufen).
 */
export function useMenuAction(action: MenuAction, handler: Handler, enabled = true): void {
  const ref = useRef<Handler>(handler)
  ref.current = handler

  useEffect(() => {
    if (!enabled) return
    const entry = { current: () => ref.current() }
    const list = handlers.get(action) ?? []
    list.push(entry)
    handlers.set(action, list)
    if (pending?.action === action) {
      clearPending()
      // nach dem Rendern zustellen, damit die Seite vollständig bereit ist
      setTimeout(() => run(action, entry.current), 0)
    }
    return () => {
      const current = handlers.get(action) ?? []
      const idx = current.indexOf(entry)
      if (idx >= 0) current.splice(idx, 1)
      if (current.length === 0) handlers.delete(action)
    }
  }, [action, enabled])
}
