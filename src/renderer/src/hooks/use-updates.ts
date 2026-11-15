import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UpdateStatus } from '@shared/types'
import { api } from '@/lib/api'
import { queryKeys } from './query-keys'

/**
 * Zustand des Updaters. Aktualisiert sich über das Main-Event `updates.statusChanged`
 * (siehe `MainEventsBridge` in App.tsx).
 */
export function useUpdateStatus() {
  return useQuery<UpdateStatus>({
    queryKey: queryKeys.updateStatus,
    queryFn: () => api.updates.getStatus(),
    staleTime: Infinity
  })
}

/** Suchen, Herunterladen, Installieren. Ergebnisse landen direkt im Status-Cache. */
export function useUpdateActions() {
  const queryClient = useQueryClient()
  const store = (status: UpdateStatus) => queryClient.setQueryData(queryKeys.updateStatus, status)
  const check = useMutation({ mutationFn: () => api.updates.check(), onSuccess: store })
  const download = useMutation({ mutationFn: () => api.updates.download(), onSuccess: store })
  const install = useMutation({ mutationFn: () => api.updates.install() })
  return { check, download, install }
}
