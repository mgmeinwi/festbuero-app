/**
 * IPC `festivals.*` – Zuständig: Bereich „Fest-Einstellungen“.
 *
 * Das Anwendungsmenü (Fest-Liste im Menü „Fest“) baut sich nach jedem erfolgreichen
 * `festivals.*`-Aufruf außer list/get automatisch neu auf (`onHandled` in `src/main/menu.ts`).
 */
import { copyFestival, createFestival, getFestival, listFestivals, updateFestival } from '../services/festivals'
import { handle } from './handle'

export function register(): void {
  handle('festivals.list', (opts) => listFestivals(opts ?? {}))
  handle('festivals.get', (id) => getFestival(id))
  handle('festivals.create', (input) => createFestival(input))
  handle('festivals.update', (id, patch) => updateFestival(id, patch))
  handle('festivals.copy', (sourceId, input) => copyFestival(sourceId, input))
}
