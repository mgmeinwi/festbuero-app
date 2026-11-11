/**
 * Storno-Dialog: Pflichtfeld Grund, klare Erklärung, zwei Wege („Stornieren“ bzw.
 * „Stornieren und neu erstellen“).
 */
import { useEffect, useId, useRef, useState } from 'react'
import { AlertTriangle, Loader2, RotateCcw, Undo2 } from 'lucide-react'
import { formatEuro } from '@shared/money'
import { formatDate } from '@shared/dates'
import type { InvoiceListItem } from '@shared/types'
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
import { Textarea } from '@/components/ui/textarea'

export type StornoMode = 'storno' | 'recreate'

interface StornoDialogProps {
  invoice: InvoiceListItem | null
  onOpenChange: (open: boolean) => void
  /** führt den Storno aus; wirft bei Fehler (Dialog bleibt offen) */
  onConfirm: (invoice: InvoiceListItem, reason: string, mode: StornoMode) => Promise<void>
}

export function StornoDialog({ invoice, onOpenChange, onConfirm }: StornoDialogProps) {
  const open = invoice !== null
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState<StornoMode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const reasonId = useId()
  const errorId = useId()

  useEffect(() => {
    if (open) {
      setReason('')
      setTouched(false)
      setBusy(null)
      setError(null)
    }
  }, [open, invoice?.id])

  const missing = reason.trim() === ''
  const showMissing = touched && missing

  async function submit(mode: StornoMode) {
    if (!invoice || busy) return
    setTouched(true)
    if (missing) {
      textareaRef.current?.focus()
      return
    }
    setBusy(mode)
    setError(null)
    try {
      await onConfirm(invoice, reason.trim(), mode)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Der Storno ist fehlgeschlagen.')
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent
        className="sm:max-w-xl"
        data-testid="storno-dialog"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          textareaRef.current?.focus({ preventScroll: true })
        }}
      >
        <DialogHeader className="text-left">
          <DialogTitle>Rechnung {invoice?.number} stornieren</DialogTitle>
          <DialogDescription className="truncate" title={invoice?.customerLabel}>
            {invoice ? (
              <>
                {invoice.customerLabel} · {formatDate(invoice.invoiceDate, 'DE')} ·{' '}
                <span className="font-medium text-foreground tabular-nums">{formatEuro(invoice.totalGrossCents)}</span>
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-1 rounded-lg bg-muted px-3 py-2.5 text-sm text-muted-foreground">
          <li className="flex gap-2">
            <span aria-hidden>•</span>
            <span>
              Es entsteht ein <strong className="font-medium text-foreground">Stornobeleg mit neuer Nummer</strong> aus
              derselben Reihe – alle Positionen und Beträge negativ.
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden>•</span>
            <span>Er wird als PDF abgelegt und auf dem Standarddrucker gedruckt.</span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden>•</span>
            <span>
              Die Rechnung bleibt sichtbar und wird „storniert“.{' '}
              <strong className="font-medium text-foreground">Das lässt sich nicht rückgängig machen.</strong>
            </span>
          </li>
        </ul>

        <div className="space-y-2">
          <Label htmlFor={reasonId}>
            Grund <span className="text-destructive">*</span>
            <span className="sr-only">(Pflichtfeld)</span>
          </Label>
          <Textarea
            id={reasonId}
            ref={textareaRef}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => reason !== '' && setTouched(true)}
            placeholder="z. B. falsche Personenzahl"
            rows={2}
            maxLength={500}
            className="min-h-16 scroll-mb-28"
            required
            aria-required="true"
            aria-invalid={showMissing || undefined}
            aria-describedby={showMissing ? errorId : undefined}
            disabled={busy !== null}
          />
          {showMissing ? (
            <p id={errorId} className="text-sm text-destructive" role="alert">
              Bitte einen Grund für den Storno angeben.
            </p>
          ) : null}
        </div>

        {error ? (
          <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}

        {/* bleibt bei kleiner Fensterhöhe sichtbar (Dialog scrollt intern) */}
        <DialogFooter className="sticky -bottom-6 z-10 -mx-6 -mb-6 flex-row flex-wrap justify-end gap-2 border-t bg-background px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy !== null}>
            Abbrechen
          </Button>
          <Button variant="outline" onClick={() => void submit('recreate')} disabled={busy !== null}>
            {busy === 'recreate' ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />}
            Stornieren und neu erstellen
          </Button>
          <Button variant="destructive" onClick={() => void submit('storno')} disabled={busy !== null}>
            {busy === 'storno' ? <Loader2 className="animate-spin" aria-hidden /> : <Undo2 aria-hidden />}
            Stornieren
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
