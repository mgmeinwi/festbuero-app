import { useSyncExternalStore } from 'react'

/** Reaktiver Media-Query, z. B. `useMediaQuery('(min-width: 1280px)')`. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (callback) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', callback)
      return () => mql.removeEventListener('change', callback)
    },
    () => window.matchMedia(query).matches,
    () => false
  )
}

/** Tailwind-Standard-Breakpoints (siehe Responsive-Vertrag in docs/architecture.md). */
export const BREAKPOINTS = { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 } as const

/** true ab dem angegebenen Breakpoint (min-width). */
export function useBreakpoint(bp: keyof typeof BREAKPOINTS): boolean {
  return useMediaQuery(`(min-width: ${BREAKPOINTS[bp]}px)`)
}
