import { useRef, useState, type ReactNode } from 'react'
import { CircleCheck, FileText, FileWarning, Info, Loader2, Printer, Plus, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { customerLabel } from '@shared/invoice-draft'
import { formatEuro } from '@shared/money'
import type { FinalizeResult, PrintResult } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAppSettings } from '@/hooks/use-app-settings'
import { usePrinters } from '@/hooks/use-printers'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/utils'

interface SuccessDialogProps {
  result: FinalizeResult
  /** „Neue Rechnung“ bzw. Dialog schließen → Maske zurücksetzen */
  onNewInvoice: () => void
}

function copiesText(n: number): string {
  return n === 1 ? '1 Exemplar' : `${n} Exemplare`
}

/**
 * Erfolgsmeldung nach dem Abschluss mit Druck-/PDF-Status, „Erneut drucken“, „PDF öffnen“, „Neue Rechnung“.
 * Pro Rechnung neu einhängen (`key={invoice.id}`), der Zustand startet mit dem Ergebnis des Abschlusses.
 */
export function SuccessDialog({ result, onNewInvoice }: SuccessDialogProps) {
  const newButtonRef = useRef<HTMLButtonElement>(null)
  const [print, setPrint] = useState<PrintResult>(result.print)
  const [printing, setPrinting] = useState(false)
  const [printer, setPrinter] = useState<string | null>(result.print.printer ?? null)
  const { settings, updateSettings } = useAppSettings()
  const { data: printers = [] } = usePrinters()

  const { invoice, pdf } = result
  const printFailed = !print.ok
  const selectedPrinter =
    printer ?? settings?.defaultPrinter ?? printers.find((p) => p.isDefault)?.name ?? printers[0]?.name ?? null

  async function reprint() {
    if (printing) return
    setPrinting(true)
    try {
      const opts = printFailed && selectedPrinter ? { printer: selectedPrinter } : undefined
      const res = await api.invoices.print(invoice.id, opts)
      setPrint(res)
      if (res.ok) {
        const where = res.printer
          ? ` an „${printers.find((p) => p.name === res.printer)?.displayName ?? res.printer}“`
          : ''
        if (res.dryRun) toast.success(`Druck simuliert${where}.`)
        else toast.success(`Rechnung wird gedruckt${where}.`)
        if (res.printer && res.printer !== settings?.defaultPrinter) {
          const name = res.printer
          toast(`„${name}“ als Standarddrucker verwenden?`, {
            action: {
              label: 'Übernehmen',
              onClick: () => void updateSettings({ defaultPrinter: name }).catch(() => undefined)
            }
          })
        }
      } else {
        toast.error(res.error ?? 'Drucken fehlgeschlagen.')
      }
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setPrinting(false)
    }
  }

  async function openPdf() {
    try {
      await api.invoices.openPdf(invoice.id)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const printerDisplay = (name: string | null) =>
    name ? (printers.find((p) => p.name === name)?.displayName ?? name) : null
  // Gespeicherter/benutzter Drucker steht ggf. nicht (mehr) in der Systemliste → trotzdem anzeigen
  const printerOptions =
    selectedPrinter && !printers.some((p) => p.name === selectedPrinter)
      ? [...printers, { name: selectedPrinter, displayName: `${selectedPrinter} (nicht gefunden)`, isDefault: false }]
      : printers
  const label = customerLabel(invoice.customer)

  return (
    <Dialog open onOpenChange={(o) => !o && onNewInvoice()}>
      <DialogContent
        className="grid-cols-[minmax(0,1fr)] gap-4 sm:max-w-lg"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          newButtonRef.current?.focus()
        }}
        onInteractOutside={(e) => e.preventDefault()}
        data-testid="success-dialog"
      >
        <DialogHeader className="flex-row items-center gap-3 pr-8 text-left sm:text-left">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
            <CircleCheck className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 space-y-1">
            <DialogTitle className="text-lg">Rechnung {invoice.number} abgeschlossen</DialogTitle>
            <DialogDescription className="truncate" title={label}>
              {label}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="rounded-lg bg-muted/60 px-3 py-3 text-center [@media(max-height:700px)]:py-2">
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Endbetrag</div>
          <div
            className="text-4xl leading-tight font-bold tracking-tight tabular-nums [@media(max-height:700px)]:text-3xl"
            data-testid="success-total"
          >
            {formatEuro(invoice.totals.grossCents)}
          </div>
          <div className="text-sm text-muted-foreground" data-testid="success-number">
            Rechnungsnummer <span className="font-semibold text-foreground">{invoice.number}</span>
          </div>
        </div>

        <div className="space-y-2">
          {print.ok ? (
            print.dryRun ? (
              <StatusLine icon={<Info className="size-4" aria-hidden />} testId="print-status" tone="muted">
                Druck simuliert ({copiesText(print.copies)}
                {print.printer ? `, ${printerDisplay(print.printer)}` : ''}) – es wurde nichts gedruckt.
              </StatusLine>
            ) : (
              <StatusLine icon={<Printer className="size-4" aria-hidden />} testId="print-status" tone="success">
                {copiesText(print.copies)} an „{printerDisplay(print.printer) ?? 'Drucker'}“ gesendet.
              </StatusLine>
            )
          ) : (
            <div
              role="alert"
              className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
              data-testid="print-error"
            >
              <div className="flex gap-2">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                <div className="min-w-0 space-y-1">
                  <p className="font-semibold text-destructive">Drucken fehlgeschlagen</p>
                  <p className="break-words">{print.error ?? 'Unbekannter Druckfehler.'}</p>
                  <p className="text-muted-foreground">
                    Die Rechnung ist trotzdem gültig und gespeichert. Bitte Drucker prüfen und unten erneut drucken.
                  </p>
                </div>
              </div>
            </div>
          )}

          {pdf.ok ? (
            <StatusLine icon={<FileText className="size-4" aria-hidden />} testId="pdf-status" tone="muted">
              <span className="block truncate" title={pdf.path ?? undefined}>
                PDF abgelegt{pdf.path ? `: ${pdf.path.split(/[\\/]/).pop()}` : ''}
              </span>
            </StatusLine>
          ) : (
            <div
              role="alert"
              className="flex gap-2 rounded-lg border border-warning/60 bg-warning/15 p-3 text-sm"
              data-testid="pdf-error"
            >
              <FileWarning className="mt-0.5 size-4 shrink-0 text-warning-foreground dark:text-warning" aria-hidden />
              <div className="min-w-0 space-y-1">
                <p className="font-semibold">PDF konnte nicht erstellt werden</p>
                {pdf.error ? <p className="break-words">{pdf.error}</p> : null}
                <p className="text-muted-foreground">
                  Die Rechnung ist gültig. Das PDF wird beim nächsten Öffnen der Rechnung automatisch nachgeholt.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Aktionen bleiben auch bei 560 px Fensterhöhe sichtbar (sticky im Scrollbereich des Dialogs) */}
        <div className="sticky -bottom-6 -mx-6 -mb-6 grid grid-cols-2 gap-2 border-t bg-background px-6 pt-3 pb-6">
          {printFailed ? (
            <div className="col-span-2 flex flex-wrap items-center gap-2">
              <Select
                value={selectedPrinter ?? undefined}
                onValueChange={setPrinter}
                disabled={printerOptions.length === 0}
              >
                <SelectTrigger className="min-w-0 flex-1 basis-48" aria-label="Drucker für den erneuten Druck">
                  <SelectValue
                    placeholder={printerOptions.length === 0 ? 'Keine Drucker gefunden' : 'Drucker wählen'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {printerOptions.map((p) => (
                    <SelectItem key={p.name} value={p.name}>
                      {p.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                onClick={reprint}
                disabled={printing}
                className="border-destructive/50 text-destructive hover:text-destructive"
                data-testid="retry-print"
              >
                {printing ? <Loader2 className="animate-spin" aria-hidden /> : <Printer aria-hidden />}
                Erneut drucken
              </Button>
            </div>
          ) : (
            <Button variant="outline" onClick={reprint} disabled={printing} data-testid="reprint">
              {printing ? <Loader2 className="animate-spin" aria-hidden /> : <Printer aria-hidden />}
              Erneut drucken
            </Button>
          )}
          <Button
            variant="outline"
            onClick={openPdf}
            className={printFailed ? 'h-12' : undefined}
            data-testid="open-pdf"
          >
            <FileText aria-hidden />
            PDF öffnen
          </Button>
          <Button
            ref={newButtonRef}
            size="lg"
            onClick={onNewInvoice}
            className={printFailed ? undefined : 'col-span-2'}
            data-testid="new-invoice"
          >
            <Plus aria-hidden />
            Neue Rechnung
            <span className="hidden text-xs font-normal opacity-75 sm:inline">(Enter)</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function StatusLine({
  icon,
  children,
  tone,
  testId
}: {
  icon: ReactNode
  children: ReactNode
  tone: 'muted' | 'success'
  testId: string
}) {
  return (
    <div
      className={
        tone === 'success'
          ? 'flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-sm text-success'
          : 'flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground'
      }
      data-testid={testId}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  )
}
