import { useEffect, useSyncExternalStore } from 'react'
import type { ThemePreference } from '@shared/types'
import { useAppSettings } from './use-app-settings'

const DARK_QUERY = '(prefers-color-scheme: dark)'

function subscribeSystemTheme(callback: () => void): () => void {
  const mql = window.matchMedia(DARK_QUERY)
  mql.addEventListener('change', callback)
  return () => mql.removeEventListener('change', callback)
}

function getSystemDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches
}

/** true, wenn das Betriebssystem den Dunkelmodus nutzt (reaktiv). */
export function useSystemPrefersDark(): boolean {
  return useSyncExternalStore(subscribeSystemTheme, getSystemDark, () => false)
}

/** Effektives Theme ('light' | 'dark') aus AppSettings.theme ('system' folgt dem OS). */
export function useResolvedTheme(): 'light' | 'dark' {
  const { settings } = useAppSettings()
  const systemDark = useSystemPrefersDark()
  const pref: ThemePreference = settings?.theme ?? 'system'
  if (pref === 'system') return systemDark ? 'dark' : 'light'
  return pref
}

/** Setzt die Klasse `.dark` auf <html> passend zum Theme. Einmal in App.tsx verwenden. */
export function useApplyTheme(): void {
  const resolved = useResolvedTheme()
  useEffect(() => {
    applyThemeClass(resolved)
  }, [resolved])
}

export function applyThemeClass(theme: 'light' | 'dark'): void {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
}
