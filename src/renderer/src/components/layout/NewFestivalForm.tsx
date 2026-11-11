import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { isValidIsoDate, todayIso } from '@shared/dates'
import { defaultNumberPrefix, formatInvoiceNumber, MAX_NUMBER_DIGITS } from '@shared/numbering'
import type { Festival, FestivalCreateInput } from '@shared/types'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { queryKeys } from '@/hooks/query-keys'
import { useAppSettings } from '@/hooks/use-app-settings'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/utils'

interface NewFestivalFormProps {
  /** Wird nach erfolgreicher Anlage aufgerufen (das Fest ist dann bereits aktiv). */
  onCreated?: (festival: Festival) => void
  /** Rendert die Aktionsleiste; `submitting` = Anlage läuft. Button muss `type="submit"` + `form={formId}` haben. */
  renderActions: (args: { submitting: boolean; formId: string }) => ReactNode
}

/** Formular „Neues Gründungsfest“ (Kopfleiste und Ersteinrichtung). */
export function NewFestivalForm({ onCreated, renderActions }: NewFestivalFormProps) {
  const formId = useId()
  const queryClient = useQueryClient()
  const { updateSettings } = useAppSettings()

  const [name, setName] = useState('')
  const [festivalDate, setFestivalDate] = useState(todayIso())
  const [prefix, setPrefix] = useState(defaultNumberPrefix(todayIso()))
  const [prefixTouched, setPrefixTouched] = useState(false)
  const [start, setStart] = useState('1')
  const [digits, setDigits] = useState('3')
  const [error, setError] = useState<string | null>(null)

  const startNum = Number(start)
  const digitsNum = Number(digits)
  const startValid = start.trim() !== '' && Number.isInteger(startNum) && startNum >= 0
  const digitsValid = Number.isInteger(digitsNum) && digitsNum >= 1 && digitsNum <= MAX_NUMBER_DIGITS
  const preview = startValid && digitsValid ? formatInvoiceNumber(prefix, startNum, digitsNum) : '–'

  const mutation = useMutation({
    mutationFn: (input: FestivalCreateInput) => api.festivals.create(input),
    onSuccess: async (festival) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.festivals })
      await updateSettings({ lastFestivalId: festival.id })
      toast.success(`Gründungsfest „${festival.name}“ angelegt.`)
      onCreated?.(festival)
    },
    onError: (err) => setError(errorMessage(err))
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (name.trim() === '') return setError('Bitte einen Namen für das Fest angeben.')
    if (!isValidIsoDate(festivalDate)) return setError('Bitte ein gültiges Festdatum angeben.')
    if (!startValid) return setError('Die Startnummer muss eine ganze Zahl ab 0 sein.')
    if (!digitsValid) return setError(`Die Stellenzahl muss zwischen 1 und ${MAX_NUMBER_DIGITS} liegen.`)
    mutation.mutate({
      name: name.trim(),
      festivalDate,
      numberPrefix: prefix,
      numberStart: startNum,
      numberDigits: digitsNum
    })
  }

  return (
    <>
      <form id={formId} onSubmit={handleSubmit} className="grid gap-4" noValidate>
        <div className="grid gap-2">
          <Label htmlFor={`${formId}-name`}>Name des Fests</Label>
          <Input
            id={`${formId}-name`}
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. 100-jähriges Gründungsfest"
            autoFocus
            autoComplete="off"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${formId}-date`}>Festdatum</Label>
          <Input
            id={`${formId}-date`}
            name="festivalDate"
            type="date"
            value={festivalDate}
            onChange={(e) => {
              setFestivalDate(e.target.value)
              if (!prefixTouched && isValidIsoDate(e.target.value)) setPrefix(defaultNumberPrefix(e.target.value))
            }}
          />
          <p className="text-xs text-muted-foreground">Standard für das Leistungsdatum auf den Rechnungen.</p>
        </div>
        <fieldset className="grid gap-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">Rechnungsnummern</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor={`${formId}-prefix`}>Präfix</Label>
              <Input
                id={`${formId}-prefix`}
                name="numberPrefix"
                value={prefix}
                onChange={(e) => {
                  setPrefix(e.target.value)
                  setPrefixTouched(true)
                }}
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${formId}-start`}>Startnummer</Label>
              <Input
                id={`${formId}-start`}
                name="numberStart"
                inputMode="numeric"
                value={start}
                onChange={(e) => setStart(e.target.value.replace(/[^\d]/g, ''))}
                aria-invalid={!startValid || undefined}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${formId}-digits`}>Stellenzahl</Label>
              <Input
                id={`${formId}-digits`}
                name="numberDigits"
                inputMode="numeric"
                value={digits}
                onChange={(e) => setDigits(e.target.value.replace(/[^\d]/g, ''))}
                aria-invalid={!digitsValid || undefined}
              />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Erste Rechnungsnummer: <span className="font-medium text-foreground tabular-nums">{preview}</span>
          </p>
        </fieldset>
        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </form>
      {renderActions({ submitting: mutation.isPending, formId })}
    </>
  )
}
