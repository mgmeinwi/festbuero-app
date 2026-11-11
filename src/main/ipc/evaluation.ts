/**
 * IPC `evaluation.*`
 *
 * Zuständig: Bereich „Liste & Auswertung“.
 * Noch nicht implementiert: get, exportExcel.
 * Nicht registrierte Kanäle erzeugen im Renderer die Meldung „Funktion noch nicht verfügbar: …“.
 *
 * Muster:
 *   import { handle } from './handle'
 *   handle('evaluation.get', (...args) => service.get(...args))
 */

export function register(): void {
  // Handler werden vom Bereich „Liste & Auswertung“ ergänzt.
}
