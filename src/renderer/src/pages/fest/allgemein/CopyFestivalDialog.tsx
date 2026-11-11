import { useId, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft, CircleCheck, Copy, LoaderCircle, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { isValidIsoDate } from '@shared/dates'
import { defaultNumberPrefix, formatInvoiceNumber } from '@shared/numbering'
import type { Festival, FestivalCopyInput } from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { queryKeys } from '@/hooks/query-keys'
import { useActiveFestival } from '@/hooks/use-active-festival'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/utils'
import { findPrefixConflicts, formatFestivalNames, useAllFestivals } from './festival-queries'
import { FieldMessage, parseIntegerInput } from './form-kit'

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/** Gleiches Datum ein Jahr später (29.2. → 28.2.). */
export function addOneYear(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  const year = Number(m[1]) + 1
  const month = m[2]!
  let day = m[3]!
  if (month === '02' && day === '29' && !isLeapYear(year)) day = '28'
  return `${String(year).padStart(4, '0')}-${month}-${day}`
}

function yearOf(iso: string): string | null {
  return /^\d{4}/.test(iso) ? iso.slice(0, 4) : null
}

/** Vorschlag für den Namen der Kopie: Jahreszahl hochzählen, sonst „(Kopie)“. */
export function suggestCopyName(name: string, sourceDate: string, targetDate: string): string {
  const from = yearOf(sourceDate)
  const to = yearOf(targetDate)
  if (from && to && from !== to && name.includes(from)) return name.split(from).join(to)
  return `${name} (Kopie)`
}

/** Vorschlag für das Präfix: Jahreszahl im Präfix ersetzen, sonst Standard „<Jahr>-“. */
export function suggestCopyPrefix(prefix: string, sourceDate: string, targetDate: string): string {
  const from = yearOf(sourceDate)
  const to = yearOf(targetDate)
  if (from && to && prefix.includes(from)) return prefix.split(from).join(to)
  return defaultNumberPrefix(targetDate)
}

interface CopyFestivalDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  source: Festival
}

/** Dialog „Fest kopieren“ – danach wird angeboten, zum neuen Fest zu wechseln. */
export function CopyFestivalDialog({ open, onOpenChange, source }: CopyFestivalDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" data-testid="copy-festival-dialog">
        {open ? <CopyFestivalContent source={source} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function CopyFestivalContent({ source, onClose }: { source: Festival; onClose: () => void }) {
  const formId = useId()
  const queryClient = useQueryClient()
  const { setActiveFestival } = useActiveFestival()
  const allFestivals = useAllFestivals()

  const initialDate = addOneYear(source.festivalDate)
  const [name, setName] = useState(() => suggestCopyName(source.name, source.festivalDate, initialDate))
  const [festivalDate, setFestivalDate] = useState(initialDate)
  const [prefix, setPrefix] = useState(() => suggestCopyPrefix(source.numberPrefix, source.festivalDate, initialDate))
  const [prefixTouched, setPrefixTouched] = useState(false)
  const [start, setStart] = useState('1')
  const [showErrors, setShowErrors] = useState(false)
  const [created, setCreated] = useState<Festival | null>(null)
  const [switching, setSwitching] = useState(false)

  const startNum = parseIntegerInput(start)
  const errors = {
    name: name.trim() === '' ? 'Bitte einen Namen angeben.' : undefined,
    festivalDate: isValidIsoDate(festivalDate) ? undefined : 'Bitte ein gültiges Festdatum angeben.',
    prefix: prefix.length > 20 ? 'Das Präfix ist zu lang (höchstens 20 Zeichen).' : undefined,
    start: startNum === null ? 'Die Startnummer muss eine ganze Zahl ab 0 sein.' : undefined
  }
  const hasErrors = Object.values(errors).some(Boolean)
  const preview = startNum !== null ? formatInvoiceNumber(prefix, startNum, source.numberDigits) : '–'
  const conflicts = findPrefixConflicts(allFestivals.data, prefix, null)

  const mutation = useMutation({
    mutationFn: (input: FestivalCopyInput) => api.festivals.copy(source.id, input),
    onSuccess: async (festival) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.festivals })
      setCreated(festival)
      toast.success(`„${festival.name}“ wurde angelegt.`)
    }
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (hasErrors || startNum === null) {
      setShowErrors(true)
      return
    }
    mutation.mutate({ name: name.trim(), festivalDate, numberPrefix: prefix, numberStart: startNum })
  }

  async function switchToCreated() {
    if (!created) return
    setSwitching(true)
    try {
      await setActiveFestival(created.id)
      toast.success(`Aktives Fest: „${created.name}“.`)
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
      setSwitching(false)
    }
  }

  if (created) {
    return (
      <>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CircleCheck className="size-5 text-success" aria-hidden />
            Fest kopiert
          </DialogTitle>
          <DialogDescription>
            „{created.name}“ ist angelegt – mit Einstellungen, Produkten, Vorlage und Zahlungsarten von „{source.name}“.
            Jetzt zum neuen Fest wechseln?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Hier bleiben
            </Button>
          </DialogClose>
          <Button type="button" onClick={() => void switchToCreated()} disabled={switching} autoFocus>
            {switching ? <LoaderCircle className="animate-spin" aria-hidden /> : <ArrowRightLeft aria-hidden />}
            Zum neuen Fest wechseln
          </Button>
        </DialogFooter>
      </>
    )
  }

  const err = (key: keyof typeof errors) => (showErrors ? errors[key] : undefined)

  return (
    <>
      <DialogHeader>
        <DialogTitle>Fest kopieren</DialogTitle>
        <DialogDescription>
          Übernimmt Einstellungen, Produkte, Vorlage und Zahlungsarten von „{source.name}“ – ohne Vereine und Rechnungen.
        </DialogDescription>
      </DialogHeader>
      <form id={formId} onSubmit={handleSubmit} noValidate className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor={`${formId}-name`}>Name des neuen Fests</Label>
          <Input
            id={`${formId}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            autoComplete="off"
            aria-invalid={err('name') ? true : undefined}
          />
          {err('name') ? <FieldMessage error>{err('name')}</FieldMessage> : null}
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${formId}-date`}>Festdatum</Label>
          <Input
            id={`${formId}-date`}
            type="date"
            value={festivalDate}
            onChange={(e) => {
              setFestivalDate(e.target.value)
              if (!prefixTouched && isValidIsoDate(e.target.value)) {
                setPrefix(suggestCopyPrefix(source.numberPrefix, source.festivalDate, e.target.value))
              }
            }}
            aria-invalid={err('festivalDate') ? true : undefined}
          />
          {err('festivalDate') ? <FieldMessage error>{err('festivalDate')}</FieldMessage> : null}
        </div>
        <fieldset className="grid gap-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">Rechnungsnummern</legend>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor={`${formId}-prefix`}>Präfix</Label>
              <Input
                id={`${formId}-prefix`}
                value={prefix}
                onChange={(e) => {
                  setPrefix(e.target.value)
                  setPrefixTouched(true)
                }}
                autoComplete="off"
                aria-invalid={err('prefix') ? true : undefined}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${formId}-start`}>Startnummer</Label>
              <Input
                id={`${formId}-start`}
                inputMode="numeric"
                value={start}
                onChange={(e) => setStart(e.target.value.replace(/[^\d]/g, '').slice(0, 9))}
                aria-invalid={err('start') ? true : undefined}
              />
            </div>
          </div>
          {err('prefix') ? <FieldMessage error>{err('prefix')}</FieldMessage> : null}
          {err('start') ? <FieldMessage error>{err('start')}</FieldMessage> : null}
          <p className="text-sm text-muted-foreground">
            Erste Rechnungsnummer: <span className="font-medium text-foreground tabular-nums">{preview}</span>
            <span className="text-xs"> · {source.numberDigits} Stellen wie im Original</span>
          </p>
          {conflicts.length > 0 ? (
            <p className="flex items-start gap-2 rounded-md bg-warning/15 px-3 py-2 text-sm text-warning-foreground dark:text-warning" role="status">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Das Präfix „{prefix}“ nutzt auch {formatFestivalNames(conflicts)}. Rechnungsnummern müssen über alle Feste
                eindeutig sein – besser ein eigenes Präfix wählen.
              </span>
            </p>
          ) : null}
        </fieldset>
        {mutation.error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {errorMessage(mutation.error)}
          </p>
        ) : null}
      </form>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Abbrechen
          </Button>
        </DialogClose>
        <Button type="submit" form={formId} disabled={mutation.isPending}>
          {mutation.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Copy aria-hidden />}
          Fest kopieren
        </Button>
      </DialogFooter>
    </>
  )
}
