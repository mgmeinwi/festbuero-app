import { useState } from 'react'
import { Archive, ArchiveRestore, Copy, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import { formatDate } from '@shared/dates'
import type { Festival } from '@shared/types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useActiveFestival } from '@/hooks/use-active-festival'
import { errorMessage } from '@/lib/utils'
import { useAllFestivals, useUpdateFestival } from './festival-queries'
import { SettingsSection } from './form-kit'

/** „Fest kopieren“ und „Archivieren“ für das aktive Fest. */
export function FestivalActionsSection({ festival, onCopy }: { festival: Festival; onCopy: () => void }) {
  const { festivals, setActiveFestival } = useActiveFestival()
  const update = useUpdateFestival()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const next = festivals.find((f) => f.id !== festival.id) ?? null

  async function archive() {
    if (!next) return
    try {
      await update.mutateAsync({ id: festival.id, patch: { archived: true } })
      await setActiveFestival(next.id)
      setConfirmOpen(false)
      toast.success(`„${festival.name}“ archiviert. Aktives Fest: „${next.name}“.`, {
        action: {
          label: 'Rückgängig',
          onClick: () => {
            update
              .mutateAsync({ id: festival.id, patch: { archived: false } })
              .then(() => setActiveFestival(festival.id))
              .then(() => toast.success(`„${festival.name}“ wiederhergestellt.`))
              .catch((err: unknown) => toast.error(errorMessage(err)))
          }
        }
      })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <SettingsSection title="Fest kopieren oder archivieren" icon={<Copy />}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64 space-y-1">
          <p className="text-sm font-medium">Fest kopieren</p>
          <p className="text-sm text-muted-foreground">
            Neues Fest mit denselben Einstellungen, Produkten, Vorlage und Zahlungsarten – ohne Vereine und Rechnungen.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={onCopy}>
          <Copy aria-hidden />
          Fest kopieren …
        </Button>
      </div>
      <div className="h-px bg-border" role="separator" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64 space-y-1">
          <p className="text-sm font-medium">Fest archivieren</p>
          <p className="text-sm text-muted-foreground" id="archive-hint">
            {next
              ? 'Blendet das Fest in der Auswahl aus. Rechnungen und Daten bleiben erhalten und lassen sich jederzeit wiederherstellen.'
              : 'Das einzige aktive Fest kann nicht archiviert werden. Legen Sie zuerst ein weiteres Fest an oder kopieren Sie dieses.'}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="text-destructive hover:text-destructive"
          onClick={() => setConfirmOpen(true)}
          disabled={!next}
          aria-describedby="archive-hint"
        >
          <Archive aria-hidden />
          Archivieren …
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => !update.isPending && setConfirmOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>„{festival.name}“ archivieren?</AlertDialogTitle>
            <AlertDialogDescription>
              Das Fest verschwindet aus der Fest-Auswahl und dem Menü. Rechnungen, PDFs und Einstellungen bleiben erhalten;
              unter „Archivierte Feste“ lässt es sich wiederherstellen.
              {next ? ` Danach ist „${next.name}“ das aktive Fest.` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={update.isPending}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={update.isPending}
              onClick={(event) => {
                event.preventDefault()
                void archive()
              }}
            >
              {update.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Archive aria-hidden />}
              Archivieren
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  )
}

/** Liste der archivierten Feste mit „Wiederherstellen“. */
export function ArchivedFestivalsSection() {
  const all = useAllFestivals()
  const { setActiveFestival } = useActiveFestival()
  const update = useUpdateFestival()
  const [pendingId, setPendingId] = useState<number | null>(null)
  const archived = (all.data ?? []).filter((f) => f.archived)

  async function restore(festival: Festival) {
    setPendingId(festival.id)
    try {
      await update.mutateAsync({ id: festival.id, patch: { archived: false } })
      toast.success(`„${festival.name}“ wiederhergestellt.`, {
        action: {
          label: 'Zum Fest wechseln',
          onClick: () => {
            setActiveFestival(festival.id).catch((err: unknown) => toast.error(errorMessage(err)))
          }
        }
      })
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setPendingId(null)
    }
  }

  return (
    <SettingsSection
      id="archived-festivals"
      title="Archivierte Feste"
      description={archived.length > 0 ? 'Wiederhergestellte Feste erscheinen wieder in der Fest-Auswahl.' : undefined}
      icon={<ArchiveRestore />}
    >
      {archived.length === 0 ? (
        <p className="text-sm text-muted-foreground">Keine archivierten Feste.</p>
      ) : (
        <ul className="divide-y rounded-lg border" aria-label="Archivierte Feste">
          {archived.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
              <div className="min-w-0 flex-1 basis-48">
                <p className="truncate text-sm font-medium" title={f.name}>
                  {f.name}
                </p>
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {formatDate(f.festivalDate, 'Lang')}
                  {f.hasInvoices ? <Badge variant="secondary">mit Rechnungen</Badge> : null}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void restore(f)}
                disabled={pendingId !== null}
                aria-label={`„${f.name}“ wiederherstellen`}
              >
                {pendingId === f.id ? <LoaderCircle className="animate-spin" aria-hidden /> : <ArchiveRestore aria-hidden />}
                Wiederherstellen
              </Button>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  )
}
