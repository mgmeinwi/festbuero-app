/**
 * IPC `products.*`
 *
 * Zuständig: Bereich „Fest-Einstellungen“.
 * Noch nicht implementiert: list, create, update, delete, reorder.
 * Nicht registrierte Kanäle erzeugen im Renderer die Meldung „Funktion noch nicht verfügbar: …“.
 *
 * Muster:
 *   import { handle } from './handle'
 *   handle('products.list', (...args) => service.list(...args))
 */

export function register(): void {
  // Handler werden vom Bereich „Fest-Einstellungen“ ergänzt.
}
