/**
 * Route: /fest/nummern – Präfix, Startnummer (gesperrt, sobald Belege existieren), Stellenzahl,
 * Live-Vorschau der nächsten Rechnungsnummer und Warnung bei gleichem Präfix in einem anderen Fest.
 * Zuständig: Bereich „Fest-Einstellungen“.
 */
import { useId, useState, type FormEvent } from 'react'
import { Hash, Lock, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { formatInvoiceNumber, MAX_NUMBER_DIGITS, MIN_NUMBER_DIGITS } from '@shared/numbering'
import type { Festival, FestivalUpdateInput } from '@shared/types'
import { PageContainer, PageHeader } from '@/components/layout/PageHeader'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useActiveFestival } from '@/hooks/use-active-festival'
import { errorMessage } from '@/lib/utils'
import { findPrefixConflicts, formatFestivalNames, useAllFestivals, useUpdateFestival } from '../allgemein/festival-queries'
import {
  FEST_PAGE_CLASS,
  FieldMessage,
  parseIntegerInput,
  SaveBar,
  ScrollToTopOnMount,
  SettingsSection,
  useSaveShortcut
} from '../allgemein/form-kit'

interface Draft {
  prefix: string
  start: string
  digits: string
}

function toDraft(f: Festival): Draft {
  return { prefix: f.numberPrefix, start: String(f.numberStart), digits: String(f.numberDigits) }
}

export default function FestNummernPage() {
  const { festival } = useActiveFestival()
  if (!festival) return null
  return (
    <PageContainer className={`${FEST_PAGE_CLASS} max-w-3xl`}>
      <ScrollToTopOnMount />
      <PageHeader
        title="Rechnungsnummern"
        description="Jede Rechnungsnummer besteht aus Präfix und fortlaufender Zahl mit führenden Nullen."
      />
      <NumbersForm key={festival.id} festival={festival} />
    </PageContainer>
  )
}

function NumbersForm({ festival }: { festival: Festival }) {
  const formId = useId()
  const [draft, setDraft] = useState<Draft>(() => toDraft(festival))
  const mutation = useUpdateFestival()
  const all = useAllFestivals()
  const locked = festival.hasInvoices

  const start = parseIntegerInput(draft.start)
  const digits = parseIntegerInput(draft.digits)
  const errors = {
    prefix: draft.prefix.length > 20 ? 'Das Präfix ist zu lang (höchstens 20 Zeichen).' : undefined,
    start: start === null ? 'Die Startnummer muss eine ganze Zahl ab 0 sein.' : undefined,
    digits:
      digits === null || digits < MIN_NUMBER_DIGITS || digits > MAX_NUMBER_DIGITS
        ? `Die Stellenzahl muss zwischen ${MIN_NUMBER_DIGITS} und ${MAX_NUMBER_DIGITS} liegen.`
        : undefined
  }
  const hasErrors = Object.values(errors).some(Boolean)

  const patch: FestivalUpdateInput = {}
  if (draft.prefix !== festival.numberPrefix) patch.numberPrefix = draft.prefix
  if (!locked && start !== null && start !== festival.numberStart) patch.numberStart = start
  if (digits !== null && digits !== festival.numberDigits) patch.numberDigits = digits
  // ungültige Eingaben zählen als Änderung (Speichern zeigt dann den Fehler)
  const dirty =
    draft.prefix !== festival.numberPrefix ||
    (!locked && start !== festival.numberStart) ||
    digits !== festival.numberDigits

  const nextSeq = locked ? festival.numberNext : (start ?? festival.numberStart)
  const previewDigits = errors.digits ? festival.numberDigits : digits!
  const preview = formatInvoiceNumber(draft.prefix, nextSeq, previewDigits)
  const following = [1, 2].map((n) => formatInvoiceNumber(draft.prefix, nextSeq + n, previewDigits))
  const conflicts = findPrefixConflicts(all.data, draft.prefix, festival.id)

  async function save() {
    if (!dirty || mutation.isPending) return
    if (hasErrors) {
      toast.error('Bitte die markierten Eingaben prüfen.')
      return
    }
    try {
      const updated = await mutation.mutateAsync({ id: festival.id, patch })
      setDraft(toDraft(updated))
      toast.success('Nummernkreis gespeichert.')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  useSaveShortcut(() => void save(), true)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void save()
  }

  const ids = { prefix: `${formId}-prefix`, start: `${formId}-start`, digits: `${formId}-digits` }

  return (
    <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-6" aria-label="Rechnungsnummern">
      <section
        aria-label="Vorschau"
        className="rounded-xl border bg-accent/60 px-4 py-4 sm:px-5"
        data-testid="number-preview"
      >
        <p className="text-sm text-muted-foreground">Nächste Rechnungsnummer</p>
        <p className="mt-1 truncate font-mono text-3xl font-semibold tracking-tight tabular-nums" title={preview} aria-live="polite">
          {preview}
        </p>
        <p className="mt-1 truncate text-xs text-muted-foreground">danach {following.join(', ')} …</p>
      </section>

      <SettingsSection title="Nummernkreis" icon={<Hash />}>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid min-w-0 content-start gap-2">
            <Label htmlFor={ids.prefix}>Präfix</Label>
            <Input
              id={ids.prefix}
              value={draft.prefix}
              onChange={(e) => setDraft((d) => ({ ...d, prefix: e.target.value }))}
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={errors.prefix ? true : undefined}
              aria-describedby={`${ids.prefix}-msg`}
            />
            <FieldMessage id={`${ids.prefix}-msg`} error={Boolean(errors.prefix)}>
              {errors.prefix ?? 'z. B. „2025-“, darf leer sein.'}
            </FieldMessage>
          </div>
          <div className="grid min-w-0 content-start gap-2">
            <Label htmlFor={ids.start} className="gap-1.5">
              Startnummer
              {locked ? <Lock className="size-3.5 text-muted-foreground" aria-label="gesperrt" /> : null}
            </Label>
            <Input
              id={ids.start}
              inputMode="numeric"
              value={draft.start}
              onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value.replace(/[^\d]/g, '').slice(0, 9) }))}
              disabled={locked}
              className="font-mono"
              aria-invalid={!locked && errors.start ? true : undefined}
              aria-describedby={`${ids.start}-msg`}
            />
            <FieldMessage id={`${ids.start}-msg`} error={!locked && Boolean(errors.start)}>
              {locked
                ? 'Gesperrt, es gibt bereits Rechnungen.'
                : (errors.start ?? 'Erste Zahl, z. B. 1 oder 81.')}
            </FieldMessage>
          </div>
          <div className="grid min-w-0 content-start gap-2">
            <Label htmlFor={ids.digits}>Stellenzahl</Label>
            <Input
              id={ids.digits}
              inputMode="numeric"
              value={draft.digits}
              onChange={(e) => setDraft((d) => ({ ...d, digits: e.target.value.replace(/[^\d]/g, '').slice(0, 2) }))}
              className="font-mono"
              aria-invalid={errors.digits ? true : undefined}
              aria-describedby={`${ids.digits}-msg`}
            />
            <FieldMessage id={`${ids.digits}-msg`} error={Boolean(errors.digits)}>
              {errors.digits ?? `Mit führenden Nullen, 3 ergibt „${formatInvoiceNumber('', 81, 3)}“.`}
            </FieldMessage>
          </div>
        </div>

        {locked ? (
          <p className="flex items-start gap-2 rounded-lg border bg-muted/60 px-3 py-2 text-sm text-muted-foreground" data-testid="number-locked">
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Für dieses Fest gibt es bereits Rechnungen. Die Nummern laufen lückenlos bei{' '}
              <span className="font-medium text-foreground tabular-nums">
                {formatInvoiceNumber(festival.numberPrefix, festival.numberNext, festival.numberDigits)}
              </span>{' '}
              weiter. Präfix und Stellenzahl gelten nur für künftige Rechnungen.
            </span>
          </p>
        ) : null}

        {conflicts.length > 0 ? (
          <p
            className="flex items-start gap-2 rounded-lg bg-warning/15 px-3 py-2 text-sm text-warning-foreground dark:text-warning"
            role="status"
            data-testid="prefix-conflict"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Das Präfix „{draft.prefix}“ nutzt auch {formatFestivalNames(conflicts)}. Rechnungsnummern müssen über alle
              Feste eindeutig sein – überschneiden sich die Nummern, lässt sich eine Rechnung nicht abschließen. Am besten
              ein eigenes Präfix wählen, z. B. mit Jahreszahl.
            </span>
          </p>
        ) : null}
      </SettingsSection>

      <SaveBar
        dirty={dirty}
        saving={mutation.isPending}
        canSave={!hasErrors}
        onDiscard={() => setDraft(toDraft(festival))}
      />
    </form>
  )
}
