import { useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Info, ReceiptText, TriangleAlert } from 'lucide-react'
import type { Club, ClubInput } from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorMessage } from '@/lib/utils'
import { clubNameKey, parsePersonsInput } from './club-list'

interface ClubFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = neuen Verein anlegen */
  club: Club | null
  /** alle Vereine des Fests (Hinweis auf gleichnamige Vereine) */
  clubs: Club[]
  /** speichert; wirft mit deutscher Meldung */
  onSubmit: (input: ClubInput) => Promise<void>
  /** wechselt bei jedem Öffnen → Formular startet frisch */
  session: number
}

/** Dialog „Verein anlegen“ / „Verein bearbeiten“. */
export function ClubFormDialog({ open, onOpenChange, club, clubs, onSubmit, session }: ClubFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[calc(100vh-6rem)] flex-col gap-0 overflow-hidden p-0 transition-none sm:max-w-lg"
        data-testid="club-form-dialog"
      >
        <ClubForm key={session} club={club} clubs={clubs} onSubmit={onSubmit} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

interface FormValues {
  clubName: string
  contactName: string
  street: string
  zip: string
  city: string
  registeredPersons: string
}

type FormErrors = Partial<Record<'clubName' | 'registeredPersons', string>>

function initialValues(club: Club | null): FormValues {
  return {
    clubName: club?.clubName ?? '',
    contactName: club?.contactName ?? '',
    street: club?.street ?? '',
    zip: club?.zip ?? '',
    city: club?.city ?? '',
    registeredPersons: club ? String(club.registeredPersons) : ''
  }
}

function validate(values: FormValues): FormErrors {
  const errors: FormErrors = {}
  if (values.clubName.trim() === '') errors.clubName = 'Bitte den Vereinsnamen angeben.'
  if (parsePersonsInput(values.registeredPersons) === null) {
    errors.registeredPersons = 'Bitte eine ganze Zahl ab 0 eingeben (ohne Zusätze wie „ca.“).'
  }
  return errors
}

function ClubForm({
  club,
  clubs,
  onSubmit,
  onCancel
}: {
  club: Club | null
  clubs: Club[]
  onSubmit: (input: ClubInput) => Promise<void>
  onCancel: () => void
}) {
  const id = useId()
  const [values, setValues] = useState<FormValues>(() => initialValues(club))
  const [errors, setErrors] = useState<FormErrors>({})
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const clubNameRef = useRef<HTMLInputElement>(null)
  const personsRef = useRef<HTMLInputElement>(null)
  const isEdit = club !== null

  const duplicate = useMemo(() => {
    const key = clubNameKey(values.clubName)
    if (!key) return null
    return clubs.find((c) => c.id !== club?.id && clubNameKey(c.clubName) === key) ?? null
  }, [values.clubName, clubs, club])

  const set = (field: keyof FormValues) => (value: string) => {
    setValues((v) => ({ ...v, [field]: value }))
    if (field in errors) setErrors((e) => ({ ...e, [field]: undefined }))
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const found = validate(values)
    setErrors(found)
    if (found.clubName) return clubNameRef.current?.focus()
    if (found.registeredPersons) return personsRef.current?.focus()
    setSaving(true)
    setSubmitError(null)
    try {
      await onSubmit({
        clubName: values.clubName.trim(),
        contactName: values.contactName.trim(),
        street: values.street.trim(),
        zip: values.zip.trim(),
        city: values.city.trim(),
        registeredPersons: parsePersonsInput(values.registeredPersons) ?? 0
      })
    } catch (err) {
      setSubmitError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  // Pfeiltasten erhöhen/verringern die Personenzahl
  const handlePersonsKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const current = parsePersonsInput(values.registeredPersons) ?? 0
    const next = Math.max(0, current + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 10 : 1))
    set('registeredPersons')(String(next))
  }

  const field = (name: keyof FormValues) => `${id}-${name}`

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit} noValidate>
      <DialogHeader className="px-6 pt-6 pb-4 pr-12 text-left">
        <DialogTitle>{isEdit ? 'Verein bearbeiten' : 'Verein anlegen'}</DialogTitle>
        <DialogDescription>
          {isEdit && club.source === 'import'
            ? 'Dieser Verein stammt aus dem Excel-Import. Ein erneuter Import überschreibt Änderungen.'
            : 'Pflichtfelder sind Verein und angemeldete Personen.'}
        </DialogDescription>
      </DialogHeader>

      {/* Inhalt scrollt, Kopf und Buttons bleiben auch bei 560 px Fensterhöhe sichtbar */}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pt-1 pb-5">
        {isEdit && club.hasInvoice ? (
          <p className="flex gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm">
            <ReceiptText className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            <span>Für diesen Verein gibt es bereits eine Rechnung. Änderungen gelten nur für neue Rechnungen.</span>
          </p>
        ) : null}

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor={field('clubName')}>
              Verein <span className="text-destructive" aria-hidden>*</span>
            </Label>
            <Input
              ref={clubNameRef}
              id={field('clubName')}
              value={values.clubName}
              onChange={(e) => set('clubName')(e.target.value)}
              autoFocus
              autoComplete="off"
              required
              maxLength={200}
              aria-invalid={errors.clubName ? true : undefined}
              aria-describedby={errors.clubName ? `${field('clubName')}-error` : duplicate ? `${field('clubName')}-hint` : undefined}
              placeholder="z. B. FF Musterdorf"
            />
            {errors.clubName ? (
              <p id={`${field('clubName')}-error`} className="text-sm text-destructive">
                {errors.clubName}
              </p>
            ) : duplicate ? (
              <p id={`${field('clubName')}-hint`} className="flex items-start gap-1.5 text-sm text-muted-foreground">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  „{duplicate.clubName}“ ist bereits vorhanden
                  {duplicate.source === 'import' && !isEdit
                    ? '. Ein manueller Verein mit gleichem Namen wird beim nächsten Import ersetzt.'
                    : '.'}
                </span>
              </p>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor={field('contactName')}>Ansprechpartner (Name)</Label>
            <Input
              id={field('contactName')}
              value={values.contactName}
              onChange={(e) => set('contactName')(e.target.value)}
              autoComplete="off"
              maxLength={200}
              placeholder="z. B. Anna Beispiel"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor={field('street')}>Straße</Label>
            <Input
              id={field('street')}
              value={values.street}
              onChange={(e) => set('street')(e.target.value)}
              autoComplete="off"
              maxLength={200}
            />
          </div>

          <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
            <div className="grid gap-2">
              <Label htmlFor={field('zip')}>PLZ</Label>
              <Input
                id={field('zip')}
                value={values.zip}
                onChange={(e) => set('zip')(e.target.value)}
                autoComplete="off"
                inputMode="numeric"
                maxLength={20}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={field('city')}>Ort</Label>
              <Input
                id={field('city')}
                value={values.city}
                onChange={(e) => set('city')(e.target.value)}
                autoComplete="off"
                maxLength={200}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor={field('registeredPersons')}>
              Angemeldete Personen <span className="text-destructive" aria-hidden>*</span>
            </Label>
            <Input
              ref={personsRef}
              id={field('registeredPersons')}
              className="w-32 text-right tabular-nums"
              value={values.registeredPersons}
              onChange={(e) => set('registeredPersons')(e.target.value)}
              onKeyDown={handlePersonsKey}
              inputMode="numeric"
              autoComplete="off"
              placeholder="0"
              aria-invalid={errors.registeredPersons ? true : undefined}
              aria-describedby={errors.registeredPersons ? `${field('registeredPersons')}-error` : undefined}
            />
            {errors.registeredPersons ? (
              <p id={`${field('registeredPersons')}-error`} className="text-sm text-destructive">
                {errors.registeredPersons}
              </p>
            ) : null}
          </div>
        </div>

        {submitError ? (
          <p role="alert" className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
            <span>{submitError}</span>
          </p>
        ) : null}
      </div>

      <DialogFooter className="flex-row justify-end border-t px-6 py-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button type="submit" disabled={saving}>
          {isEdit ? 'Speichern' : 'Verein anlegen'}
        </Button>
      </DialogFooter>
    </form>
  )
}
