/**
 * Druck-Bestätigung (einzeln „erneut drucken“ und Bulk-Druck) mit Druckerwahl sowie die
 * Ergebnisliste bei Fehlern.
 */
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAppInfo, useAppSettings } from '@/hooks/use-app-settings'
import { usePrinters } from '@/hooks/use-printers'
import { belegeLabel } from './list-utils'
import type { InvoiceRef, PrintOutcome } from './use-invoice-actions'

interface PrintDialogProps {
  /** null = geschlossen */
  targets: InvoiceRef[] | null
  copies: number
  onOpenChange: (open: boolean) => void
  onConfirm: (targets: InvoiceRef[], printer: string | undefined) => Promise<void>
}

export function PrintDialog({ targets, copies, onOpenChange, onConfirm }: PrintDialogProps) {
  const open = targets !== null && targets.length > 0
  const printers = usePrinters()
  const { settings } = useAppSettings()
  const appInfo = useAppInfo()
  // gespeicherter Drucker bleibt wählbar, auch wenn er gerade nicht in der Systemliste steht
  const list = useMemo(() => {
    const system = printers.data ?? []
    const saved = settings?.defaultPrinter
    if (saved && !system.some((p) => p.name === saved)) {
      return [...system, { name: saved, displayName: `${saved} (nicht gefunden)`, isDefault: false }]
    }
    return system
  }, [printers.data, settings?.defaultPrinter])
  const [printer, setPrinter] = useState<string>('')
  const [busy, setBusy] = useState(false)

  // Vorauswahl beim Öffnen: gespeicherter Drucker, sonst Systemstandard, sonst erster
  useEffect(() => {
    if (!open) return
    const preferred =
      list.find((p) => p.name === settings?.defaultPrinter) ?? list.find((p) => p.isDefault) ?? list[0] ?? null
    setPrinter(preferred?.name ?? settings?.defaultPrinter ?? '')
    setBusy(false)
  }, [open, list, settings?.defaultPrinter])

  const count = targets?.length ?? 0
  const single = count === 1 ? targets![0]! : null
  const printerName = list.find((p) => p.name === printer)?.displayName ?? (printer || 'Standarddrucker')
  const copiesText = `${copies} ${copies === 1 ? 'Kopie' : 'Kopien'}`

  async function confirm() {
    if (!targets || busy) return
    setBusy(true)
    try {
      await onConfirm(targets, printer || undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md" data-testid="print-dialog">
        <DialogHeader>
          <DialogTitle>{single ? `Rechnung ${single.number} erneut drucken` : `${belegeLabel(count)} drucken`}</DialogTitle>
          <DialogDescription>
            Gedruckt wird jeweils das abgelegte PDF – Papier und Ablage stimmen damit überein.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="print-dialog-printer">Drucker</Label>
          {list.length > 0 ? (
            <Select value={printer} onValueChange={setPrinter}>
              <SelectTrigger id="print-dialog-printer" className="w-full min-w-0">
                <SelectValue placeholder="Drucker wählen" />
              </SelectTrigger>
              <SelectContent>
                {list.map((p) => (
                  <SelectItem key={p.name} value={p.name}>
                    <span className="truncate" title={p.displayName}>
                      {p.displayName}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
              {printers.isLoading ? 'Drucker werden gesucht …' : 'Kein Drucker gefunden – es wird der gespeicherte Standarddrucker verwendet.'}
            </p>
          )}
        </div>

        <p className="rounded-lg bg-muted px-3 py-2.5 text-sm" data-testid="print-confirm-text">
          {single
            ? `Auf „${printerName}“ drucken, ${copiesText}?`
            : `${belegeLabel(count)} auf „${printerName}“ drucken, je ${copiesText}?`}
        </p>
        {appInfo.data?.printDryRun ? (
          <p className="text-xs text-muted-foreground">Testmodus: Druckaufträge werden nur simuliert.</p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Abbrechen
          </Button>
          <Button onClick={() => void confirm()} disabled={busy} autoFocus>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Printer aria-hidden />}
            {busy ? 'Wird gedruckt …' : 'Drucken'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface PrintResultsDialogProps {
  outcomes: PrintOutcome[] | null
  onOpenChange: (open: boolean) => void
  onRetry: (failed: InvoiceRef[]) => void
}

/** Ergebnisliste nach einem Bulk-Druck mit Fehlern. */
export function PrintResultsDialog({ outcomes, onOpenChange, onRetry }: PrintResultsDialogProps) {
  const open = outcomes !== null
  const failed = (outcomes ?? []).filter((o) => !o.result.ok)
  const okCount = (outcomes ?? []).length - failed.length
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="print-results-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-warning-foreground dark:text-warning" aria-hidden />
            Nicht alle Belege wurden gedruckt
          </DialogTitle>
          <DialogDescription>
            {okCount > 0 ? `${belegeLabel(okCount)} gedruckt, ` : ''}
            {belegeLabel(failed.length)} mit Fehler. Die Belege selbst bleiben gültig.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-64 divide-y overflow-y-auto rounded-lg border">
          {failed.map((o) => (
            <li key={o.id} className="flex flex-col gap-0.5 px-3 py-2 text-sm">
              <span className="font-medium tabular-nums">{o.number}</span>
              <span className="text-muted-foreground">{o.result.error ?? 'Unbekannter Druckfehler.'}</span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Schließen
          </Button>
          <Button onClick={() => onRetry(failed.map((o) => ({ id: o.id, number: o.number })))}>
            <Printer aria-hidden />
            Fehlgeschlagene erneut drucken
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
