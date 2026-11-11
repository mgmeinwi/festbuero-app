/**
 * Aktionen der Rechnungsliste mit Toasts und Cache-Invalidierung:
 * PDF öffnen/exportieren, ZIP, Excel, (Bulk-)Druck, Storno.
 */
import { useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { FinalizeResult, PrintResult } from '@shared/types'
import { queryKeys } from '@/hooks/query-keys'
import { usePrinters } from '@/hooks/use-printers'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/utils'
import { belegenLabel } from './list-utils'

export interface InvoiceRef {
  id: number
  number: string
}

export interface PrintOutcome {
  id: number
  number: string
  result: PrintResult
}

/** Dateiname aus einem Pfad (Windows und macOS). */
export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

function copiesLabel(copies: number): string {
  return `${copies} ${copies === 1 ? 'Kopie' : 'Kopien'}`
}

export function useInvoiceActions(festivalId: number) {
  const queryClient = useQueryClient()
  const printers = usePrinters()

  const printerLabel = useCallback(
    (name: string | null | undefined): string => {
      if (!name) return 'Standarddrucker'
      return printers.data?.find((p) => p.name === name)?.displayName ?? name
    },
    [printers.data]
  )

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.invoices(festivalId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.evaluation(festivalId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.clubs(festivalId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.festivals })
  }, [queryClient, festivalId])

  const toastSaved = useCallback((title: string, path: string) => {
    toast.success(title, {
      description: baseName(path),
      action: {
        label: 'Im Ordner zeigen',
        onClick: () => {
          api.app.showItemInFolder(path).catch((err: unknown) => toast.error(errorMessage(err)))
        }
      }
    })
  }, [])

  const openPdf = useCallback(
    async (inv: InvoiceRef) => {
      try {
        await api.invoices.openPdf(inv.id)
        toast.success(`PDF ${inv.number} wird geöffnet.`)
      } catch (err) {
        toast.error(errorMessage(err))
      } finally {
        invalidate()
      }
    },
    [invalidate]
  )

  const exportPdf = useCallback(
    async (inv: InvoiceRef) => {
      try {
        const path = await api.invoices.exportPdf(inv.id)
        if (path) toastSaved(`PDF ${inv.number} gespeichert`, path)
      } catch (err) {
        toast.error(errorMessage(err))
      }
    },
    [toastSaved]
  )

  const exportZip = useCallback(
    async (ids: number[]) => {
      if (ids.length === 0) return void toast.info('Keine Belege zum Exportieren.')
      try {
        const path = await api.invoices.exportZip(ids)
        if (path) toastSaved(`ZIP mit ${belegenLabel(ids.length)} gespeichert`, path)
      } catch (err) {
        toast.error(errorMessage(err))
      } finally {
        invalidate()
      }
    },
    [toastSaved, invalidate]
  )

  /** `ids` undefined = alle Belege des Fests. */
  const exportExcel = useCallback(
    async (ids: number[] | undefined, count: number) => {
      if (count === 0) return void toast.info('Keine Belege zum Exportieren.')
      try {
        const path = await api.invoices.exportListExcel(festivalId, ids)
        if (path) toastSaved(`Excel-Liste mit ${belegenLabel(count)} gespeichert`, path)
      } catch (err) {
        toast.error(errorMessage(err))
      }
    },
    [festivalId, toastSaved]
  )

  /** Druckt einen oder mehrere Belege; liefert die Ergebnisse (Fehler pro Beleg). */
  const print = useCallback(
    async (targets: InvoiceRef[], printer: string | undefined): Promise<PrintOutcome[]> => {
      const opts = printer ? { printer } : undefined
      try {
        if (targets.length === 1) {
          const t = targets[0]!
          const result = await api.invoices.print(t.id, opts)
          return [{ id: t.id, number: t.number, result }]
        }
        const results = await api.invoices.printMany(
          targets.map((t) => t.id),
          opts
        )
        const byId = new Map(targets.map((t) => [t.id, t.number]))
        return results.map((r) => ({ id: r.id, number: byId.get(r.id) ?? String(r.id), result: r.result }))
      } finally {
        invalidate()
      }
    },
    [invalidate]
  )

  /** Toast für ein Druckergebnis (Erfolg bzw. deutliche Warnung mit „Erneut drucken“). */
  const toastPrint = useCallback(
    (label: string, result: PrintResult, onRetry?: () => void) => {
      if (result.ok) {
        toast.success(`${label} gedruckt`, {
          description: `${copiesLabel(result.copies)} auf „${printerLabel(result.printer)}“${
            result.dryRun ? ' – Testmodus, nur simuliert' : ''
          }`
        })
      } else {
        toast.warning(`${label} wurde nicht gedruckt`, {
          description: result.error ?? 'Der Drucker hat den Auftrag nicht angenommen.',
          duration: 12_000,
          action: onRetry ? { label: 'Erneut drucken', onClick: onRetry } : undefined
        })
      }
    },
    [printerLabel]
  )

  const storno = useCallback(
    async (inv: InvoiceRef, reason: string): Promise<FinalizeResult> => {
      try {
        return await api.invoices.storno(inv.id, reason)
      } finally {
        invalidate()
      }
    },
    [invalidate]
  )

  return useMemo(
    () => ({ openPdf, exportPdf, exportZip, exportExcel, print, toastPrint, storno, printerLabel, invalidate }),
    [openPdf, exportPdf, exportZip, exportExcel, print, toastPrint, storno, printerLabel, invalidate]
  )
}

export type InvoiceActions = ReturnType<typeof useInvoiceActions>
