/**
 * Renderer-Zustand für das Anwendungsmenü (aktiviert z. B. „Abschließen & drucken“ / Strg+Enter).
 *
 *   updateMenuState({ canFinalize: true })      // Maske: Rechnung abschließbar
 *   updateMenuState({ lastInvoiceId: 42 })       // nach dem Abschluss
 *
 * Teilupdates werden zusammengeführt und entprellt an den Main-Prozess gesendet
 * (`app.updateMenuState`). Die Route setzt die Shell automatisch.
 */
import { useEffect } from 'react'
import type { MenuState } from '@shared/ipc'
import { api } from './api'

let state: MenuState = { route: '/', canFinalize: false, lastInvoiceId: null }
let timer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<(s: MenuState) => void>()

export function getMenuState(): MenuState {
  return state
}

export function updateMenuState(partial: Partial<MenuState>): void {
  const next = { ...state, ...partial }
  if (next.route === state.route && next.canFinalize === state.canFinalize && next.lastInvoiceId === state.lastInvoiceId) {
    return
  }
  state = next
  for (const l of listeners) l(state)
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    api.app.updateMenuState(state).catch(() => undefined)
  }, 50)
}

export function onMenuStateChange(listener: (s: MenuState) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Setzt `canFinalize`, solange die Komponente gemountet ist (beim Verlassen wieder false).
 *   useCanFinalize(totals.grossCents !== 0 && customerSelected)
 */
export function useCanFinalize(canFinalize: boolean): void {
  useEffect(() => {
    updateMenuState({ canFinalize })
  }, [canFinalize])
  useEffect(() => () => updateMenuState({ canFinalize: false }), [])
}
