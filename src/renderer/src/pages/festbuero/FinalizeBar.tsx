import { useId, useState, type Ref } from 'react'
import { CalendarDays, Eye, EyeOff, Loader2, Printer, RotateCcw } from 'lucide-react'
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import { formatDate } from '@shared/dates'
import { formatEuro } from '@shared/money'
import type { InvoiceTotals, IsoDate, PaymentKind, PaymentMethod } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn, modKey } from '@/lib/utils'

interface FinalizeBarProps {
  totals: InvoiceTotals
  taxExempt: boolean
  paymentMethods: PaymentMethod[]
  paymentKind: PaymentKind
  onPaymentChange: (kind: PaymentKind) => void
  /** wirksame Daten */
  invoiceDate: IsoDate
  serviceDate: IsoDate
  /** Standardwerte (heute / Festdatum) */
  defaultInvoiceDate: IsoDate
  defaultServiceDate: IsoDate
  onDatesChange: (dates: { invoiceDate?: IsoDate | null; serviceDate?: IsoDate | null }) => void
  nextNumber: string | null
  blocker: string | null
  canFinalize: boolean
  finalizing: boolean
  onFinalize: () => void
  previewOpen: boolean
  onTogglePreview: () => void
  finalizeButtonRef?: Ref<HTMLButtonElement>
}

const PAYMENT_FALLBACK: Array<{ kind: PaymentKind; label: string }> = [
  { kind: 'bar', label: 'Bar' },
  { kind: 'ueberweisung', label: 'Überweisung' }
]

/** Fest angedockter Abschlussbereich: Zahlart, Datum, Endbetrag, „Abschließen & drucken“. */
export function FinalizeBar(props: FinalizeBarProps) {
  const {
    totals,
    taxExempt,
    paymentMethods,
    paymentKind,
    onPaymentChange,
    invoiceDate,
    serviceDate,
    defaultInvoiceDate,
    defaultServiceDate,
    onDatesChange,
    nextNumber,
    blocker,
    canFinalize,
    finalizing,
    onFinalize,
    previewOpen,
    onTogglePreview,
    finalizeButtonRef
  } = props
  const [datesOpen, setDatesOpen] = useState(false)
  const invoiceChanged = invoiceDate !== defaultInvoiceDate
  const serviceChanged = serviceDate !== defaultServiceDate
  const methods = paymentMethods.length > 0 ? paymentMethods : PAYMENT_FALLBACK
  const datesId = useId()

  return (
    <div
      className="shrink-0 border-t bg-card px-4 py-3 shadow-[0_-4px_12px_-6px_rgb(0_0_0/0.12)] @lg/mask:px-5 dark:shadow-[0_-4px_12px_-6px_rgb(0_0_0/0.5)]"
      data-testid="finalize-bar"
    >
      <div className="mx-auto w-full max-w-3xl space-y-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <RadioGroupPrimitive.Root
            value={paymentKind}
            onValueChange={(v) => onPaymentChange(v as PaymentKind)}
            aria-label="Zahlart"
            orientation="horizontal"
            className="inline-flex h-10 shrink-0 rounded-lg border bg-muted/60 p-0.5"
            data-testid="payment-kind"
          >
            {methods.map((m) => (
              <RadioGroupPrimitive.Item
                key={m.kind}
                value={m.kind}
                className={cn(
                  'rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60',
                  'hover:text-foreground data-[state=checked]:bg-background data-[state=checked]:text-foreground data-[state=checked]:shadow-sm dark:data-[state=checked]:bg-input/60'
                )}
              >
                {m.label}
              </RadioGroupPrimitive.Item>
            ))}
          </RadioGroupPrimitive.Root>

          <div
            className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground"
            data-testid="dates-summary"
          >
            <DateSummary
              label="Rechnungsdatum"
              shortLabel="Rechnung"
              iso={invoiceDate}
              changed={invoiceChanged}
              today={defaultInvoiceDate}
            />
            <DateSummary
              label="Leistungsdatum"
              shortLabel="Leistung"
              iso={serviceDate}
              changed={serviceChanged}
              today={defaultInvoiceDate}
            />
            <button
              type="button"
              onClick={() => setDatesOpen((o) => !o)}
              aria-expanded={datesOpen}
              aria-controls={datesId}
              aria-label={datesOpen ? undefined : 'Datum ändern'}
              title={datesOpen ? undefined : 'Rechnungs- oder Leistungsdatum ändern (Ausnahmefall)'}
              className="inline-flex h-8 items-center gap-1 rounded-md px-1.5 text-primary underline-offset-4 hover:underline"
            >
              <CalendarDays className="size-3.5" aria-hidden />
              {datesOpen ? (
                'Fertig'
              ) : (
                <>
                  <span className="@2xl/mask:hidden">ändern</span>
                  <span className="hidden @2xl/mask:inline">Datum ändern</span>
                </>
              )}
            </button>
          </div>
        </div>

        {datesOpen ? (
          <div id={datesId} className="grid gap-2 @md/mask:grid-cols-2" data-testid="dates-editor">
            <DateField
              label="Rechnungsdatum"
              value={invoiceDate}
              defaultValue={defaultInvoiceDate}
              defaultLabel="heute"
              onChange={(v) => onDatesChange({ invoiceDate: v })}
            />
            <DateField
              label="Leistungsdatum"
              value={serviceDate}
              defaultValue={defaultServiceDate}
              defaultLabel="Festdatum"
              onChange={(v) => onDatesChange({ serviceDate: v })}
            />
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            className="size-12 shrink-0 @xl/mask:w-auto @xl/mask:px-3"
            onClick={onTogglePreview}
            aria-pressed={previewOpen}
            aria-label="Vorschau ein-/ausblenden"
            title={`Vorschau ein-/ausblenden (⌥${modKey}P)`}
            data-testid="preview-toggle"
          >
            {previewOpen ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
            <span className="hidden @xl/mask:inline">Vorschau</span>
          </Button>

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-baseline gap-2 text-xs text-muted-foreground">
              <span className="font-medium tracking-wide uppercase">Endbetrag</span>
              {nextNumber ? (
                <span className="truncate" title={`Nächste Rechnungsnummer: ${nextNumber}`} data-testid="next-number">
                  Nr. {nextNumber}
                </span>
              ) : null}
            </div>
            <div
              className={cn(
                'truncate text-[1.75rem] leading-tight font-bold tracking-tight tabular-nums @lg/mask:text-3xl',
                totals.grossCents === 0 && 'text-muted-foreground'
              )}
              data-testid="grand-total"
              aria-live="polite"
            >
              {formatEuro(totals.grossCents)}
            </div>
            {!taxExempt && totals.byRate.length > 0 ? (
              <div
                className="flex flex-wrap gap-x-2 text-xs text-muted-foreground tabular-nums"
                data-testid="tax-summary"
              >
                <span className="whitespace-nowrap">netto {formatEuro(totals.netCents)}</span>
                <span className="whitespace-nowrap">
                  MwSt {totals.byRate.map((b) => `${b.rate} % ${formatEuro(b.vatCents)}`).join(' · ')}
                </span>
              </div>
            ) : null}
          </div>

          <Button
            ref={finalizeButtonRef}
            size="lg"
            className="h-14 shrink-0 gap-2 px-4 text-base @lg/mask:px-6"
            disabled={!canFinalize || finalizing}
            onClick={onFinalize}
            title={blocker ?? `Abschließen & drucken (${modKey}↩)`}
            data-testid="finalize-button"
            aria-describedby={blocker ? `${datesId}-blocker` : undefined}
          >
            {finalizing ? (
              <Loader2 className="size-5 animate-spin" aria-hidden />
            ) : (
              <Printer className="size-5" aria-hidden />
            )}
            <span className="flex flex-col items-start leading-tight">
              <span>{finalizing ? 'Wird abgeschlossen …' : 'Abschließen & drucken'}</span>
              <span className="hidden text-xs font-normal opacity-75 @md/mask:block">{modKey} + Enter</span>
            </span>
          </Button>
        </div>
        {blocker && !finalizing ? (
          <p
            id={`${datesId}-blocker`}
            className="-mt-1 truncate text-right text-xs text-muted-foreground"
            data-testid="finalize-blocker"
          >
            {blocker}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function DateSummary({
  label,
  shortLabel,
  iso,
  changed,
  today
}: {
  label: string
  /** kürzere Beschriftung für schmale Spalten */
  shortLabel: string
  iso: IsoDate
  changed: boolean
  today: IsoDate
}) {
  const text = iso === today ? 'heute' : iso ? formatDate(iso, 'DE') : 'ungültig'
  const caption = (
    <>
      <span className="@2xl/mask:hidden">{shortLabel}</span>
      <span className="hidden @2xl/mask:inline">{label}</span>
    </>
  )
  if (changed) {
    return (
      <Badge
        variant="warning"
        className="h-6 gap-1 text-xs"
        title={`${label} von Hand geändert`}
        data-testid="date-changed"
      >
        {caption} {text} (geändert)
      </Badge>
    )
  }
  return (
    <span className="whitespace-nowrap" title={`${label}: ${text}`}>
      {caption} <span className="font-medium text-foreground">{text}</span>
    </span>
  )
}

function DateField({
  label,
  value,
  defaultValue,
  defaultLabel,
  onChange
}: {
  label: string
  value: IsoDate
  defaultValue: IsoDate
  defaultLabel: string
  onChange: (value: IsoDate | null) => void
}) {
  const id = useId()
  const changed = value !== defaultValue
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <div className="flex gap-1.5">
        <Input
          id={id}
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value === defaultValue ? null : e.target.value)}
          className={cn('min-w-0 flex-1', changed && 'border-warning ring-1 ring-warning/50')}
        />
        <Button
          variant="ghost"
          size="icon"
          disabled={!changed}
          onClick={() => onChange(null)}
          aria-label={`${label} auf ${defaultLabel} zurücksetzen`}
          title={`Auf ${defaultLabel} zurücksetzen`}
        >
          <RotateCcw aria-hidden />
        </Button>
      </div>
    </div>
  )
}
