/**
 * Zugriff auf das Hauptfenster (z. B. für Druckerliste, Dialoge, Events an den Renderer).
 */
import type { BrowserWindow } from 'electron'
import type { MainEventName, MainEvents } from '@shared/ipc'

let mainWindow: BrowserWindow | null = null

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win
}

/** Hauptfenster oder null (z. B. vor dem Start oder nach dem Schließen). */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

/** Hauptfenster oder deutscher Fehler. */
export function requireMainWindow(): BrowserWindow {
  const win = getMainWindow()
  if (!win) throw new Error('Das Hauptfenster ist nicht verfügbar.')
  return win
}

/** Sendet ein typisiertes Event an den Renderer (`window.festbuero.on(event, cb)`). */
export function emitToRenderer<E extends MainEventName>(event: E, payload: MainEvents[E]): void {
  const win = getMainWindow()
  if (win && !win.webContents.isDestroyed()) win.webContents.send(event, payload)
}
