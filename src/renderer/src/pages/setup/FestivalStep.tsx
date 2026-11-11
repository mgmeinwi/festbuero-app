import { useState } from 'react'
import { ArrowRight, CalendarDays, Check, FlaskConical, LoaderCircle, PartyPopper, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { formatDate } from '@shared/dates'
import { formatInvoiceNumber } from '@shared/numbering'
import { NewFestivalForm } from '@/components/layout/NewFestivalForm'
import { Button } from '@/components/ui/button'
import { useActiveFestival } from '@/hooks/use-active-festival'
import { useAppSettings } from '@/hooks/use-app-settings'
import { cn } from '@/lib/utils'
import { useCreateSampleFestival } from '../einstellungen/actions'
import { StepActions, StepHeading } from './wizard'

function SampleFestivalButton({ onCreated, disabled }: { onCreated: () => void; disabled?: boolean }) {
  const { updateSettings } = useAppSettings()
  const sample = useCreateSampleFestival(async (festival) => {
    await updateSettings({ lastFestivalId: festival.id })
    toast.success(`„${festival.name}“ angelegt.`, {
      description: '8 Produkte, Muster-Vorlage und 12 erfundene Vereine – zum Ausprobieren.'
    })
    onCreated()
  })
  return (
    <button
      type="button"
      onClick={() => sample.mutate()}
      disabled={disabled || sample.isPending}
      className="flex w-full items-start gap-3 rounded-lg border border-dashed bg-background/60 p-3 text-left transition-colors outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-60"
      data-testid="setup-sample-festival"
    >
      {sample.isPending ? (
        <LoaderCircle className="mt-0.5 size-5 shrink-0 animate-spin text-primary" aria-hidden />
      ) : (
        <FlaskConical className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
      )}
      <span className="min-w-0 space-y-0.5">
        <span className="block text-sm font-medium">Beispiel-Fest anlegen (zum Ausprobieren)</span>
        <span className="block text-sm text-muted-foreground">
          Mit den Produkten der Musterrechnung, einer Beispiel-Vorlage und erfundenen Vereinen. Lässt sich später
          archivieren.
        </span>
      </span>
    </button>
  )
}

export function FestivalStep({ onDone }: { onDone: () => void }) {
  const { festivals, festival: active } = useActiveFestival()
  const [showForm, setShowForm] = useState(festivals.length === 0)
  const hasFestivals = festivals.length > 0

  if (hasFestivals && !showForm) {
    return (
      <div className="space-y-6">
        <StepHeading
          icon={<PartyPopper aria-hidden />}
          title={festivals.length === 1 ? 'Gründungsfest angelegt' : 'Gründungsfeste angelegt'}
          description="Diese Feste sind bereits eingerichtet. Produkte, Vereine und die Rechnungsvorlage passen Sie später unter „Fest-Einstellungen“ an."
        />
        <ul className="space-y-2" data-testid="setup-festival-list">
          {festivals.slice(0, 5).map((f) => (
            <li
              key={f.id}
              className={cn(
                'flex min-w-0 items-center gap-3 rounded-lg border bg-background p-3',
                f.id === active?.id && 'border-primary bg-primary/5'
              )}
            >
              <Check className={cn('size-5 shrink-0', f.id === active?.id ? 'text-primary' : 'text-success')} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium" title={f.name}>
                  {f.name}
                </span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <CalendarDays className="size-3.5" aria-hidden />
                  {formatDate(f.festivalDate, 'Lang')} · erste Nummer{' '}
                  {formatInvoiceNumber(f.numberPrefix, f.numberStart, f.numberDigits)}
                </span>
              </span>
              {f.id === active?.id ? <span className="text-xs font-medium text-primary">aktiv</span> : null}
            </li>
          ))}
          {festivals.length > 5 ? (
            <li className="px-1 text-sm text-muted-foreground">… und {festivals.length - 5} weitere</li>
          ) : null}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setShowForm(true)}>
            <Plus aria-hidden />
            Weiteres Fest anlegen
          </Button>
        </div>
        <StepActions onPrimary={onDone}>
          <Button onClick={onDone} data-testid="setup-next">
            Weiter
            <ArrowRight aria-hidden />
          </Button>
        </StepActions>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <StepHeading
        icon={<PartyPopper aria-hidden />}
        title={hasFestivals ? 'Weiteres Gründungsfest anlegen' : 'Erstes Gründungsfest anlegen'}
        description="Name, Festdatum und Rechnungsnummern – alles lässt sich später ändern."
        autoFocus={false}
      />
      <div>
        <NewFestivalForm
          onCreated={() => onDone()}
          renderActions={({ submitting, formId }) => (
            <StepActions
              onPrimary={() => (document.getElementById(formId) as HTMLFormElement | null)?.requestSubmit()}
            >
              {hasFestivals ? (
                <Button variant="ghost" onClick={() => setShowForm(false)}>
                  Abbrechen
                </Button>
              ) : null}
              <Button type="submit" form={formId} disabled={submitting} data-testid="setup-next">
                {submitting ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                Fest anlegen
                {submitting ? null : <ArrowRight aria-hidden />}
              </Button>
            </StepActions>
          )}
        />
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        oder
        <span className="h-px flex-1 bg-border" />
      </div>
      <SampleFestivalButton onCreated={onDone} />
    </div>
  )
}
