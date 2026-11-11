/**
 * Daten-Hooks der Fest-Einstellungen (Feste inkl. archivierter, Ändern, Präfix-Kollision).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Festival, FestivalUpdateInput } from '@shared/types'
import { queryKeys } from '@/hooks/query-keys'
import { api } from '@/lib/api'

/** Query-Key für alle Feste inkl. archivierter (wird mit `['festivals']` mit invalidiert). */
export const allFestivalsKey = [...queryKeys.festivals, 'all'] as const

/** Alle Feste inkl. archivierter (Archiv-Liste, Präfix-Prüfung). */
export function useAllFestivals() {
  return useQuery<Festival[]>({
    queryKey: allFestivalsKey,
    queryFn: () => api.festivals.list({ includeArchived: true })
  })
}

/** `festivals.update` + Cache-Aktualisierung (`['festivals']`). */
export function useUpdateFestival() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: FestivalUpdateInput }) => api.festivals.update(id, patch),
    onSuccess: async (festival) => {
      if (!festival.archived) {
        queryClient.setQueryData<Festival[]>(queryKeys.festivals, (list) =>
          list?.map((f) => (f.id === festival.id ? festival : f))
        )
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.festivals })
    }
  })
}

/** Andere Feste (auch archivierte), die dasselbe Nummern-Präfix verwenden. */
export function findPrefixConflicts(festivals: readonly Festival[] | undefined, prefix: string, ownId: number | null): Festival[] {
  if (!festivals) return []
  return festivals.filter((f) => f.id !== ownId && f.numberPrefix === prefix)
}

/** „„A““, „„A“ und „B““, „„A“, „B“ und 2 weitere“ */
export function formatFestivalNames(festivals: readonly Festival[], max = 2): string {
  const names = festivals.map((f) => `„${f.name}“`)
  if (names.length <= 1) return names[0] ?? ''
  if (names.length <= max) return `${names.slice(0, -1).join(', ')} und ${names.at(-1)}`
  const rest = names.length - max
  return `${names.slice(0, max).join(', ')} und ${rest} ${rest === 1 ? 'weiteres' : 'weitere'}`
}
