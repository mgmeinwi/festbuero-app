/**
 * Route: /fest/vereine – Vereinsstamm des aktiven Fests.
 * Zuständig: Bereich „Vereine“.
 *
 * Tabelle mit Suche und Sortierung, Anlegen/Bearbeiten im Dialog, Löschen mit Bestätigung,
 * Excel-Import mit Vorschau, Export der Anmelde-Vorlage. Menüaktionen: `clubs.import` (⌘I),
 * `clubs.exportTemplate`, `search.focus` (⌘F).
 */
import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { FileDown, FileUp, Plus, Search, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import type { Club, ClubImportPreview, ClubInput } from '@shared/types'
import { PageContainer, PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useActiveFestival } from '@/hooks/use-active-festival'
import { api } from '@/lib/api'
import { useMenuAction } from '@/lib/menu-actions'
import { errorMessage, isMac, modKey } from '@/lib/utils'
import { ClubFormDialog } from './ClubFormDialog'
import { ClubTable } from './ClubTable'
import {
  clubStats,
  DEFAULT_SORT,
  filterClubs,
  fileNameOf,
  formatNumber,
  importResultMessage,
  plural,
  sortClubs,
  toggleSort,
  type ClubSort
} from './club-list'
import { DeleteClubDialog } from './DeleteClubDialog'
import { ExportTemplateDialog } from './ExportTemplateDialog'
import { ImportPreviewDialog } from './ImportPreviewDialog'
import { useClubs, useInvalidateClubs } from './use-clubs'

export default function FestVereinePage() {
  const { festivalId } = useActiveFestival()
  if (festivalId === null) return null
  return <ClubsPage key={festivalId} festivalId={festivalId} />
}

interface ImportState {
  open: boolean
  filePath: string | null
  preview: ClubImportPreview | null
}

function ClubsPage({ festivalId }: { festivalId: number }) {
  const clubsQuery = useClubs(festivalId)
  const invalidate = useInvalidateClubs(festivalId)
  const clubs = useMemo(() => clubsQuery.data ?? [], [clubsQuery.data])

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<ClubSort>(DEFAULT_SORT)
  const searchRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState<{ open: boolean; club: Club | null; session: number }>({
    open: false,
    club: null,
    session: 0
  })
  const [deleteState, setDeleteState] = useState<{ open: boolean; club: Club | null }>({ open: false, club: null })
  const [exportOpen, setExportOpen] = useState(false)
  const [importState, setImportState] = useState<ImportState>({ open: false, filePath: null, preview: null })
  const importRunning = useRef(false)

  const visible = useMemo(() => sortClubs(filterClubs(clubs, query), sort), [clubs, query, sort])
  const stats = useMemo(() => clubStats(clubs), [clubs])
  const anyDialogOpen = form.open || deleteState.open || exportOpen || importState.open

  /* ---------------------------- Aktionen ---------------------------- */

  const openCreate = () => setForm((f) => ({ open: true, club: null, session: f.session + 1 }))
  const openEdit = (club: Club) => setForm((f) => ({ open: true, club, session: f.session + 1 }))

  const saveClub = async (input: ClubInput) => {
    const editing = form.club
    const saved = editing ? await api.clubs.update(editing.id, input) : await api.clubs.create(festivalId, input)
    await invalidate()
    setForm((f) => ({ ...f, open: false }))
    toast.success(editing ? `Änderungen an „${saved.clubName}“ gespeichert` : `Verein „${saved.clubName}“ angelegt`)
  }

  const deleteClub = async (club: Club) => {
    try {
      await api.clubs.delete(club.id)
      await invalidate()
      setDeleteState((s) => ({ ...s, open: false }))
      toast.success(`Verein „${club.clubName}“ gelöscht`)
    } catch (err) {
      toast.error(errorMessage(err, 'Der Verein konnte nicht gelöscht werden.'))
    }
  }

  const startImport = async () => {
    if (importRunning.current || anyDialogOpen) return
    importRunning.current = true
    try {
      const filePath = await api.clubs.pickImportFile()
      if (!filePath) return
      setImportState({ open: true, filePath, preview: null })
      try {
        const preview = await api.clubs.previewImport(festivalId, filePath)
        setImportState((s) => (s.filePath === filePath && s.open ? { ...s, preview } : s))
      } catch (err) {
        setImportState((s) => ({ ...s, open: false }))
        toast.error(`„${fileNameOf(filePath)}“ konnte nicht gelesen werden`, { description: errorMessage(err) })
      }
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      importRunning.current = false
    }
  }

  const commitImport = async (): Promise<boolean> => {
    const filePath = importState.filePath
    if (!filePath) return false
    try {
      const result = await api.clubs.commitImport(festivalId, filePath)
      await invalidate()
      setImportState((s) => ({ ...s, open: false }))
      const message = importResultMessage(result)
      toast.success(message.title, { description: message.description })
      return true
    } catch (err) {
      toast.error('Import fehlgeschlagen', { description: errorMessage(err) })
      return false
    }
  }

  const exportTemplate = async (prefill: boolean): Promise<boolean> => {
    try {
      const path = await api.clubs.exportTemplate(festivalId, { prefill })
      if (!path) return false
      toast.success('Anmelde-Vorlage gespeichert', {
        description: fileNameOf(path),
        action: { label: 'Im Ordner zeigen', onClick: () => void api.app.showItemInFolder(path) }
      })
      return true
    } catch (err) {
      toast.error('Die Anmelde-Vorlage konnte nicht gespeichert werden', { description: errorMessage(err) })
      return false
    }
  }

  const focusSearch = () => {
    if (anyDialogOpen) return
    const input = searchRef.current
    if (!input) return
    input.focus()
    input.select()
  }

  useMenuAction('clubs.import', startImport)
  useMenuAction('clubs.exportTemplate', () => {
    if (!anyDialogOpen) setExportOpen(true)
  })
  useMenuAction('search.focus', focusSearch)

  const handleSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && query) {
      event.preventDefault()
      setQuery('')
    }
  }

  /* ----------------------------- Ansicht ----------------------------- */

  const hasClubs = clubs.length > 0
  const headerActions = hasClubs ? (
    <>
      <Button variant="outline" onClick={() => void startImport()} aria-keyshortcuts={isMac ? 'Meta+I' : 'Control+I'}>
        <FileUp aria-hidden />
        Aus Excel importieren
      </Button>
      <Button variant="outline" onClick={() => setExportOpen(true)}>
        <FileDown aria-hidden />
        Anmelde-Vorlage exportieren
      </Button>
    </>
  ) : null

  return (
    <PageContainer>
      <PageHeader
        title="Vereine"
        description="Vereinsstamm dieses Fests – aus der Anmeldeliste importiert oder einzeln angelegt."
        actions={headerActions}
      />

      {clubsQuery.isLoading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Vereine werden geladen">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : clubsQuery.isError ? (
        <div role="alert" className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
          <p>Die Vereine konnten nicht geladen werden: {errorMessage(clubsQuery.error)}</p>
          <Button variant="outline" size="sm" onClick={() => void clubsQuery.refetch()}>
            Erneut versuchen
          </Button>
        </div>
      ) : !hasClubs ? (
        <EmptyState onImport={() => void startImport()} onExport={() => setExportOpen(true)} onCreate={openCreate} />
      ) : (
        <section className="space-y-3" aria-label="Vereinsliste">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 basis-64">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleSearchKey}
                placeholder="Verein, Name, Ort oder PLZ suchen …"
                aria-label="Vereine durchsuchen"
                aria-keyshortcuts={isMac ? 'Meta+F' : 'Control+F'}
                className="pr-16 pl-9 [&::-webkit-search-cancel-button]:hidden"
                data-testid="club-search"
              />
              {query ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute top-1/2 right-0.5 -translate-y-1/2"
                  onClick={() => {
                    setQuery('')
                    searchRef.current?.focus()
                  }}
                  aria-label="Suche löschen"
                >
                  <X />
                </Button>
              ) : (
                <kbd className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground sm:inline-block">
                  {modKey}F
                </kbd>
              )}
            </div>
            <Button onClick={openCreate}>
              <Plus aria-hidden />
              Verein anlegen
            </Button>
          </div>

          <p className="text-sm text-muted-foreground" aria-live="polite" data-testid="club-summary">
            {query.trim() ? (
              <>
                {formatNumber(visible.length)} von {plural(stats.count, 'Verein', 'Vereinen')}
              </>
            ) : (
              <>
                {plural(stats.count, 'Verein', 'Vereine')} · {plural(stats.persons, 'angemeldete Person', 'angemeldete Personen')}
                {stats.manual > 0 ? ` · ${formatNumber(stats.manual)} manuell` : ''}
                {stats.withInvoice > 0 ? ` · ${formatNumber(stats.withInvoice)} mit Rechnung` : ''}
              </>
            )}
          </p>

          {visible.length > 0 ? (
            <ClubTable
              clubs={visible}
              sort={sort}
              onSortChange={(key) => setSort((s) => toggleSort(s, key))}
              onEdit={openEdit}
              onDelete={(club) => setDeleteState({ open: true, club })}
            />
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center text-sm">
              <p className="text-muted-foreground">
                Keine Vereine für „<span className="text-foreground">{query.trim()}</span>“ gefunden.
              </p>
              <Button variant="outline" size="sm" onClick={() => setQuery('')}>
                Suche zurücksetzen
              </Button>
            </div>
          )}
        </section>
      )}

      <ClubFormDialog
        open={form.open}
        onOpenChange={(open) => setForm((f) => ({ ...f, open }))}
        club={form.club}
        clubs={clubs}
        onSubmit={saveClub}
        session={form.session}
      />
      <DeleteClubDialog
        open={deleteState.open}
        onOpenChange={(open) => setDeleteState((s) => ({ ...s, open }))}
        club={deleteState.club}
        onConfirm={deleteClub}
      />
      <ExportTemplateDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        clubCount={clubs.length}
        onExport={exportTemplate}
      />
      <ImportPreviewDialog
        open={importState.open}
        onOpenChange={(open) => setImportState((s) => ({ ...s, open }))}
        filePath={importState.filePath}
        preview={importState.preview}
        onImport={commitImport}
      />
    </PageContainer>
  )
}

function EmptyState({ onImport, onExport, onCreate }: { onImport: () => void; onExport: () => void; onCreate: () => void }) {
  return (
    <div
      className="flex flex-col items-center gap-4 rounded-xl border border-dashed bg-card/60 px-6 py-8 text-center sm:gap-5 sm:py-14"
      data-testid="clubs-empty"
    >
      <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Users className="size-7" aria-hidden />
      </div>
      <div className="max-w-lg space-y-2">
        <h2 className="text-lg font-semibold">Noch keine Vereine</h2>
        <p className="text-sm text-muted-foreground">
          Importieren Sie die Anmeldeliste als Excel-Datei (.xlsx). Erkannt werden die Spalten Name, Verein, Straße, PLZ,
          Ort und ang. Personen – auch wenn weitere Spalten dabei sind.
        </p>
        <p className="text-sm text-muted-foreground">
          Noch keine Liste? Exportieren Sie die Anmelde-Vorlage, lassen Sie sie z. B. vom Vorstand ausfüllen und
          importieren Sie sie anschließend hier.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button size="lg" onClick={onImport}>
          <FileUp aria-hidden />
          Aus Excel importieren
        </Button>
        <Button size="lg" variant="outline" onClick={onExport}>
          <FileDown aria-hidden />
          Anmelde-Vorlage exportieren
        </Button>
      </div>
      <Button variant="link" onClick={onCreate}>
        <Plus aria-hidden />
        Oder einen Verein einzeln anlegen
      </Button>
    </div>
  )
}
