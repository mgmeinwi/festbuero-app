import { ArrowRight, FolderOpen, Printer, ReceiptText, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StepActions, StepHeading } from './wizard'

const FEATURES = [
  {
    icon: ReceiptText,
    title: 'Rechnungen in drei Schritten',
    text: 'Verein suchen, Personen eintragen, abschließen – die Positionen sind schon vorbelegt.'
  },
  {
    icon: FolderOpen,
    title: 'Saubere PDF-Ablage',
    text: 'Jede Rechnung landet als PDF im Dokumentenordner, pro Fest ein eigener Ordner.'
  },
  {
    icon: Printer,
    title: 'Druck ohne Dialog',
    text: 'Nach dem Abschluss druckt die App automatisch auf dem gewählten Drucker.'
  },
  {
    icon: WifiOff,
    title: 'Komplett offline',
    text: 'Keine Anmeldung, keine Cloud – alle Daten bleiben auf diesem Rechner.'
  }
] as const

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="space-y-6">
      <StepHeading
        as="h1"
        icon={<ReceiptText aria-hidden />}
        title="Willkommen im Festbüro"
        description="Mit dem Festbüro erstellen Sie beim Gründungsfest in Sekunden Rechnungen für Vereine und Einzelgäste."
      />
      <ul className="grid gap-3 sm:grid-cols-2">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex gap-3 rounded-lg border bg-background/60 p-3">
            <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium">{title}</p>
              <p className="text-sm text-muted-foreground">{text}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">
        In vier kurzen Schritten ist die App startklar. Alles lässt sich später in den App-Einstellungen ändern.
      </p>
      <StepActions onPrimary={onNext}>
        <Button onClick={onNext} data-testid="setup-next">
          Einrichtung starten
          <ArrowRight aria-hidden />
        </Button>
      </StepActions>
    </div>
  )
}
