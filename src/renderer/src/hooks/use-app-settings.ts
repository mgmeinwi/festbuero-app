import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AppInfo, AppSettings } from '@shared/types'
import { api } from '@/lib/api'
import { queryKeys } from './query-keys'

/**
 * App-Einstellungen (pro Rechner).
 *   const { settings, updateSettings } = useAppSettings()
 *   await updateSettings({ theme: 'dark' })
 */
export function useAppSettings() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => api.app.getSettings(),
    staleTime: Infinity
  })

  const mutation = useMutation({
    mutationFn: (patch: Partial<AppSettings>) => api.app.updateSettings(patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.settings })
      const previous = queryClient.getQueryData<AppSettings>(queryKeys.settings)
      if (previous) queryClient.setQueryData<AppSettings>(queryKeys.settings, { ...previous, ...patch })
      return { previous }
    },
    onError: (_err, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.settings, context.previous)
    },
    onSuccess: (settings, patch) => {
      queryClient.setQueryData(queryKeys.settings, settings)
      if ('defaultPrinter' in patch) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.printerStatus })
      }
    }
  })

  return {
    settings: query.data,
    isLoading: query.isLoading,
    error: query.error,
    updateSettings: mutation.mutateAsync,
    isUpdating: mutation.isPending
  }
}

/** Versions-/Pfadinformationen der App. */
export function useAppInfo() {
  return useQuery<AppInfo>({
    queryKey: queryKeys.appInfo,
    queryFn: () => api.app.getInfo(),
    staleTime: Infinity
  })
}
