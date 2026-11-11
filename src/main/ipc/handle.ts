/**
 * Typsichere Registrierung von IPC-Handlern.
 *
 *   handle('festivals.get', (id) => getFestival(id))
 *
 * Parameter und Rückgabe werden aus `FestbueroApi` (src/shared/ipc.ts) abgeleitet.
 * Fehler kommen im Renderer als abgelehntes Promise mit der (deutschen) Meldung an;
 * `lib/api.ts` entfernt Electrons Präfix „Error invoking remote method …“.
 */
import { ipcMain } from 'electron'
import type { ApiChannel, ApiParams, ApiResult } from '@shared/ipc-channels'

export type Handler<C extends ApiChannel> = (...args: ApiParams<C>) => ApiResult<C> | Promise<ApiResult<C>>

const registered = new Set<string>()

/** Wird nach jedem erfolgreichen Handler-Aufruf benachrichtigt (z. B. Menü neu aufbauen). */
export type HandledListener = (channel: ApiChannel, args: unknown[], result: unknown) => void
const handledListeners = new Set<HandledListener>()

export function onHandled(listener: HandledListener): () => void {
  handledListeners.add(listener)
  return () => handledListeners.delete(listener)
}

/** Übersetzt technische Fehler in eine verständliche deutsche Meldung. */
export function toUserError(err: unknown): Error {
  if (err instanceof Error) {
    const code = (err as Error & { code?: unknown }).code
    if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') {
      return new Error('Die Datenbank ist gerade belegt. Bitte erneut versuchen.')
    }
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' && /invoice\.number/.test(err.message)) {
      return new Error('Diese Rechnungsnummer ist bereits vergeben. Es wurde nichts gespeichert.')
    }
    if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      return new Error('Der Datensatz wird noch verwendet oder verweist auf einen nicht vorhandenen Eintrag.')
    }
    return new Error(err.message || 'Unbekannter Fehler.')
  }
  return new Error(typeof err === 'string' && err ? err : 'Unbekannter Fehler.')
}

export function handle<C extends ApiChannel>(channel: C, fn: Handler<C>): void {
  if (registered.has(channel)) ipcMain.removeHandler(channel)
  registered.add(channel)
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    try {
      const result = await fn(...(args as ApiParams<C>))
      for (const listener of handledListeners) {
        try {
          listener(channel, args, result)
        } catch (err) {
          console.error('[ipc] Listener fehlgeschlagen:', err)
        }
      }
      return result
    } catch (err) {
      console.error(`[ipc] ${channel} fehlgeschlagen:`, err)
      throw toUserError(err)
    }
  })
}

/** Alle registrierten Kanäle (Diagnose/Tests). */
export function registeredChannels(): string[] {
  return [...registered].sort()
}
