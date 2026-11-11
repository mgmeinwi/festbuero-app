/**
 * Laufzeitumgebung des Main-Prozesses: Pfade und Schalter aus Umgebungsvariablen.
 *
 * - FESTBUERO_USER_DATA      eigenes App-Datenverzeichnis (Tests/Entwicklung). Wird in index.ts VOR
 *                            `app.whenReady()` gesetzt.
 * - FESTBUERO_PRINT_DRY_RUN=1  Druck immer nur simulieren
 * - FESTBUERO_REAL_PRINT=1   echter Druck auch unpaketiert (NUR durch einen Menschen zu setzen)
 * - FESTBUERO_FAKE_PRINT_FAIL=1  Dry-Run liefert einen Fehler (Fehlerfall-Tests)
 * - FESTBUERO_E2E=1          E2E-Modus (setzt `launchApp()`): keine Hintergrund-Drosselung,
 *                            Dateien werden nicht mit fremden Programmen geöffnet
 * - FESTBUERO_DOCS_SCREENSHOTS=1  Doku-Modus für die README-Screenshots (nur zusammen mit
 *                            FESTBUERO_E2E=1, siehe `isDocsScreenshots()`)
 */
import { join } from 'node:path'
import { app } from 'electron'

export function getUserDataDir(): string {
  return app.getPath('userData')
}

export function getDbPath(): string {
  return join(getUserDataDir(), 'festbuero.sqlite')
}

export function getLogosDir(): string {
  return join(getUserDataDir(), 'logos')
}

/** Protokoll simulierter Druckaufträge. */
export function getPrintDryRunLogPath(): string {
  return join(getUserDataDir(), 'print-dry-run.log')
}

/**
 * Druck nur simulieren? (architecture.md §8)
 * Pflicht in Entwicklung/Tests: unpaketiert immer Dry-Run, außer FESTBUERO_REAL_PRINT=1.
 */
export function isPrintDryRun(): boolean {
  if (process.env.FESTBUERO_PRINT_DRY_RUN === '1') return true
  return !app.isPackaged && process.env.FESTBUERO_REAL_PRINT !== '1'
}

/** Dry-Run soll einen Druckfehler simulieren (Tests). */
export function isFakePrintFail(): boolean {
  return process.env.FESTBUERO_FAKE_PRINT_FAIL === '1'
}

export function isDev(): boolean {
  return !app.isPackaged
}

/** Läuft die App unter Playwright (`launchApp()` setzt FESTBUERO_E2E=1)? */
export function isE2E(): boolean {
  return process.env.FESTBUERO_E2E === '1'
}

/**
 * Doku-Modus für die README-Screenshots (`npm run docs:screenshots`, tests/docs/): wirkt nur zusammen
 * mit FESTBUERO_E2E=1. Die Druckerliste zeigt dann nur erfundene Demo-Drucker statt der Drucker des
 * Rechners, und Entwicklungshinweise („Druck simuliert“) werden ausgeblendet. Gedruckt wird trotzdem
 * nie – `isPrintDryRun()` bleibt davon unberührt.
 */
export function isDocsScreenshots(): boolean {
  return isE2E() && process.env.FESTBUERO_DOCS_SCREENSHOTS === '1'
}
