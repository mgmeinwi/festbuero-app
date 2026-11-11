/**
 * Typ der Brücke `window.festbuero` (vom Preload per contextBridge bereitgestellt).
 * Reine Typen – wird vom Renderer, von E2E-Tests und vom Preload selbst importiert.
 */
import type { ApiChannel, ApiParams, ApiResult } from '../shared/ipc-channels'
import type { MainEventName, MainEvents } from '../shared/ipc'

export interface FestbueroBridge {
  /** Ruft einen IPC-Kanal `<namespace>.<methode>` auf. Bevorzugt `api` aus `@/lib/api` verwenden. */
  invoke<C extends ApiChannel>(channel: C, ...args: ApiParams<C>): Promise<ApiResult<C>>
  /** Abonniert ein Event des Main-Prozesses; liefert eine Funktion zum Abmelden. */
  on<E extends MainEventName>(event: E, callback: (payload: MainEvents[E]) => void): () => void
}
