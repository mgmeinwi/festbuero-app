/**
 * Aktionen, die Ersteinrichtung (/setup) und App-Einstellungen (/einstellungen) gemeinsam nutzen:
 * Testseite drucken, Beispiel-Fest anlegen, Datensicherung erstellen.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Festival, PrintResult } from '@shared/types'
import { queryKeys } from '@/hooks/query-keys'
import { api } from '@/lib/api'
import { errorMessage, isMac } from '@/lib/utils'

/** „Finder“ bzw. „Explorer“ für Button-Beschriftungen. */
export const FOLDER_APP = isMac ? 'Finder' : 'Explorer'

/** Vorschlag für den Dokumentenordner (`<Dokumente>/Festbüro`). */
export function useDefaultDocumentsDir() {
  return useQuery<string>({
    queryKey: ['defaultDocumentsDir'],
    queryFn: () => api.app.getDefaultDocumentsDir(),
    staleTime: Infinity
  })
}

/** Toast-Text zum Ergebnis einer Testseite. */
function reportTestPage(result: PrintResult, printerLabel: string): void {
  if (result.ok) {
    const copies = result.copies > 1 ? ` (${result.copies} Kopien)` : ''
    if (result.dryRun) {
      toast.success(`Testseite für „${printerLabel}“ simuliert${copies}.`, {
        description: 'In dieser Umgebung wird nichts an den Drucker gesendet.'
      })
    } else {
      toast.success(`Testseite an „${printerLabel}“ gesendet${copies}.`, {
        description: 'Bitte prüfen, ob die Seite vollständig und ohne Druckdialog gedruckt wurde.'
      })
    }
  } else {
    toast.error(result.error ?? `Die Testseite konnte nicht auf „${printerLabel}“ gedruckt werden.`)
  }
}

/** Testseite mit Musterrechnung (wird nicht als Rechnung gespeichert). */
export function usePrintTestPage() {
  const mutation = useMutation({
    mutationFn: (args: { festivalId: number; printer: string; printerLabel: string }) =>
      api.printing.printTestPage(args.festivalId, { printer: args.printer }),
    onSuccess: (result, args) => reportTestPage(result, args.printerLabel),
    onError: (err) => toast.error(errorMessage(err))
  })
  return {
    printTestPage: (festivalId: number, printer: string, printerLabel = printer) =>
      mutation.mutate({ festivalId, printer, printerLabel }),
    isPending: mutation.isPending
  }
}

/** Beispiel-Fest anlegen; `onCreated` erhält das neue Fest (es wird nicht automatisch aktiv). */
export function useCreateSampleFestival(onCreated?: (festival: Festival) => void | Promise<void>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.app.createSampleFestival(),
    onSuccess: async (festival) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.festivals })
      await onCreated?.(festival)
    },
    onError: (err) => toast.error(errorMessage(err))
  })
}

/** Datensicherung erstellen; Toast mit „Im Finder zeigen“. */
export function useCreateBackup(onCreated?: (path: string) => void) {
  return useMutation({
    mutationFn: () => api.app.createBackup(),
    onSuccess: ({ path }) => {
      const name = path.split(/[\\/]/).pop() ?? path
      toast.success('Datensicherung erstellt.', {
        description: name,
        action: {
          label: `Im ${FOLDER_APP} zeigen`,
          onClick: () => {
            api.app.showItemInFolder(path).catch((err: unknown) => toast.error(errorMessage(err)))
          }
        }
      })
      onCreated?.(path)
    },
    onError: (err) => toast.error(errorMessage(err))
  })
}
