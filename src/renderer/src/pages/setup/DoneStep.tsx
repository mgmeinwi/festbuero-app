import { useState, type ReactNode } from 'react'
import { ArrowRight, CircleCheckBig, FolderOpen, LoaderCircle, PartyPopper, Printer, TriangleAlert } from 'lucide-react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { formatDate } from '@shared/dates'
import { formatInvoiceNumber } from '@shared/numbering'
import { Button } from '@/components/ui/button'
import { useActiveFestival } from '@/hooks/use-active-festival'
import { useAppInfo, useAppSettings } from '@/hooks/use-app-settings'
import { usePrinters } from '@/hooks/use-printers'
import { errorMessage } from '@/lib/utils'
import { usePrintTestPage } from '../einstellungen/actions'
import { PathText } from '../einstellungen/PathText'
import { StepActions, StepHeading } from './wizard'

function SummaryRow({
  icon,
  label,
  children,
  onEdit
}: {
  icon: ReactNode
  label: string
  children: ReactNode
  onEdit: () => void
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 p-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="min-w-0 text-sm font-medium">{children}</div>
      </div>
      <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`${label} ändern`}>
        Ändern
      </Button>
    </div>
  )
}

export function DoneStep({ onEditStep }: { onEditStep: (index: number) => void }) {
  const navigate = useNavigate()
  const { settings, updateSettings } = useAppSettings()
  const { data: info } = useAppInfo()
  const { festival } = useActiveFestival()
  const { data: printers = [] } = usePrinters()
  const { printTestPage, isPending: printing } = usePrintTestPage()
  const [finishing, setFinishing] = useState(false)

  const printer = settings?.defaultPrinter ?? null
  const printerLabel = printers.find((p) => p.name === printer)?.displayName ?? printer
  const canFinish = !!settings?.documentsDir && !!festival

  async function finish() {
    if (!canFinish || finishing) return
    setFinishing(true)
    try {
      await updateSettings({ setupCompleted: true })
      void navigate('/festbuero', { replace: true })
    } catch (err) {
      toast.error(errorMessage(err))
      setFinishing(false)
    }
  }

  return (
    <div className="space-y-6">
      <StepHeading
        icon={<CircleCheckBig aria-hidden />}
        title="Alles bereit!"
        description="Die App ist eingerichtet. Prüfen Sie kurz die Angaben – alles lässt sich später in den App-Einstellungen ändern."
      />

      <div className="divide-y rounded-lg border bg-background" data-testid="setup-summary">
        <SummaryRow icon={<FolderOpen aria-hidden />} label="Dokumentenordner" onEdit={() => onEditStep(1)}>
          {settings?.documentsDir ? (
            <PathText path={settings.documentsDir} />
          ) : (
            <span className="text-destructive">Nicht gewählt</span>
          )}
        </SummaryRow>
        <SummaryRow icon={<Printer aria-hidden />} label="Drucker" onEdit={() => onEditStep(2)}>
          {printer ? (
            <span className="block truncate" title={printerLabel ?? ''}>
              {printerLabel}
            </span>
          ) : (
            <span className="text-muted-foreground">Kein Drucker gewählt – später in der Kopfleiste wählbar</span>
          )}
        </SummaryRow>
        <SummaryRow icon={<PartyPopper aria-hidden />} label="Gründungsfest" onEdit={() => onEditStep(3)}>
          {festival ? (
            <span className="block truncate" title={festival.name}>
              {festival.name}
              <span className="font-normal text-muted-foreground">
                {' '}
                · {formatDate(festival.festivalDate, 'DE')} · ab{' '}
                {formatInvoiceNumber(festival.numberPrefix, festival.numberNext, festival.numberDigits)}
              </span>
            </span>
          ) : (
            <span className="text-destructive">Noch kein Fest angelegt</span>
          )}
        </SummaryRow>
      </div>

      <div className="space-y-3 rounded-lg border border-warning/50 bg-warning/10 p-4">
        <p className="flex items-start gap-2 text-sm font-medium">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-foreground dark:text-warning" aria-hidden />
          Vor dem Fest den stillen Druck mit dem echten Festdrucker testen.
        </p>
        <p className="text-sm text-muted-foreground">
          Die Testseite ist eine Musterrechnung mit der Vorlage des Fests und wird nicht als Rechnung gespeichert.
          {info?.printDryRun ? ' In dieser Umgebung wird der Druck nur simuliert.' : ''}
        </p>
        <Button
          variant="outline"
          disabled={!festival || !printer || printing}
          onClick={() => festival && printer && printTestPage(festival.id, printer, printerLabel ?? printer)}
          data-testid="setup-test-page"
        >
          {printing ? <LoaderCircle className="animate-spin" aria-hidden /> : <Printer aria-hidden />}
          Testseite drucken
        </Button>
        {!printer ? <p className="text-xs text-muted-foreground">Dafür zuerst einen Drucker wählen.</p> : null}
      </div>

      <StepActions onPrimary={() => void finish()}>
        <Button onClick={() => void finish()} disabled={!canFinish || finishing} data-testid="setup-finish">
          {finishing ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          Los geht’s
          {finishing ? null : <ArrowRight aria-hidden />}
        </Button>
      </StepActions>
    </div>
  )
}
