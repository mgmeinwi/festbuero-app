/**
 * IPC `festivals.*`
 *
 * Basis-Version (Bereich „Basis“): list, get, create, update.
 * Zuständig danach: Bereich „Fest-Einstellungen“ (ergänzt copy und Validierungen).
 */
import { createFestival, getFestival, listFestivals, updateFestival } from '../services/festivals'
import { handle } from './handle'

export function register(): void {
  handle('festivals.list', (opts) => listFestivals(opts ?? {}))
  handle('festivals.get', (id) => getFestival(id))
  handle('festivals.create', (input) => createFestival(input))
  handle('festivals.update', (id, patch) => updateFestival(id, patch))
  // festivals.copy → Bereich „Fest-Einstellungen“
}
