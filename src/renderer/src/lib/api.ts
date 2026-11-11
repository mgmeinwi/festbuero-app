/**
 * Typsicherer Zugriff auf den Main-Prozess.
 *
 *   const festivals = await api.festivals.list()
 *
 * `api.<namespace>.<methode>(...args)` → `window.festbuero.invoke('<namespace>.<methode>', ...args)`.
 * Fehler werden als `Error` mit bereinigter deutscher Meldung geworfen (ohne Electron-Präfix).
 * Für Kanäle ohne Handler im Main-Prozess: „Funktion noch nicht verfügbar: <kanal>“.
 */
import type { ApiChannel, ApiParams, ApiResult } from '@shared/ipc-channels'
import { NOT_AVAILABLE_PREFIX } from '@shared/ipc-channels'
import type { FestbueroApi, MainEventName, MainEvents } from '@shared/ipc'

/** Entfernt Electrons Präfix „Error invoking remote method 'x': Error: “ und übersetzt Sonderfälle. */
export function cleanIpcError(err: unknown, channel?: string): Error {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  const noHandler = /No handler registered for '([^']+)'/.exec(raw)
  if (noHandler) return new Error(`${NOT_AVAILABLE_PREFIX}${noHandler[1]}`)
  let message = raw.replace(/^Error invoking remote method '[^']*':\s*/, '')
  // „Error: …“, „TypeError: …“, „SqliteError: …“ usw. entfernen
  message = message.replace(/^(?:[A-Za-z]*Error|Error):\s*/, '')
  if (!message) message = channel ? `Unbekannter Fehler bei ${channel}.` : 'Unbekannter Fehler.'
  const cleaned = new Error(message)
  if (err instanceof Error && err.stack) cleaned.stack = err.stack
  return cleaned
}

function getBridge(): Window['festbuero'] {
  if (typeof window === 'undefined' || !window.festbuero) {
    throw new Error('Die Verbindung zum Hauptprozess fehlt (Preload nicht geladen).')
  }
  return window.festbuero
}

/** Direkter, typsicherer Aufruf eines Kanals. */
export async function invoke<C extends ApiChannel>(channel: C, ...args: ApiParams<C>): Promise<ApiResult<C>> {
  try {
    return await getBridge().invoke(channel, ...args)
  } catch (err) {
    throw cleanIpcError(err, channel)
  }
}

const namespaceCache = new Map<string, unknown>()

function createNamespace(ns: string): unknown {
  return new Proxy(
    {},
    {
      get(_target, method) {
        if (typeof method !== 'string' || method === 'then') return undefined
        const channel = `${ns}.${method}` as ApiChannel
        return (...args: unknown[]) =>
          (invoke as unknown as (c: ApiChannel, ...a: unknown[]) => Promise<unknown>)(channel, ...args)
      }
    }
  )
}

/** `api.<namespace>.<methode>()` – siehe IPC-Vertrag in `src/shared/ipc.ts`. */
export const api: FestbueroApi = new Proxy({} as FestbueroApi, {
  get(_target, ns) {
    if (typeof ns !== 'string' || ns === 'then') return undefined
    let namespace = namespaceCache.get(ns)
    if (!namespace) {
      namespace = createNamespace(ns)
      namespaceCache.set(ns, namespace)
    }
    return namespace
  }
})

/** Abonniert ein Main-Event; liefert die Abmeldefunktion. */
export function onMainEvent<E extends MainEventName>(event: E, callback: (payload: MainEvents[E]) => void): () => void {
  return getBridge().on(event, callback)
}

/** true, wenn der Fehler „Funktion noch nicht verfügbar“ bedeutet (Kanal ohne Handler). */
export function isNotAvailableError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith(NOT_AVAILABLE_PREFIX)
}
