/**
 * Dateien mit dem Standardprogramm öffnen / im Finder bzw. Explorer zeigen.
 *
 * In E2E-Tests (FESTBUERO_E2E=1 bzw. FESTBUERO_DISABLE_SHELL=1, setzt `launchApp()`) wird nichts geöffnet, sondern nur
 * in `<userData>/shell.log` protokolliert – Tests sollen keine fremden Programme starten.
 */
import { appendFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { shell } from 'electron'
import { getUserDataDir } from '../env'

function isShellDisabled(): boolean {
  return process.env.FESTBUERO_DISABLE_SHELL === '1' || process.env.FESTBUERO_E2E === '1'
}

function logShell(action: string, path: string): void {
  try {
    appendFileSync(join(getUserDataDir(), 'shell.log'), `${new Date().toISOString()}\t${action}\t${path}\n`)
  } catch {
    // ignorieren
  }
}

function assertExists(path: string): void {
  if (typeof path !== 'string' || path.trim() === '') throw new Error('Es wurde kein Pfad angegeben.')
  if (!existsSync(path)) throw new Error(`Die Datei bzw. der Ordner wurde nicht gefunden: ${path}`)
}

/** Öffnet eine Datei/einen Ordner mit dem Standardprogramm. */
export async function openPath(path: string): Promise<void> {
  assertExists(path)
  if (isShellDisabled()) {
    logShell('openPath', path)
    return
  }
  const error = await shell.openPath(path)
  if (error) throw new Error(`Die Datei konnte nicht geöffnet werden: ${error}`)
}

/** Zeigt eine Datei im Finder/Explorer. */
export function showItemInFolder(path: string): void {
  assertExists(path)
  if (isShellDisabled()) {
    logShell('showItemInFolder', path)
    return
  }
  shell.showItemInFolder(path)
}
