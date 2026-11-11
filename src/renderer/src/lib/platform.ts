/** Betriebssystem des Renderers (synchron, ohne IPC) – entspricht `AppInfo.platform`. */
export type Platform = 'darwin' | 'win32' | 'linux'

export function detectPlatform(): Platform {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  const raw = `${(nav as Navigator & { userAgentData?: { platform?: string } })?.userAgentData?.platform ?? ''} ${nav?.platform ?? ''} ${nav?.userAgent ?? ''}`
  if (/mac/i.test(raw)) return 'darwin'
  if (/win/i.test(raw)) return 'win32'
  return 'linux'
}

/** Aktuelle Plattform (aus `data-platform` am <html>, Fallback: Erkennung). */
export function getPlatform(): Platform {
  const value = typeof document !== 'undefined' ? document.documentElement.dataset.platform : undefined
  return value === 'darwin' || value === 'win32' || value === 'linux' ? value : detectPlatform()
}
