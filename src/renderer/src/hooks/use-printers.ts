import { useQuery } from '@tanstack/react-query'
import type { PrinterInfo, PrinterStatus } from '@shared/types'
import { api } from '@/lib/api'
import { queryKeys } from './query-keys'

/** Installierte Drucker. */
export function usePrinters() {
  return useQuery<PrinterInfo[]>({
    queryKey: queryKeys.printers,
    queryFn: () => api.printing.listPrinters(),
    staleTime: 30_000
  })
}

/** Status des gespeicherten Standarddruckers (für die Warnung in der Kopfleiste). */
export function usePrinterStatus() {
  return useQuery<PrinterStatus>({
    queryKey: queryKeys.printerStatus,
    queryFn: () => api.printing.getStatus(),
    staleTime: 30_000,
    refetchInterval: 60_000
  })
}
