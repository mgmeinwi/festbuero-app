import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Festival } from '@shared/types'
import { api } from '@/lib/api'
import { queryKeys } from './query-keys'
import { useAppSettings } from './use-app-settings'

/** Alle nicht archivierten Feste (Kopfleiste). */
export function useFestivals() {
  return useQuery<Festival[]>({
    queryKey: queryKeys.festivals,
    queryFn: () => api.festivals.list()
  })
}

/**
 * Das aktive Gründungsfest (aus `lastFestivalId`; Fallback: erstes nicht archiviertes Fest).
 *   const { festival, festivalId, setActiveFestival } = useActiveFestival()
 * `festivalId` ist null, solange kein Fest existiert → Hinweis „Bitte zuerst ein Gründungsfest anlegen“.
 */
export function useActiveFestival() {
  const { settings, updateSettings, isLoading: settingsLoading } = useAppSettings()
  const festivalsQuery = useFestivals()
  const festivals = festivalsQuery.data ?? []

  const festival: Festival | null =
    festivals.find((f) => f.id === settings?.lastFestivalId) ?? festivals[0] ?? null

  const setActiveFestival = useCallback(
    async (id: number) => {
      await updateSettings({ lastFestivalId: id })
    },
    [updateSettings]
  )

  return {
    festival,
    festivalId: festival?.id ?? null,
    festivals,
    isLoading: settingsLoading || festivalsQuery.isLoading,
    setActiveFestival
  }
}
