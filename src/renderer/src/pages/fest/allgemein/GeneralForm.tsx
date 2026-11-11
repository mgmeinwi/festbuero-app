import { useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { CalendarDays, FileText, Printer, Receipt } from 'lucide-react'
import { toast } from 'sonner'
import { isValidIsoDate, todayIso } from '@shared/dates'
import { buildPdfFileName, validateFilenamePattern } from '@shared/filename'
import { getSampleRenderData } from '@shared/invoice-render/sample-data'
import { formatInvoiceNumber } from '@shared/numbering'
import { PLACEHOLDERS } from '@shared/placeholders'
import type { Festival, FestivalUpdateInput } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { errorMessage } from '@/lib/utils'
import { useUpdateFestival } from './festival-queries'
import { FieldMessage, parseIntegerInput, SaveBar, SettingsSection, useSaveShortcut } from './form-kit'
import { focusAt, insertAtCursor, PlaceholderMenu } from './PlaceholderMenu'

/** Standard-Hinweistext laut Spezifikation. */
export const DEFAULT_TAX_EXEMPT_TEXT = 'Als Kleinunternehmer im Sinne von § 19 UStG wird keine Umsatzsteuer berechnet.'

/** Sinnvolle Platzhalter für Dateinamen (Datumswerte ohne Variante werden als JJJJ-MM-TT eingesetzt). */
const FILENAME_TOKENS = [
  '{Rechnungsnummer}',
  '{Verein}',
  '{Name}',
  '{Ort}',
  '{Zahlart}',
  '{Festname}',
  '{Rechnungsdatum_ISO}',
  '{Rechnungsdatum_DE}',
  '{Leistungsdatum_ISO}'
]
const FILENAME_PLACEHOLDERS = FILENAME_TOKENS.map((t) => PLACEHOLDERS.find((p) => p.token === t)).filter(
  (p): p is (typeof PLACEHOLDERS)[number] => p !== undefined
)

interface Draft {
  name: string
  festivalDate: string
  copies: string
  taxExempt: boolean
  taxExemptText: string
  filenamePattern: string
}

function toDraft(f: Festival): Draft {
  return {
    name: f.name,
    festivalDate: f.festivalDate,
    copies: String(f.copies),
    taxExempt: f.taxExempt,
    taxExemptText: f.taxExemptText,
    filenamePattern: f.filenamePattern
  }
}

type Errors = Partial<Record<keyof Draft, string>>

function validate(d: Draft): Errors {
  const errors: Errors = {}
  if (d.name.trim() === '') errors.name = 'Bitte einen Namen für das Fest angeben.'
  else if (d.name.trim().length > 120) errors.name = 'Der Name ist zu lang (höchstens 120 Zeichen).'
  if (!isValidIsoDate(d.festivalDate)) errors.festivalDate = 'Bitte ein gültiges Festdatum angeben.'
  const copies = parseIntegerInput(d.copies)
  if (copies === null || copies < 1 || copies > 20) errors.copies = 'Die Kopienzahl muss zwischen 1 und 20 liegen.'
  if (d.taxExempt && d.taxExemptText.trim() === '') {
    errors.taxExemptText = 'Bei Steuerbefreiung ist ein Hinweistext Pflicht.'
  }
  const pattern = validateFilenamePattern(d.filenamePattern)
  if (!pattern.valid) errors.filenamePattern = pattern.error
  return errors
}

function toPatch(d: Draft, f: Festival): FestivalUpdateInput {
  const patch: FestivalUpdateInput = {}
  if (d.name.trim() !== f.name) patch.name = d.name.trim()
  if (d.festivalDate !== f.festivalDate) patch.festivalDate = d.festivalDate
  const copies = parseIntegerInput(d.copies)
  if (copies !== null && copies !== f.copies) patch.copies = copies
  if (d.taxExempt !== f.taxExempt) patch.taxExempt = d.taxExempt
  if (d.taxExemptText.trim() !== f.taxExemptText) patch.taxExemptText = d.taxExemptText.trim()
  if (d.filenamePattern.trim() !== f.filenamePattern) patch.filenamePattern = d.filenamePattern.trim()
  return patch
}

/** Formular „Allgemein“: Name, Festdatum, Kopien, Steuerbefreiung, Dateinamensmuster. */
export function GeneralForm({ festival }: { festival: Festival }) {
  const formId = useId()
  const [draft, setDraft] = useState<Draft>(() => toDraft(festival))
  const [showErrors, setShowErrors] = useState(false)
  const patternRef = useRef<HTMLInputElement>(null)
  const mutation = useUpdateFestival()

  const errors = validate(draft)
  const hasErrors = Object.keys(errors).length > 0
  const patch = toPatch(draft, festival)
  const dirty = Object.keys(patch).length > 0

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))
  const fieldError = (key: keyof Draft) => (showErrors || key === 'filenamePattern' ? errors[key] : undefined)

  const example = useMemo(() => {
    if (errors.filenamePattern) return null
    const today = todayIso()
    const data = getSampleRenderData({
      number: formatInvoiceNumber(festival.numberPrefix, festival.numberNext, festival.numberDigits),
      festivalName: draft.name.trim() || festival.name,
      invoiceDate: today,
      today,
      serviceDate: isValidIsoDate(draft.festivalDate) ? draft.festivalDate : festival.festivalDate
    })
    return `${buildPdfFileName(draft.filenamePattern, data)}.pdf`
  }, [draft.filenamePattern, draft.name, draft.festivalDate, festival, errors.filenamePattern])

  async function save() {
    if (!dirty || mutation.isPending) return
    if (hasErrors) {
      setShowErrors(true)
      toast.error('Bitte die markierten Eingaben prüfen.')
      return
    }
    try {
      const updated = await mutation.mutateAsync({ id: festival.id, patch })
      setDraft(toDraft(updated))
      setShowErrors(false)
      toast.success('Einstellungen gespeichert.')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  useSaveShortcut(() => void save(), true)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void save()
  }

  function insertToken(token: string) {
    const { value, caret } = insertAtCursor(patternRef.current, draft.filenamePattern, token)
    set('filenamePattern', value)
    focusAt(patternRef.current, caret)
  }

  const ids = {
    name: `${formId}-name`,
    date: `${formId}-date`,
    copies: `${formId}-copies`,
    taxExempt: `${formId}-tax`,
    taxText: `${formId}-tax-text`,
    pattern: `${formId}-pattern`
  }

  return (
    <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-6" aria-label="Allgemeine Einstellungen">
      <SettingsSection title="Fest" description="Name und Datum des Gründungsfests." icon={<CalendarDays />}>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <div className="grid min-w-0 content-start gap-2">
            <Label htmlFor={ids.name}>Name des Fests</Label>
            <Input
              id={ids.name}
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
              autoComplete="off"
              aria-invalid={fieldError('name') ? true : undefined}
              aria-describedby={fieldError('name') ? `${ids.name}-msg` : undefined}
            />
            {fieldError('name') ? (
              <FieldMessage id={`${ids.name}-msg`} error>
                {fieldError('name')}
              </FieldMessage>
            ) : null}
          </div>
          <div className="grid min-w-0 content-start gap-2">
            <Label htmlFor={ids.date}>Festdatum</Label>
            <Input
              id={ids.date}
              type="date"
              value={draft.festivalDate}
              onChange={(e) => set('festivalDate', e.target.value)}
              aria-invalid={fieldError('festivalDate') ? true : undefined}
              aria-describedby={`${ids.date}-msg`}
            />
            <FieldMessage id={`${ids.date}-msg`} error={Boolean(fieldError('festivalDate'))}>
              {fieldError('festivalDate') ?? 'Standard für das Leistungsdatum.'}
            </FieldMessage>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Druck"
        description="Gilt für „Abschließen & drucken“ und „Erneut drucken“."
        icon={<Printer />}
      >
        <div className="grid gap-2">
          <Label htmlFor={ids.copies}>Kopien pro Druck</Label>
          <Input
            id={ids.copies}
            className="w-28"
            inputMode="numeric"
            value={draft.copies}
            onChange={(e) => set('copies', e.target.value.replace(/[^\d]/g, '').slice(0, 2))}
            aria-invalid={fieldError('copies') ? true : undefined}
            aria-describedby={`${ids.copies}-msg`}
          />
          <FieldMessage id={`${ids.copies}-msg`} error={Boolean(fieldError('copies'))}>
            {fieldError('copies') ?? 'Zwischen 1 und 20 Exemplaren, Standard 2 (Kunde und Ablage).'}
          </FieldMessage>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Steuer"
        description="Bei Steuerbefreiung weist die Rechnung keine Umsatzsteuer aus. Die Steuersätze der Produkte bleiben gespeichert."
        icon={<Receipt />}
      >
        <div className="flex items-start justify-between gap-4 rounded-lg border bg-background px-3 py-3">
          <div className="min-w-0 space-y-1">
            <Label htmlFor={ids.taxExempt} className="text-sm">
              Steuerbefreiung (Kleinunternehmer)
            </Label>
            <p className="text-xs text-muted-foreground">
              {draft.taxExempt ? 'Auf Rechnungen steht nur der Gesamtbetrag und der Hinweistext.' : 'Rechnungen weisen Netto und MwSt je Satz aus.'}
            </p>
          </div>
          <Switch
            id={ids.taxExempt}
            checked={draft.taxExempt}
            onCheckedChange={(checked) => set('taxExempt', checked)}
          />
        </div>
        {draft.taxExempt ? (
          <div className="grid gap-2">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <Label htmlFor={ids.taxText}>Hinweistext auf der Rechnung</Label>
              {draft.taxExemptText.trim() !== DEFAULT_TAX_EXEMPT_TEXT ? (
                <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={() => set('taxExemptText', DEFAULT_TAX_EXEMPT_TEXT)}>
                  Standardtext einsetzen
                </Button>
              ) : null}
            </div>
            <Textarea
              id={ids.taxText}
              rows={2}
              value={draft.taxExemptText}
              onChange={(e) => set('taxExemptText', e.target.value)}
              aria-invalid={fieldError('taxExemptText') ? true : undefined}
              aria-describedby={fieldError('taxExemptText') ? `${ids.taxText}-msg` : undefined}
            />
            {fieldError('taxExemptText') ? (
              <FieldMessage id={`${ids.taxText}-msg`} error>
                {fieldError('taxExemptText')}
              </FieldMessage>
            ) : null}
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection
        title="Ablage"
        description="Name der PDF-Dateien im Dokumentenordner. Unzulässige Zeichen werden automatisch ersetzt."
        icon={<FileText />}
      >
        <div className="grid gap-2">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <Label htmlFor={ids.pattern}>Dateinamensmuster</Label>
            <PlaceholderMenu placeholders={FILENAME_PLACEHOLDERS} onInsert={insertToken} />
          </div>
          <Input
            ref={patternRef}
            id={ids.pattern}
            value={draft.filenamePattern}
            onChange={(e) => set('filenamePattern', e.target.value)}
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={errors.filenamePattern ? true : undefined}
            aria-describedby={`${ids.pattern}-msg ${ids.pattern}-example`}
          />
          <FieldMessage id={`${ids.pattern}-msg`} error={Boolean(errors.filenamePattern)}>
            {errors.filenamePattern ?? 'Muss {Rechnungsnummer} enthalten, damit jeder Dateiname eindeutig ist.'}
          </FieldMessage>
          <div
            id={`${ids.pattern}-example`}
            className="flex min-w-0 items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm"
            data-testid="filename-example"
          >
            <span className="shrink-0 text-muted-foreground">Beispiel:</span>
            <span className="min-w-0 truncate font-mono font-medium" title={example ?? undefined}>
              {example ?? '–'}
            </span>
          </div>
        </div>
      </SettingsSection>

      <SaveBar
        dirty={dirty}
        saving={mutation.isPending}
        canSave={!hasErrors || !showErrors}
        onDiscard={() => {
          setDraft(toDraft(festival))
          setShowErrors(false)
        }}
      />
    </form>
  )
}
