/**
 * Aus dem IPC-Vertrag (`ipc.ts`) abgeleitete Hilfstypen pro Kanal.
 * Reine Typen – genutzt von Main (`ipc/handle.ts`), Preload, Renderer (`lib/api.ts`) und E2E-Helfern.
 */
import type { ApiChannel, ApiNamespace, FestbueroApi, MainEventName, MainEvents } from './ipc'

/** Methode des Vertrags zu einem Kanal, z. B. `ApiMethod<'festivals.get'>` = `(id: number) => Promise<Festival>`. */
export type ApiMethod<C extends ApiChannel> = C extends `${infer N extends ApiNamespace}.${infer M}`
  ? M extends keyof FestbueroApi[N]
    ? FestbueroApi[N][M] extends (...args: infer A) => infer R
      ? (...args: A) => R
      : never
    : never
  : never

/** Parameterliste eines Kanals. */
export type ApiParams<C extends ApiChannel> = Parameters<ApiMethod<C>>

/** Aufgelöster Rückgabewert eines Kanals (ohne Promise). */
export type ApiResult<C extends ApiChannel> = Awaited<ReturnType<ApiMethod<C>>>

export type { ApiChannel, MainEventName, MainEvents }

/** Präfix der Fehlermeldung, wenn ein Kanal (noch) keinen Handler im Main-Prozess hat. */
export const NOT_AVAILABLE_PREFIX = 'Funktion noch nicht verfügbar: '

/** Gültige Kanalnamen haben die Form `<namespace>.<methode>`. */
export const CHANNEL_PATTERN = /^[a-zA-Z][a-zA-Z0-9]*\.[a-zA-Z][a-zA-Z0-9]*$/
