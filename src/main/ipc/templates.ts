/**
 * IPC `templates.*`
 *
 * Zuständig: Bereich „Vorlage“.
 * Noch nicht implementiert: get, update, pickLogo, setLogo, getLogoDataUrl, resetToDefault.
 * Nicht registrierte Kanäle erzeugen im Renderer die Meldung „Funktion noch nicht verfügbar: …“.
 *
 * Muster:
 *   import { handle } from './handle'
 *   handle('templates.get', (...args) => service.get(...args))
 */

export function register(): void {
  // Handler werden vom Bereich „Vorlage“ ergänzt.
}
