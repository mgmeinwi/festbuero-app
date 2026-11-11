/**
 * Route: /einstellungen – App-Einstellungen (gelten pro Rechner). Bereich „Setup & Auslieferung“.
 *
 * Dokumentenordner, Drucker + Testseite, Darstellung, Datensicherung, Beispiel-Fest,
 * Einrichtungsassistent, Info. Menüaktionen: `app.backup`, `printing.testPage`.
 */
import { useState, type ReactNode } from 'react'
import {
  Archive,
  CircleCheck,
  FlaskConical,
  FolderOpen,
  Info,
  LoaderCircle,
  Monitor,
  Moon,
  Palette,
  Printer,
  RefreshCw,
  Sun,
  TriangleAlert,
  Wand2
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import type { ThemePreference } from '@shared/types'
import { PageContainer, PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { queryKeys } from '@/hooks/query-keys'
import { useActiveFestival } from '@/hooks/use-active-festival'
import { useAppInfo, useAppSettings } from '@/hooks/use-app-settings'
import { usePrinters, usePrinterStatus } from '@/hooks/use-printers'
import { api } from '@/lib/api'
import { useMenuAction } from '@/lib/menu-actions'
import { cn, errorMessage } from '@/lib/utils'
import { FOLDER_APP, useCreateBackup, useCreateSampleFestival, usePrintTestPage } from './actions'
import { PathText } from './PathText'

/* ------------------------------------------------------------------ */
/* Bausteine                                                           */
/* ------------------------------------------------------------------ */

function SectionCard({
  icon,
  title,
  description,
  children,
  testId
}: {
  icon: ReactNode
  title: string
  description?: ReactNode
  children: ReactNode
  testId?: string
}) {
  return (
    <Card className="gap-4" data-testid={testId}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
          {title}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="@container space-y-4">{children}</CardContent>
    </Card>
  )
}

/** Pfad in einer Box, vorne gekürzt (Ordnername bleibt sichtbar), voller Pfad im Tooltip. */
function PathBox({ path, placeholder, testId }: { path: string | null | undefined; placeholder: string; testId?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
      {path ? (
        <PathText path={path} className="flex-1 font-mono" data-testid={testId} />
      ) : (
        <span className="flex-1 text-muted-foreground" data-testid={testId}>
          {placeholder}
        </span>
      )}
    </div>
  )
}

/** Zeile mit Text links und Aktion rechts; bei schmaler Karte untereinander. */
function ActionRow({ title, description, action }: { title: string; description: ReactNode; action: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 @lg:flex-row @lg:items-center @lg:justify-between">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">{action}</div>
    </div>
  )
}

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Hell', icon: Sun },
  { value: 'dark', label: 'Dunkel', icon: Moon }
]

/* ------------------------------------------------------------------ */
/* Seite                                                               */
/* ------------------------------------------------------------------ */

export default function EinstellungenPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { settings, updateSettings } = useAppSettings()
  const { data: info } = useAppInfo()
  const { festival, setActiveFestival } = useActiveFestival()
  const { data: printers = [], isLoading: printersLoading, isFetching: printersFetching } = usePrinters()
  const { data: printerStatus } = usePrinterStatus()
  const { printTestPage, isPending: testPagePending } = usePrintTestPage()
  const [lastBackup, setLastBackup] = useState<string | null>(null)
  const backup = useCreateBackup(setLastBackup)
  const sample = useCreateSampleFestival((created) => {
    toast.success(`„${created.name}“ angelegt.`, {
      description: '8 Produkte, Muster-Vorlage und 12 erfundene Vereine.',
      action: {
        label: 'Zum Fest wechseln',
        onClick: () => {
          setActiveFestival(created.id)
            .then(() => navigate('/festbuero'))
            .catch((err: unknown) => toast.error(errorMessage(err)))
        }
      }
    })
  })

  const documentsDir = settings?.documentsDir ?? null
  const printer = settings?.defaultPrinter ?? null
  const printerInfo = printers.find((p) => p.name === printer)
  const printerLabel = printerInfo?.displayName ?? printer
  const printerMissing = !!printer && !printersLoading && !printerInfo

  async function pickDocumentsDir() {
    try {
      const dir = await api.app.pickDirectory({
        title: 'Dokumentenordner für Rechnungs-PDFs wählen',
        defaultPath: documentsDir ?? undefined
      })
      if (!dir) return
      await updateSettings({ documentsDir: dir })
      toast.success('Dokumentenordner gespeichert.', { description: dir })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  function openFolder(path: string | null | undefined) {
    if (!path) return
    api.app.openPath(path).catch((err: unknown) => toast.error(errorMessage(err)))
  }

  async function selectPrinter(name: string) {
    try {
      await updateSettings({ defaultPrinter: name })
      toast.success(`Drucker „${printers.find((p) => p.name === name)?.displayName ?? name}“ ausgewählt.`)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  function runTestPage() {
    if (!festival) {
      toast.info('Für die Testseite wird ein Gründungsfest benötigt. Bitte zuerst ein Fest anlegen.')
      return
    }
    if (!printer) {
      toast.info('Bitte zuerst einen Drucker wählen.')
      return
    }
    printTestPage(festival.id, printer, printerLabel ?? printer)
  }

  function runBackup() {
    if (!backup.isPending) backup.mutate()
  }

  useMenuAction('app.backup', runBackup)
  useMenuAction('printing.testPage', runTestPage)

  return (
    <PageContainer className="max-w-3xl">
      <PageHeader title="App-Einstellungen" description="Gelten für diesen Rechner." />

      {/* Dokumentenordner ------------------------------------------------ */}
      <SectionCard
        icon={<FolderOpen aria-hidden />}
        title="Dokumentenordner"
        description="Hier legt die App die Rechnungs-PDFs ab (pro Fest ein Unterordner) und speichert Datensicherungen."
        testId="settings-documents"
      >
        <PathBox path={documentsDir} placeholder="Noch nicht gewählt" testId="documents-dir" />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void pickDocumentsDir()}>
            <FolderOpen aria-hidden />
            Ändern …
          </Button>
          <Button variant="ghost" disabled={!documentsDir} onClick={() => openFolder(documentsDir)}>
            Im {FOLDER_APP} öffnen
          </Button>
        </div>
      </SectionCard>

      {/* Drucker --------------------------------------------------------- */}
      <SectionCard
        icon={<Printer aria-hidden />}
        title="Drucker"
        description="Auf diesem Drucker werden Rechnungen nach dem Abschließen ohne Dialog gedruckt."
        testId="settings-printer"
      >
        <div className="flex items-center gap-2">
          <Select value={printer ?? undefined} onValueChange={(value) => void selectPrinter(value)}>
            <SelectTrigger className="min-w-0 flex-1" aria-label="Standarddrucker" data-testid="settings-printer-select">
              <SelectValue placeholder={printersLoading ? 'Drucker werden gesucht …' : 'Drucker wählen'} />
            </SelectTrigger>
            <SelectContent>
              {printers.map((p) => (
                <SelectItem key={p.name} value={p.name} title={p.displayName}>
                  <span className="truncate">{p.displayName}</span>
                  {p.isDefault ? <span className="text-xs text-muted-foreground">(Systemstandard)</span> : null}
                </SelectItem>
              ))}
              {printerMissing ? (
                <SelectItem value={printer} disabled>
                  {printer} (nicht verfügbar)
                </SelectItem>
              ) : null}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            title="Druckerliste aktualisieren"
            aria-label="Druckerliste aktualisieren"
            disabled={printersFetching}
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: queryKeys.printers })
              void queryClient.invalidateQueries({ queryKey: queryKeys.printerStatus })
            }}
          >
            <RefreshCw className={cn(printersFetching && 'animate-spin')} aria-hidden />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="settings-printer-status">
          {!printer ? (
            <Badge variant="outline">Kein Drucker gewählt</Badge>
          ) : printerStatus?.available === false || printerMissing ? (
            <Badge variant="warning">
              <TriangleAlert aria-hidden />
              Nicht verfügbar
            </Badge>
          ) : printerStatus?.available ? (
            <Badge variant="success">
              <CircleCheck aria-hidden />
              Verfügbar
            </Badge>
          ) : null}
          {printer && printerStatus?.message && !printerStatus.available ? (
            <span className="min-w-0 text-muted-foreground">{printerStatus.message}</span>
          ) : null}
          {!printersLoading && printers.length === 0 ? (
            <span className="text-muted-foreground">Kein Drucker installiert.</span>
          ) : null}
          {info?.printDryRun ? (
            <Badge variant="secondary" data-testid="settings-dry-run">
              Druck wird simuliert
            </Badge>
          ) : null}
        </div>

        <ActionRow
          title="Testseite drucken"
          description={
            festival ? (
              <>
                Musterrechnung mit der Vorlage von „<span className="font-medium text-foreground">{festival.name}</span>“ –
                wird nicht als Rechnung gespeichert. Vor dem Fest unbedingt mit dem echten Festdrucker testen.
              </>
            ) : (
              'Für die Testseite wird ein Gründungsfest benötigt. Bitte zuerst ein Fest anlegen.'
            )
          }
          action={
            <Button
              variant="outline"
              disabled={!festival || !printer || testPagePending}
              onClick={runTestPage}
              data-testid="settings-test-page"
            >
              {testPagePending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Printer aria-hidden />}
              Testseite drucken
            </Button>
          }
        />
      </SectionCard>

      {/* Darstellung ----------------------------------------------------- */}
      <SectionCard icon={<Palette aria-hidden />} title="Darstellung" testId="settings-theme">
        <RadioGroup
          value={settings?.theme ?? 'system'}
          onValueChange={(value) => {
            updateSettings({ theme: value as ThemePreference }).catch((err) => toast.error(errorMessage(err)))
          }}
          className="grid grid-cols-3 gap-2"
          aria-label="Darstellung"
        >
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
            const checked = (settings?.theme ?? 'system') === value
            return (
              <label
                key={value}
                className={cn(
                  'flex min-w-0 cursor-pointer flex-col items-center gap-2 rounded-lg border p-3 text-sm transition-colors outline-none hover:bg-accent/50 has-[[role=radio]:focus-visible]:ring-[3px] has-[[role=radio]:focus-visible]:ring-ring/60 @md:flex-row @md:justify-center',
                  checked && 'border-primary bg-primary/5 font-medium hover:bg-primary/10'
                )}
              >
                <RadioGroupItem value={value} aria-label={label} className="sr-only" />
                <Icon className={cn('size-5', checked ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
                <span className="truncate">{label}</span>
              </label>
            )
          })}
        </RadioGroup>
      </SectionCard>

      {/* Datensicherung -------------------------------------------------- */}
      <SectionCard
        icon={<Archive aria-hidden />}
        title="Datensicherung"
        description="Sichert die Datenbank (Feste, Produkte, Vereine, Vorlagen, Rechnungen) und die Logos als ZIP-Datei im Dokumentenordner unter „Datensicherungen“."
        testId="settings-backup"
      >
        <div className="flex flex-wrap gap-2">
          <Button onClick={runBackup} disabled={backup.isPending || !documentsDir} data-testid="settings-backup-create">
            {backup.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Archive aria-hidden />}
            Datensicherung erstellen
          </Button>
        </div>
        {!documentsDir ? (
          <p className="text-sm text-muted-foreground">Dafür zuerst einen Dokumentenordner wählen.</p>
        ) : null}
        {lastBackup ? (
          <div
            className="flex min-w-0 items-center gap-2 rounded-md bg-success/10 px-3 py-2 text-sm"
            data-testid="settings-backup-result"
          >
            <CircleCheck className="size-4 shrink-0 text-success" aria-hidden />
            <span className="min-w-0 flex-1 truncate" title={lastBackup}>
              {lastBackup.split(/[\\/]/).pop()}
            </span>
            <Button
              variant="link"
              size="sm"
              className="h-auto shrink-0 p-0"
              onClick={() => api.app.showItemInFolder(lastBackup).catch((err: unknown) => toast.error(errorMessage(err)))}
            >
              Im {FOLDER_APP} zeigen
            </Button>
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Wiederherstellen: App beenden, die Dateien aus der ZIP in den Datenordner (siehe „Info“) kopieren und neu
          starten. Details stehen in der Datei „LIESMICH.txt“ in jeder Sicherung.
        </p>
      </SectionCard>

      {/* Beispieldaten & Einrichtung ------------------------------------ */}
      <SectionCard icon={<Wand2 aria-hidden />} title="Einrichtung" testId="settings-setup">
        <ActionRow
          title="Beispiel-Fest anlegen"
          description="Ein zusätzliches Fest zum Ausprobieren: Produkte der Musterrechnung, Beispiel-Vorlage und erfundene Vereine."
          action={
            <Button
              variant="outline"
              onClick={() => sample.mutate()}
              disabled={sample.isPending}
              data-testid="settings-sample-festival"
            >
              {sample.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : <FlaskConical aria-hidden />}
              Beispiel-Fest anlegen
            </Button>
          }
        />
        <ActionRow
          title="Einrichtungsassistent"
          description="Dokumentenordner, Drucker und Fest Schritt für Schritt einrichten."
          action={
            <Button variant="outline" onClick={() => void navigate('/setup')} data-testid="settings-open-setup">
              <Wand2 aria-hidden />
              Erneut öffnen
            </Button>
          }
        />
      </SectionCard>

      {/* Info ------------------------------------------------------------ */}
      <SectionCard icon={<Info aria-hidden />} title="Info" testId="settings-info">
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm @md:grid-cols-[9rem_minmax(0,1fr)] @md:gap-y-3">
          <dt className="text-muted-foreground">Version</dt>
          <dd className="mb-2 tabular-nums @md:mb-0" data-testid="settings-version">
            {info?.version ?? '–'}
          </dd>
          <dt className="text-muted-foreground">Datenordner</dt>
          <dd className="mb-2 flex min-w-0 items-center gap-2 @md:mb-0">
            {info ? <PathText path={info.userDataDir} className="flex-1" /> : <span className="flex-1">–</span>}
            <Button variant="outline" size="sm" disabled={!info} onClick={() => openFolder(info?.userDataDir)}>
              Öffnen
            </Button>
          </dd>
          <dt className="text-muted-foreground">Datenbank</dt>
          <dd className="mb-2 min-w-0 @md:mb-0">{info ? <PathText path={info.dbPath} /> : '–'}</dd>
          <dt className="text-muted-foreground">Druck</dt>
          <dd>
            {info ? (
              info.printDryRun ? (
                <span className="text-warning-foreground dark:text-warning">
                  Druck wird simuliert – es wird nichts an den Drucker gesendet.
                </span>
              ) : (
                'Echter Druck (ohne Druckdialog)'
              )
            ) : (
              '–'
            )}
          </dd>
        </dl>
      </SectionCard>
    </PageContainer>
  )
}
