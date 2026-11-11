/**
 * Route: /festbuero (Start) – Festbüro-Maske; `?from=<invoiceId>` = Vorbelegung aus alter Rechnung.
 * Zuständig: Bereich „Maske“ (ersetzt diesen Platzhalter).
 */
import { useMemo } from 'react'
import { getDefaultTemplateConfig } from '@shared/invoice-render/default-template'
import { getSampleRenderData } from '@shared/invoice-render/sample-data'
import { InvoicePreview } from '@/components/invoice-preview/InvoicePreview'
import { PageContainer, PageHeader } from '@/components/layout/PageHeader'
import { useActiveFestival } from '@/hooks/use-active-festival'

export default function FestbueroPage() {
  const { festival } = useActiveFestival()
  const template = useMemo(() => getDefaultTemplateConfig(), [])
  const data = useMemo(
    () => getSampleRenderData(festival ? { festivalName: festival.name, serviceDate: festival.festivalDate } : {}),
    [festival]
  )
  return (
    <PageContainer className="max-w-7xl">
      <PageHeader title="Festbüro" description="Hier entsteht die Festbüro-Maske (Bereich „Maske“)." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div
          className="flex min-h-48 items-center justify-center rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground"
          data-testid="page-placeholder"
        >
          Schritte 1–3 (Kunde, Personen, Positionen) und „Abschließen &amp; drucken“ folgen.
        </div>
        <div className="mx-auto w-full max-w-[26rem]">
          <p className="mb-2 text-sm font-medium text-muted-foreground">Vorschau (Beispieldaten)</p>
          <InvoicePreview data={data} template={template} logoDataUrl={null} />
        </div>
      </div>
    </PageContainer>
  )
}
