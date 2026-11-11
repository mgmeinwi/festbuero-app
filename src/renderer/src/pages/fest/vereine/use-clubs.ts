/**
 * Daten der Vereinsseite (react-query). Nach Änderungen werden Vereinsliste und Auswertung
 * („Vereine ohne Rechnung“) invalidiert.
 */
import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Club } from '@shared/types'
import { queryKeys } from '@/hooks/query-keys'
import { api } from '@/lib/api'

export function useClubs(festivalId: number | null) {
  return useQuery<Club[]>({
    queryKey: queryKeys.clubs(festivalId),
    queryFn: () => api.clubs.list(festivalId as number),
    enabled: festivalId !== null
  })
}

export function useInvalidateClubs(festivalId: number | null) {
  const queryClient = useQueryClient()
  return useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.clubs(festivalId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.evaluation(festivalId) })
    ])
  }, [queryClient, festivalId])
}
