import { PanelRightClose } from 'lucide-react'
import type { InvoiceRenderData, TemplateConfig } from '@shared/types'
import { InvoicePreview } from '@/components/invoice-preview/InvoicePreview'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { modKey } from '@/lib/utils'

export interface PreviewContent {
  data: InvoiceRenderData
  template: TemplateConfig | null
  logoDataUrl: string | null
}

function PreviewBody({ content }: { content: PreviewContent }) {
  if (!content.template) return <Skeleton className="aspect-[210/297] w-full" />
  return <InvoicePreview data={content.data} template={content.template} logoDataUrl={content.logoDataUrl} />
}

/** ≥ xl: rechte Spalte (einklappbar). */
export function PreviewColumn({ content, onClose }: { content: PreviewContent; onClose: () => void }) {
  return (
    <aside
      aria-label="Rechnungsvorschau"
      className="flex w-[clamp(22rem,36%,36rem)] min-w-0 shrink-0 flex-col border-l bg-muted/40"
      data-testid="preview-column"
    >
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-4">
        <span className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Vorschau</span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Vorschau ausblenden"
          title={`Vorschau ausblenden (⌥${modKey}P)`}
        >
          <PanelRightClose aria-hidden />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <PreviewBody content={content} />
      </div>
    </aside>
  )
}

/** < xl: Vorschau als Fenster (Sheet von rechts). */
export function PreviewSheet({
  content,
  open,
  onOpenChange
}: {
  content: PreviewContent
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[min(94vw,40rem)] gap-0 bg-muted p-0 sm:max-w-none"
        closeButtonClassName="top-2.5"
        data-testid="preview-sheet"
      >
        <SheetHeader className="h-12 shrink-0 justify-center border-b bg-background py-0">
          <SheetTitle>Vorschau</SheetTitle>
          <SheetDescription className="sr-only">Live-Vorschau der Rechnung als A4-Seite</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{open ? <PreviewBody content={content} /> : null}</div>
      </SheetContent>
    </Sheet>
  )
}
