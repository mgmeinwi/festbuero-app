/**
 * Sauberes Beenden: Aufräum-Funktionen, die vor dem Beenden der App laufen müssen
 * (Timer/Intervalle stoppen, laufende Kindprozesse wie `lp`/SumatraPDF beenden, Dateien schließen).
 *
 *   const timer = setInterval(poll, 60_000)
 *   registerShutdownHook('drucker-polling', () => clearInterval(timer))
 *
 * Hooks laufen genau einmal, synchron, in `before-quit`. Die Datenbank schließt index.ts in
 * `will-quit` (danach). Nie `app.exit()`/`process.exit()` im normalen Beenden-Pfad verwenden –
 * offene Node-Handles führen sonst beim Bereinigen zum Absturz.
 */

type ShutdownHook = () => void

const hooks = new Map<string, ShutdownHook>()
let ran = false

/** Registriert (oder ersetzt) einen Aufräum-Hook. Liefert eine Funktion zum Abmelden. */
export function registerShutdownHook(name: string, fn: ShutdownHook): () => void {
  hooks.set(name, fn)
  return () => {
    if (hooks.get(name) === fn) hooks.delete(name)
  }
}

/** Führt alle Hooks einmalig aus (Fehler werden protokolliert, nicht geworfen). */
export function runShutdownHooks(): void {
  if (ran) return
  ran = true
  for (const [name, fn] of hooks) {
    try {
      fn()
    } catch (err) {
      console.error(`[shutdown] Hook „${name}“ fehlgeschlagen:`, err)
    }
  }
  hooks.clear()
}

/** true, sobald das Beenden begonnen hat (z. B. um keine neuen Kindprozesse mehr zu starten). */
export function isShuttingDown(): boolean {
  return ran
}
