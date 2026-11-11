import { QueryClient } from '@tanstack/react-query'

/**
 * Gemeinsamer QueryClient. IPC-Aufrufe sind lokal und deterministisch → keine automatischen
 * Wiederholungen, kein Neuladen beim Fokuswechsel. Nach Mutationen gezielt invalidieren
 * (Schlüssel in `@/hooks/query-keys`).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 5_000
    },
    mutations: {
      retry: false
    }
  }
})
