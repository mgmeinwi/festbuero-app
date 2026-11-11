/**
 * Live-Vorschau des Vorlagen-Editors: Beispieldaten mit den echten Fest-Einstellungen,
 * Umschalter Rechnung/Storno und Bar/Überweisung.
 */
import { Files } from 'lucide-react'
import type { InvoiceRenderData, PaymentKind, TemplateConfig } from '@shared/types'
import { InvoicePreview } from '@/components/invoice-preview/InvoicePreview'
import { cn } from '@/lib/utils'
import { Segmented } from './fields'

export type PreviewKind = 'rechnung' | 'storno'

export interface PreviewOptions {
  kind: PreviewKind
  payment: PaymentKind
  /** 40 Positionen statt 8 (Seitenumbruch prüfen) */
  long: boolean
}

export function PreviewControls({
  options,
  onChange,
  className
}: {
  options: PreviewOptions
  onChange(next: PreviewOptions): void
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <Segmented
        ariaLabel="Beleg in der Vorschau"
        value={options.kind}
        onChange={(kind) => onChange({ ...options, kind })}
        options={[
          { value: 'rechnung', label: 'Rechnung' },
          { value: 'storno', label: 'Storno' }
        ]}
      />
      <Segmented
        ariaLabel="Zahlungsart in der Vorschau"
        value={options.payment}
        onChange={(payment) => onChange({ ...options, payment })}
        options={[
          { value: 'bar', label: 'Bar' },
          { value: 'ueberweisung', label: 'Überweisung' }
        ]}
      />
      <button
        type="button"
        aria-pressed={options.long}
        title="Lange Rechnung mit 40 Positionen anzeigen (Seitenumbruch prüfen)"
        onClick={() => onChange({ ...options, long: !options.long })}
        className={cn(
          'inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-sm text-muted-foreground outline-none transition-colors',
          'hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60',
          options.long && 'border-primary/40 bg-primary/10 text-foreground'
        )}
      >
        <Files className="size-4" aria-hidden />
        40 Positionen
      </button>
    </div>
  )
}

export function PreviewDocument({
  data,
  template,
  logoDataUrl
}: {
  data: InvoiceRenderData
  template: TemplateConfig
  logoDataUrl: string | null
}) {
  return (
    <div className="mx-auto w-full max-w-[52rem]">
      <InvoicePreview data={data} template={template} logoDataUrl={logoDataUrl} />
      <p className="mt-3 text-center text-xs text-muted-foreground">Vorschau mit Beispieldaten · Fest-Einstellungen und Logo sind echt</p>
    </div>
  )
}
