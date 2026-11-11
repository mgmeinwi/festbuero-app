/**
 * Vorschau einer abgeschlossenen Rechnung bzw. eines Stornos – gerendert aus dem gespeicherten
 * Snapshot (`invoiceToRenderData`), mit der Vorlage und dem Logo des Belegs.
 */
import { useQuery } from '@tanstack/react-query'
import { FileDown, FileText, Loader2, Printer, Undo2 } from 'lucide-react'
import { formatDate } from '@shared/dates'
import { invoiceToRenderData } from '@shared/invoice-render'
import { formatEuro } from '@shared/money'
import type { InvoiceListItem } from '@shared/types'
import { InvoicePreview } from '@/components/invoice-preview/InvoicePreview'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/utils'
import { StatusBadge } from './StatusBadge'
import { statusKey } from './list-utils'

interface PreviewDialogProps {
  invoice: InvoiceListItem | null
  onOpenChange: (open: boolean) => void
  onOpenPdf: (item: InvoiceListItem) => void
  onPrint: (item: InvoiceListItem) => void
  onExportPdf: (item: InvoiceListItem) => void
  onStorno: (item: InvoiceListItem) => void
}

export function PreviewDialog({ invoice, onOpenChange, onOpenPdf, onPrint, onExportPdf, onStorno }: PreviewDialogProps) {
  const open = invoice !== null
  const detail = useQuery({
    queryKey: ['invoice', invoice?.id],
    queryFn: () => api.invoices.get(invoice!.id),
    enabled: open
  })
  const logoFile = detail.data?.logoFile ?? null
  const logo = useQuery({
    queryKey: ['logoDataUrl', logoFile],
    queryFn: async () => {
      try {
        return await api.templates.getLogoDataUrl(logoFile!)
      } catch {
        return null
      }
    },
    enabled: open && logoFile !== null,
    staleTime: Infinity
  })
  const logoReady = logoFile === null || !logo.isLoading
  const canStorno = invoice !== null && statusKey(invoice) === 'abgeschlossen'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-3xl" data-testid="preview-dialog">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="tabular-nums">
              {invoice?.type === 'storno' ? 'Storno' : 'Rechnung'} {invoice?.number}
            </span>
            {invoice ? <StatusBadge item={invoice} showReference={false} /> : null}
          </DialogTitle>
          <DialogDescription className="truncate">
            {invoice
              ? `${invoice.customerLabel} · ${formatDate(invoice.invoiceDate, 'DE')} · ${formatEuro(invoice.totalGrossCents)}`
              : ''}
          </DialogDescription>
        </DialogHeader>

        {invoice ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => onOpenPdf(invoice)}>
              <FileText aria-hidden />
              PDF öffnen
            </Button>
            <Button size="sm" variant="outline" onClick={() => onPrint(invoice)}>
              <Printer aria-hidden />
              Erneut drucken …
            </Button>
            <Button size="sm" variant="outline" onClick={() => onExportPdf(invoice)}>
              <FileDown aria-hidden />
              PDF exportieren …
            </Button>
            {canStorno ? (
              <Button
                size="sm"
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => onStorno(invoice)}
              >
                <Undo2 aria-hidden />
                Stornieren …
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="rounded-lg bg-muted/60 p-3 sm:p-4">
          {detail.isError ? (
            <p className="py-10 text-center text-sm text-destructive" role="alert">
              Die Rechnung konnte nicht geladen werden: {errorMessage(detail.error)}
            </p>
          ) : detail.data && logoReady ? (
            <InvoicePreview
              data={invoiceToRenderData(detail.data)}
              template={detail.data.template}
              logoDataUrl={logo.data ?? null}
              className="mx-auto max-w-[680px]"
            />
          ) : (
            <div className="relative mx-auto aspect-[210/297] max-w-[680px]">
              <Skeleton className="absolute inset-0" />
              <Loader2 className="absolute top-1/2 left-1/2 size-6 -translate-1/2 animate-spin text-muted-foreground" aria-label="Lädt" />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
