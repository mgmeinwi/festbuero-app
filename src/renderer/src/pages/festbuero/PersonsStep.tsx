import { useId, type Ref } from 'react'
import { RotateCcw } from 'lucide-react'
import { normalizeQuantity } from '@shared/invoice-draft'
import { Label } from '@/components/ui/label'
import { QuantityInput } from './QuantityInput'
import { StepSection } from './StepSection'

interface PersonsStepProps {
  personsInput: string
  registeredPersons: number | null
  onChange: (input: string) => void
  /** Enter → weiter zu den Positionen */
  onEnter: () => void
  inputRef: Ref<HTMLInputElement>
}

/** Schritt 2: tatsächlich kommende Personen (nur Vereine), vorbelegt mit der angemeldeten Zahl. */
export function PersonsStep({ personsInput, registeredPersons, onChange, onEnter, inputRef }: PersonsStepProps) {
  const id = useId()
  const persons = normalizeQuantity(personsInput)
  const registered = registeredPersons ?? null
  const differs = registered !== null && persons !== registered
  return (
    <StepSection id="personen" step={2} title="Personen" done={persons > 0}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Label htmlFor={id} className="sr-only">
          Kommende Personen
        </Label>
        <QuantityInput
          id={id}
          inputRef={inputRef}
          value={persons}
          onValueChange={(n) => onChange(String(n))}
          onEnter={onEnter}
          className="h-12 w-28 px-3 text-xl font-semibold"
          data-testid="persons-input"
          aria-describedby={`${id}-hint`}
        />
        <div id={`${id}-hint`} className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          <span>kommende Personen</span>
          {registered !== null ? (
            <span
              className={
                differs ? 'rounded-md bg-warning/20 px-1.5 py-0.5 text-warning-foreground dark:text-warning' : ''
              }
              data-testid="persons-registered"
            >
              angemeldet: <strong className="font-semibold tabular-nums">{registered}</strong>
            </span>
          ) : null}
          {differs ? (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => onChange(String(registered))}
              className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-primary hover:bg-primary/10"
              title={`Auf die angemeldete Zahl (${registered}) zurücksetzen`}
            >
              <RotateCcw className="size-3.5" aria-hidden />
              übernehmen
            </button>
          ) : null}
        </div>
      </div>
    </StepSection>
  )
}
