/**
 * App-Einstellungen → Updates: Version, Suche, Download mit Fortschritt, Installation.
 * Windows installiert selbst (Neustart), macOS öffnet die DMG und beendet die App (siehe services/updater.ts).
 */
import { useState } from 'react'
import { CircleCheck, Download, ExternalLink, LoaderCircle, RefreshCw, RotateCcw, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import type { UpdateStatus } from '@shared/types'
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
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useAppSettings } from '@/hooks/use-app-settings'
import { useUpdateActions, useUpdateStatus } from '@/hooks/use-updates'
import { errorMessage } from '@/lib/utils'

function formatCheckedAt(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
}

function ReleaseLink({ url }: { url: string | null }) {
  if (!url) return null
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
    >
      Was ist neu?
      <ExternalLink className="size-3.5" aria-hidden />
    </a>
  )
}

function StatusLine({ status }: { status: UpdateStatus }) {
  const checkedAt = formatCheckedAt(status.checkedAt)
  switch (status.phase) {
    case 'unsupported':
      return <p className="text-sm text-muted-foreground">{status.message}</p>
    case 'idle':
      return <p className="text-sm text-muted-foreground">Noch nicht nach Updates gesucht.</p>
    case 'checking':
      return (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          Suche nach Updates …
        </p>
      )
    case 'upToDate':
      return (
        <p className="flex items-start gap-2 text-sm">
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          <span>
            Festbüro ist auf dem neuesten Stand.
            {checkedAt ? <span className="text-muted-foreground"> Zuletzt geprüft: {checkedAt}</span> : null}
          </span>
        </p>
      )
    case 'available':
      return (
        <div className="space-y-1">
          <p className="text-sm font-medium">Version {status.latestVersion} ist verfügbar.</p>
          <ReleaseLink url={status.releaseUrl} />
        </div>
      )
    case 'downloading':
      return (
        <div className="space-y-2">
          <p className="text-sm">
            Version {status.latestVersion} wird heruntergeladen …
            {status.progress !== null ? <span className="tabular-nums"> {status.progress} %</span> : null}
          </p>
          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Download-Fortschritt"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={status.progress ?? undefined}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${status.progress ?? 5}%` }}
            />
          </div>
        </div>
      )
    case 'ready':
      return status.installMode === 'install' ? (
        <p className="text-sm">
          <span className="font-medium">Version {status.latestVersion} ist bereit.</span> Zum Installieren startet
          Festbüro kurz neu. Ohne Neustart wird das Update beim nächsten Beenden installiert.
        </p>
      ) : (
        <div className="space-y-2 text-sm">
          <p className="font-medium">Version {status.latestVersion} ist heruntergeladen. So geht es weiter:</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Auf „Beenden und installieren“ klicken. Festbüro wird beendet, das Installationsfenster öffnet sich.</li>
            <li>
              Im Fenster <strong>Festbuero</strong> auf den Ordner <strong>Programme</strong> ziehen und
              „Ersetzen“ wählen.
            </li>
            <li>Festbüro wieder starten. Alle Daten bleiben erhalten.</li>
          </ol>
        </div>
      )
    case 'error':
      return (
        <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{status.message}</span>
        </p>
      )
  }
}

export function UpdatesSection() {
  const { data: status } = useUpdateStatus()
  const { settings, updateSettings } = useAppSettings()
  const { check, download, install } = useUpdateActions()
  const [confirmOpen, setConfirmOpen] = useState(false)

  if (!status) return <p className="text-sm text-muted-foreground">–</p>

  const busy = status.phase === 'checking' || status.phase === 'downloading' || check.isPending
  const unsupported = status.phase === 'unsupported'

  const runInstall = () => {
    install.mutate(undefined, {
      onError: (err) => toast.error(errorMessage(err)),
      onSettled: () => setConfirmOpen(false)
    })
  }

  return (
    <>
      <div className="flex flex-col gap-3 @lg:flex-row @lg:items-start @lg:justify-between">
        <div className="min-w-0 space-y-2">
          <p className="text-sm">
            Installierte Version <span className="font-medium tabular-nums">{status.currentVersion}</span>
          </p>
          <div data-testid="settings-update-status">
            <StatusLine status={status} />
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {status.phase === 'available' ? (
            <Button onClick={() => download.mutate()} disabled={download.isPending} data-testid="settings-update-download">
              <Download aria-hidden />
              Herunterladen
            </Button>
          ) : null}
          {status.phase === 'ready' ? (
            <Button onClick={() => setConfirmOpen(true)} data-testid="settings-update-install">
              <RotateCcw aria-hidden />
              {status.installMode === 'install' ? 'Jetzt neu starten' : 'Beenden und installieren'}
            </Button>
          ) : null}
          {status.phase !== 'ready' && status.phase !== 'available' ? (
            <Button
              variant="outline"
              onClick={() => check.mutate()}
              disabled={busy || unsupported}
              data-testid="settings-update-check"
            >
              {status.phase === 'checking' ? <LoaderCircle className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
              {status.phase === 'error' ? 'Erneut versuchen' : 'Nach Updates suchen'}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex items-start gap-3">
        <Switch
          id="settings-auto-update"
          checked={settings?.autoUpdateCheck ?? true}
          disabled={!settings}
          onCheckedChange={(checked) => {
            updateSettings({ autoUpdateCheck: checked }).catch((err) => toast.error(errorMessage(err)))
          }}
          data-testid="settings-auto-update"
        />
        <div className="min-w-0 space-y-0.5">
          <Label htmlFor="settings-auto-update" className="text-sm font-medium">
            Beim Start nach Updates suchen
          </Label>
          <p className="text-sm text-muted-foreground">
            Braucht eine Internetverbindung; ohne Internet passiert nichts. Installiert wird nie ohne Rückfrage.
          </p>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => !install.isPending && setConfirmOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {status.installMode === 'install' ? 'Festbüro neu starten?' : 'Festbüro beenden und installieren?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {status.installMode === 'install'
                ? 'Festbüro wird beendet, das Update installiert und die App danach automatisch wieder gestartet.'
                : 'Festbüro wird beendet und das Installationsfenster geöffnet. Dort Festbuero in „Programme“ ziehen und „Ersetzen“ wählen.'}{' '}
              Nicht abgeschlossene Eingaben in der Festbüro-Maske gehen verloren; abgeschlossene Rechnungen sind
              gespeichert.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={install.isPending}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              disabled={install.isPending}
              onClick={(event) => {
                event.preventDefault()
                runInstall()
              }}
            >
              {install.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />}
              {status.installMode === 'install' ? 'Neu starten' : 'Beenden und installieren'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
