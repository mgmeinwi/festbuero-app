/**
 * Route: /fest/zahlarten – Bar und Überweisung: Anzeigename, Standard, Zahlungsfrist und Text
 * (Rich Text mit Platzhaltern) samt aufgelöster Beispielanzeige.
 * Zuständig: Bereich „Fest-Einstellungen“.
 */
import { useId, useMemo, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Banknote, Landmark } from 'lucide-react'
import { toast } from 'sonner'
import { addDays, todayIso } from '@shared/dates'
import { getSampleRenderData } from '@shared/invoice-render/sample-data'
import { formatInvoiceNumber } from '@shared/numbering'
import { replacePlaceholders } from '@shared/placeholders'
import type { Festival, PaymentMethod, PaymentMethodUpdateInput } from '@shared/types'
import { PageContainer, PageHeader } from '@/components/layout/PageHeader'
import { RichTextEditor } from '@/components/rich-text/RichTextEditor'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import { queryKeys } from '@/hooks/query-keys'
import { useActiveFestival } from '@/hooks/use-active-festival'
import { api } from '@/lib/api'
import { cn, errorMessage } from '@/lib/utils'
import { FEST_PAGE_CLASS, FieldMessage, parseIntegerInput, SaveBar, ScrollToTopOnMount, useSaveShortcut } from '../allgemein/form-kit'
import { sanitizeHtml } from './sanitize-html'

const KIND_INFO = {
  bar: { title: 'Bar', icon: Banknote, hint: 'Barzahlung im Festbüro' },
  ueberweisung: { title: 'Überweisung', icon: Landmark, hint: 'Zahlung per Überweisung' }
} as const

interface MethodDraft {
  label: string
  text: string
  dueDays: string
}

interface Draft {
  methods: Record<number, MethodDraft>
  defaultId: number | null
}

function toDraft(methods: PaymentMethod[]): Draft {
  return {
    methods: Object.fromEntries(methods.map((m) => [m.id, { label: m.label, text: m.text, dueDays: String(m.dueDays) }])),
    defaultId: methods.find((m) => m.isDefault)?.id ?? null
  }
}

function methodErrors(d: MethodDraft): { label?: string; dueDays?: string } {
  const due = parseIntegerInput(d.dueDays)
  return {
    label:
      d.label.trim() === ''
        ? 'Bitte einen Anzeigenamen angeben.'
        : d.label.trim().length > 40
          ? 'Höchstens 40 Zeichen.'
          : undefined,
    dueDays: due === null || due > 365 ? 'Ganze Zahl zwischen 0 und 365.' : undefined
  }
}

function methodPatch(m: PaymentMethod, d: MethodDraft, defaultId: number | null): PaymentMethodUpdateInput {
  const patch: PaymentMethodUpdateInput = {}
  if (d.label.trim() !== m.label) patch.label = d.label.trim()
  if (d.text !== m.text) patch.text = d.text
  const due = parseIntegerInput(d.dueDays)
  if (due !== null && due !== m.dueDays) patch.dueDays = due
  if (defaultId === m.id && !m.isDefault) patch.isDefault = true
  return patch
}

export default function FestZahlartenPage() {
  const { festival } = useActiveFestival()
  if (!festival) return null
  return (
    <PageContainer className={`${FEST_PAGE_CLASS} max-w-6xl`}>
      <ScrollToTopOnMount />
      <PageHeader
        title="Zahlarten"
        description="Der Text der gewählten Zahlart erscheint im Block „Zahlungstext“ der Rechnung. Platzhalter wie {Gesamtbetrag} werden beim Abschluss ersetzt."
      />
      <PaymentMethodsView key={festival.id} festival={festival} />
    </PageContainer>
  )
}

function PaymentMethodsView({ festival }: { festival: Festival }) {
  const key = queryKeys.paymentMethods(festival.id)
  const query = useQuery<PaymentMethod[]>({ queryKey: key, queryFn: () => api.paymentMethods.list(festival.id) })

  if (query.isLoading) {
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }
  if (query.error || !query.data) {
    return (
      <p role="alert" className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive">
        Zahlarten konnten nicht geladen werden: {errorMessage(query.error)}
      </p>
    )
  }
  return <PaymentMethodsForm festival={festival} methods={query.data} />
}

function PaymentMethodsForm({ festival, methods }: { festival: Festival; methods: PaymentMethod[] }) {
  const formId = useId()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft>(() => toDraft(methods))
  const [saving, setSaving] = useState(false)

  const patches = methods.map((m) => ({ method: m, patch: methodPatch(m, draft.methods[m.id]!, draft.defaultId) }))
  const invalid = methods.some((m) => {
    const e = methodErrors(draft.methods[m.id]!)
    return Boolean(e.label || e.dueDays)
  })
  const dirty =
    patches.some((p) => Object.keys(p.patch).length > 0) ||
    methods.some((m) => {
      const d = draft.methods[m.id]!
      return d.label !== m.label || parseIntegerInput(d.dueDays) !== m.dueDays
    })

  function setMethod(id: number, partial: Partial<MethodDraft>) {
    setDraft((d) => ({ ...d, methods: { ...d.methods, [id]: { ...d.methods[id]!, ...partial } } }))
  }

  async function save() {
    if (!dirty || saving) return
    if (invalid) {
      toast.error('Bitte die markierten Eingaben prüfen.')
      return
    }
    setSaving(true)
    try {
      // zuerst die neue Standard-Zahlart (setzt die bisherige im Main zurück), dann die übrigen
      const ordered = [...patches].sort((a, b) => Number(Boolean(b.patch.isDefault)) - Number(Boolean(a.patch.isDefault)))
      for (const { method, patch } of ordered) {
        if (Object.keys(patch).length > 0) await api.paymentMethods.update(method.id, patch)
      }
      const fresh = await api.paymentMethods.list(festival.id)
      queryClient.setQueryData(queryKeys.paymentMethods(festival.id), fresh)
      setDraft(toDraft(fresh))
      toast.success('Zahlarten gespeichert.')
    } catch (err) {
      toast.error(errorMessage(err))
      await queryClient.invalidateQueries({ queryKey: queryKeys.paymentMethods(festival.id) })
    } finally {
      setSaving(false)
    }
  }
  useSaveShortcut(() => void save(), true)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void save()
  }

  return (
    <form id={formId} onSubmit={handleSubmit} noValidate aria-label="Zahlarten" className="space-y-6">
      <RadioGroup
        value={draft.defaultId !== null ? String(draft.defaultId) : ''}
        onValueChange={(value) => setDraft((d) => ({ ...d, defaultId: Number(value) }))}
        aria-label="Standard-Zahlart"
        className="@container block"
      >
        <div className="grid gap-6 @4xl:grid-cols-2">
          {methods.map((m) => (
            <PaymentMethodCard
              key={m.id}
              festival={festival}
              method={m}
              draft={draft.methods[m.id]!}
              isDefault={draft.defaultId === m.id}
              onChange={(partial) => setMethod(m.id, partial)}
            />
          ))}
        </div>
      </RadioGroup>
      <SaveBar dirty={dirty} saving={saving} canSave={!invalid} onDiscard={() => setDraft(toDraft(methods))} />
    </form>
  )
}

function PaymentMethodCard({
  festival,
  method,
  draft,
  isDefault,
  onChange
}: {
  festival: Festival
  method: PaymentMethod
  draft: MethodDraft
  isDefault: boolean
  onChange: (partial: Partial<MethodDraft>) => void
}) {
  const baseId = useId()
  const info = KIND_INFO[method.kind]
  const Icon = info.icon
  const errors = methodErrors(draft)
  const dueDays = parseIntegerInput(draft.dueDays)
  const displayName = draft.label.trim() || info.title

  const example = useMemo(() => {
    const today = todayIso()
    const data = getSampleRenderData({
      number: formatInvoiceNumber(festival.numberPrefix, festival.numberNext, festival.numberDigits),
      festivalName: festival.name,
      invoiceDate: today,
      today,
      serviceDate: festival.festivalDate,
      dueDate: addDays(today, dueDays !== null && dueDays <= 365 ? dueDays : method.dueDays),
      paymentKind: method.kind,
      paymentLabel: displayName,
      paymentText: draft.text,
      taxExempt: festival.taxExempt
    })
    return sanitizeHtml(replacePlaceholders(draft.text, data, { html: true }))
  }, [draft.text, dueDays, displayName, festival, method.kind, method.dueDays])

  const ids = {
    label: `${baseId}-label`,
    due: `${baseId}-due`,
    text: `${baseId}-text`,
    radio: `${baseId}-default`
  }

  return (
    <section
      aria-labelledby={`${baseId}-title`}
      className={cn(
        'flex min-w-0 flex-col rounded-xl border bg-card shadow-xs transition-colors',
        isDefault && 'border-primary/50 ring-1 ring-primary/20'
      )}
      data-testid={`payment-card-${method.kind}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-primary" aria-hidden>
            <Icon className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 id={`${baseId}-title`} className="truncate font-semibold" title={displayName}>
              {displayName}
            </h2>
            <p className="truncate text-xs text-muted-foreground">{info.hint}</p>
          </div>
        </div>
        <Label
          htmlFor={ids.radio}
          className={cn(
            'flex h-9 cursor-pointer items-center gap-2 rounded-full border px-3 font-normal transition-colors',
            isDefault ? 'border-primary bg-accent text-accent-foreground' : 'hover:bg-accent/60'
          )}
        >
          <RadioGroupItem id={ids.radio} value={String(method.id)} aria-label={`${info.title} als Standard vorauswählen`} />
          Standard
        </Label>
      </div>

      <div className="grid gap-4 p-4 sm:p-5">
        <div className="grid grid-cols-[minmax(0,1fr)_9.5rem] gap-4">
          <div className="grid min-w-0 content-start gap-2">
            <Label htmlFor={ids.label}>Anzeigename</Label>
            <Input
              id={ids.label}
              value={draft.label}
              onChange={(e) => onChange({ label: e.target.value })}
              autoComplete="off"
              aria-invalid={errors.label ? true : undefined}
              aria-describedby={`${ids.label}-msg`}
            />
            <FieldMessage id={`${ids.label}-msg`} error={Boolean(errors.label)}>
              {errors.label ?? 'In der Maske und als {Zahlart}.'}
            </FieldMessage>
          </div>
          <div className="grid min-w-0 content-start gap-2">
            <Label htmlFor={ids.due}>Zahlungsfrist</Label>
            <div className="relative">
              <Input
                id={ids.due}
                inputMode="numeric"
                value={draft.dueDays}
                onChange={(e) => onChange({ dueDays: e.target.value.replace(/[^\d]/g, '').slice(0, 3) })}
                className="pr-12 tabular-nums"
                aria-invalid={errors.dueDays ? true : undefined}
                aria-describedby={`${ids.due}-msg`}
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground" aria-hidden>
                Tage
              </span>
            </div>
            <FieldMessage id={`${ids.due}-msg`} error={Boolean(errors.dueDays)}>
              {errors.dueDays ?? (dueDays === 0 ? 'Sofort fällig.' : `Fällig nach ${dueDays} Tagen.`)}
            </FieldMessage>
          </div>
        </div>

        <div className="grid min-w-0 gap-2">
          <Label htmlFor={ids.text}>Zahlungstext</Label>
          <RichTextEditor
            id={ids.text}
            value={draft.text}
            onChange={(html) => onChange({ text: html })}
            ariaLabel={`Zahlungstext ${info.title}`}
            minimal
            placeholder="Text für die Rechnung …"
          />
        </div>

        <div className="min-w-0 rounded-lg border border-dashed bg-muted/50 px-3 py-2.5" data-testid={`payment-example-${method.kind}`}>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Beispiel mit Musterdaten</p>
          {example ? (
            <div
              className="text-sm leading-relaxed break-words [&_p]:min-h-[1lh] [&_strong]:font-semibold"
              // bereinigtes HTML (sanitizeHtml): nur einfache Textformatierung
              dangerouslySetInnerHTML={{ __html: example }}
            />
          ) : (
            <p className="text-sm text-muted-foreground italic">Kein Zahlungstext – der Block bleibt auf der Rechnung leer.</p>
          )}
        </div>
      </div>
    </section>
  )
}
