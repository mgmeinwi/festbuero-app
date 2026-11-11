/**
 * Zentrale Zustandsänderungen des Main-Prozesses, die mehrere Stellen betreffen:
 * Einstellungen ändern (→ Theme, Fensterfarben, Menü, Renderer benachrichtigen) und Fensterfarben.
 */
import { nativeTheme, type BrowserWindow } from 'electron'
import type { AppSettings } from '@shared/types'
import { getSettings, updateSettings } from './services/settings'
import { emitToRenderer, getMainWindow } from './window'

/** Höhe der App-Kopfleiste in px (Ampel/Windows-Knöpfe sitzen darin). Muss zu `h-12` im Renderer passen. */
export const TITLEBAR_HEIGHT = 48

/** Fensterfarben passend zu den CSS-Variablen `--background`/`--foreground` (globals.css). */
export function getWindowColors(): { background: string; symbol: string } {
  return nativeTheme.shouldUseDarkColors
    ? { background: '#0c1015', symbol: '#eceff2' }
    : { background: '#fbfcfd', symbol: '#121922' }
}

/** Hintergrund und Windows-Titelleisten-Overlay an das aktuelle Theme anpassen. */
export function applyWindowTheme(win: BrowserWindow | null = getMainWindow()): void {
  if (!win || win.isDestroyed()) return
  const colors = getWindowColors()
  win.setBackgroundColor(colors.background)
  if (process.platform !== 'darwin') {
    try {
      win.setTitleBarOverlay({ color: colors.background, symbolColor: colors.symbol, height: TITLEBAR_HEIGHT })
    } catch {
      // Overlay nicht aktiv
    }
  }
}

type SettingsListener = (settings: AppSettings, patch: Partial<AppSettings>) => void
const listeners = new Set<SettingsListener>()

/** Benachrichtigung nach jeder Einstellungsänderung (z. B. Menü neu aufbauen). */
export function onSettingsChanged(listener: SettingsListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Einstellungen ändern – für IPC (`app.updateSettings`) und Menü. Setzt das Theme, passt die
 * Fensterfarben an und meldet die neuen Einstellungen an den Renderer (`app.settingsChanged`).
 */
export function changeSettings(patch: Partial<AppSettings>): AppSettings {
  const settings = updateSettings(patch)
  if ('theme' in patch) {
    nativeTheme.themeSource = settings.theme
    applyWindowTheme()
  }
  emitToRenderer('app.settingsChanged', settings)
  for (const listener of listeners) {
    try {
      listener(settings, patch)
    } catch (err) {
      console.error('[settings] Listener fehlgeschlagen:', err)
    }
  }
  return settings
}

/** Aktuelle Einstellungen oder Standardwerte, falls die DB (noch) nicht offen ist. */
export function safeGetSettings(): AppSettings | null {
  try {
    return getSettings()
  } catch {
    return null
  }
}
