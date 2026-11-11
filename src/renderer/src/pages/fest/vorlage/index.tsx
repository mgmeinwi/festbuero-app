/**
 * Route: /fest/vorlage – Vorlagen-Editor. Zuständig: Bereich „Vorlage“.
 *
 * Aufbau (responsiv laut architecture.md §10):
 * - ≥ xl: Blockliste | Editor des gewählten Blocks | Live-Vorschau
 * - lg–xl: Blockliste | Editor, Vorschau per Umschalter als Sheet
 * - < lg: Blockauswahl (Auswahlfeld) über dem Editor, Vorschau als Sheet
 *
 * Änderungen wirken sofort in der Vorschau und werden entprellt automatisch gespeichert
 * („Gespeichert“-Anzeige, Fehler als Toast). Menüaktion `preview.toggle` (⌥⌘P) blendet die Vorschau ein/aus.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Eye, EyeOff, Loader2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { buildSampleRenderData } from '@shared/invoice-render/sample-data'
import type { PaymentMethod, Template, TemplateConfig } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { useActiveFestival } from '@/hooks/use-active-festival'
import { useBreakpoint } from '@/hooks/use-media-query'
import { queryKeys } from '@/hooks/query-keys'
import { api } from '@/lib/api'
import { useMenuAction } from '@/lib/menu-actions'
import { cn, errorMessage } from '@/lib/utils'
import { BlockEditor, type Mutator } from './BlockEditor'
import { BlockList, BlockPicker } from './BlockList'
import type { BlockKey } from './blocks'
import { ConfirmDialog, type ConfirmRequest } from './ConfirmDialog'
import { PreviewControls, PreviewDocument, type PreviewOptions } from './PreviewPane'

type SaveStatus = 'saved' | 'pending' | 'saving' | 'error'
const SAVE_DELAY_MS = 500

function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry(): void }) {
  return (
    <div role="status" aria-live="polite" className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" data-testid="vorlage-save-status" data-status={status}>
      {status === 'saved' ? (
        <>
          <Check className="size-3.5 text-success" aria-hidden />
          <span>Gespeichert</span>
        </>
      ) : status === 'error' ? (
        <>
          <AlertTriangle className="size-3.5 text-destructive" aria-hidden />
          <span className="truncate">Nicht gespeichert</span>
          <Button type="button" variant="link" size="sm" className="h-auto px-1 py-0 text-xs" onClick={onRetry}>
            Erneut versuchen
          </Button>
        </>
      ) : (
        <>
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          <span>Speichert …</span>
        </>
      )}
    </div>
  )
}

export default function FestVorlagePage() {
  const { festival, festivalId } = useActiveFestival()
  const queryClient = useQueryClient()
  const isXl = useBreakpoint('xl')
  const isLg = useBreakpoint('lg')

  const templateQuery = useQuery<Template>({
    queryKey: queryKeys.template(festivalId),
    queryFn: () => api.templates.get(festivalId!),
    enabled: festivalId !== null
  })
  const paymentQuery = useQuery<PaymentMethod[]>({
    queryKey: queryKeys.paymentMethods(festivalId),
    queryFn: () => api.paymentMethods.list(festivalId!),
    enabled: festivalId !== null
  })
  const logoFile = templateQuery.data?.logoFile ?? null
  const logoQuery = useQuery<string | null>({
    queryKey: ['templateLogo', logoFile],
    queryFn: () => api.templates.getLogoDataUrl(logoFile!),
    enabled: logoFile !== null,
    staleTime: Infinity
  })
  const logoDataUrl = logoFile ? (logoQuery.data ?? null) : null

  /* ---------------- Entwurf + automatisches Speichern ---------------- */

  const [draft, setDraft] = useState<{ festivalId: number; config: TemplateConfig } | null>(null)
  const [status, setStatus] = useState<SaveStatus>('saved')
  const pendingRef = useRef<{ festivalId: number; config: TemplateConfig } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const saveSeqRef = useRef(0)

  // Entwurf aus der gespeicherten Vorlage übernehmen (beim ersten Laden und bei Festwechsel)
  useEffect(() => {
    const t = templateQuery.data
    if (!t || festivalId === null || t.festivalId !== festivalId) return
    setDraft((prev) => (prev && prev.festivalId === festivalId ? prev : { festivalId, config: t.config }))
  }, [templateQuery.data, festivalId])

  const flush = useCallback(async () => {
    clearTimeout(timerRef.current)
    const job = pendingRef.current
    if (!job) return
    pendingRef.current = null
    const seq = ++saveSeqRef.current
    setStatus('saving')
    try {
      const saved = await api.templates.update(job.festivalId, job.config)
      queryClient.setQueryData(queryKeys.template(job.festivalId), saved)
      if (seq === saveSeqRef.current && !pendingRef.current) setStatus('saved')
    } catch (err) {
      if (!pendingRef.current) pendingRef.current = job
      if (seq === saveSeqRef.current) setStatus('error')
      toast.error(`Vorlage nicht gespeichert: ${errorMessage(err)}`, { id: 'vorlage-save-error' })
    }
  }, [queryClient])

  // Ausstehende Änderungen beim Verlassen der Seite bzw. Festwechsel sofort speichern
  useEffect(() => {
    return () => {
      void flush()
    }
  }, [flush, festivalId])

  const update = useCallback(
    (mutate: Mutator) => {
      setDraft((prev) => {
        if (!prev) return prev
        const config = structuredClone(prev.config)
        mutate(config)
        pendingRef.current = { festivalId: prev.festivalId, config }
        return { festivalId: prev.festivalId, config }
      })
      setStatus('pending')
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => void flush(), SAVE_DELAY_MS)
    },
    [flush]
  )

  /* ---------------- Aktionen ---------------- */

  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null)
  const [logoBusy, setLogoBusy] = useState(false)

  const applyServerTemplate = useCallback(
    (t: Template, opts: { replaceDraft?: boolean } = {}) => {
      queryClient.setQueryData(queryKeys.template(t.festivalId), t)
      setDraft((prev) => {
        if (opts.replaceDraft || !prev || prev.festivalId !== t.festivalId) return { festivalId: t.festivalId, config: t.config }
        return { ...prev, config: { ...prev.config, logo: { ...prev.config.logo, enabled: t.config.logo.enabled } } }
      })
    },
    [queryClient]
  )

  const uploadLogo = useCallback(async () => {
    if (festivalId === null) return
    try {
      const path = await api.templates.pickLogo()
      if (!path) return
      setLogoBusy(true)
      await flush()
      const t = await api.templates.setLogo(festivalId, path)
      applyServerTemplate(t)
      toast.success('Logo übernommen.')
    } catch (err) {
      toast.error(`Logo konnte nicht übernommen werden: ${errorMessage(err)}`)
    } finally {
      setLogoBusy(false)
    }
  }, [festivalId, flush, applyServerTemplate])

  const removeLogo = useCallback(() => {
    if (festivalId === null) return
    setConfirmRequest({
      title: 'Logo entfernen?',
      description: 'Das Logo wird nicht mehr auf neuen Rechnungen gedruckt. Bereits abgeschlossene Rechnungen behalten ihr Logo.',
      confirmLabel: 'Logo entfernen',
      onConfirm: async () => {
        setLogoBusy(true)
        try {
          const t = await api.templates.setLogo(festivalId, null)
          applyServerTemplate(t)
          toast.success('Logo entfernt.')
        } catch (err) {
          toast.error(`Logo konnte nicht entfernt werden: ${errorMessage(err)}`)
        } finally {
          setLogoBusy(false)
        }
      }
    })
  }, [festivalId, applyServerTemplate])

  const resetToDefault = useCallback(() => {
    if (festivalId === null) return
    setConfirmRequest({
      title: 'Vorlage zurücksetzen?',
      description:
        'Alle Blöcke, Texte, Schrift, Tabelle und Fußzeile werden auf die Beispielvorlage zurückgesetzt. Das Logo bleibt erhalten. Bereits abgeschlossene Rechnungen ändern sich nicht.',
      confirmLabel: 'Zurücksetzen',
      onConfirm: async () => {
        clearTimeout(timerRef.current)
        pendingRef.current = null
        try {
          const t = await api.templates.resetToDefault(festivalId)
          applyServerTemplate(t, { replaceDraft: true })
          setStatus('saved')
          toast.success('Vorlage auf Standard zurückgesetzt.')
        } catch (err) {
          toast.error(`Zurücksetzen fehlgeschlagen: ${errorMessage(err)}`)
        }
      }
    })
  }, [festivalId, applyServerTemplate])

  /* ---------------- Auswahl & Vorschau ---------------- */

  const [selected, setSelected] = useState<BlockKey>('general')
  const editorScrollRef = useRef<HTMLElement>(null)
  // Beim Blockwechsel oben beginnen
  useEffect(() => {
    editorScrollRef.current?.scrollTo({ top: 0 })
  }, [selected])
  const [previewOptions, setPreviewOptions] = useState<PreviewOptions>({ kind: 'rechnung', payment: 'bar', long: false })
  const [previewOpen, setPreviewOpen] = useState(false) // Sheet (< xl)
  const [previewHidden, setPreviewHidden] = useState(false) // Spalte (≥ xl)
  useEffect(() => {
    if (isXl) setPreviewOpen(false)
  }, [isXl])

  const togglePreview = useCallback(() => {
    if (isXl) setPreviewHidden((v) => !v)
    else setPreviewOpen((v) => !v)
  }, [isXl])
  useMenuAction('preview.toggle', togglePreview)

  const previewData = useMemo(
    () =>
      buildSampleRenderData({
        festival,
        paymentMethods: paymentQuery.data ?? null,
        paymentKind: previewOptions.payment,
        type: previewOptions.kind,
        lineCount: previewOptions.long ? 40 : undefined
      }),
    [festival, paymentQuery.data, previewOptions]
  )

  const config = draft && draft.festivalId === festivalId ? draft.config : null

  if (templateQuery.isError) {
    return (
      <div className="p-6">
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          Die Vorlage konnte nicht geladen werden: {errorMessage(templateQuery.error)}
        </div>
      </div>
    )
  }

  if (!config || !festival) {
    return (
      <div className="space-y-3 p-6" aria-busy="true">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const showPreviewColumn = isXl && !previewHidden
  const preview = <PreviewDocument data={previewData} template={config} logoDataUrl={config.logo.enabled ? logoDataUrl : null} />

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="vorlage-page">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2 sm:px-4">
        <h1 className="truncate text-lg font-semibold tracking-tight" title="Rechnungsvorlage">
          Rechnungsvorlage
        </h1>
        <SaveIndicator status={status} onRetry={() => void flush()} />
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            type="button"
            variant={isXl ? 'ghost' : 'outline'}
            size="sm"
            onClick={togglePreview}
            aria-pressed={isXl ? !previewHidden : previewOpen}
            data-testid="vorlage-preview-toggle"
            title="Vorschau ein-/ausblenden (⌥⌘P)"
          >
            {isXl && !previewHidden ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
            <span>{isXl && !previewHidden ? 'Vorschau ausblenden' : 'Vorschau'}</span>
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={resetToDefault} aria-label="Auf Standard zurücksetzen" title="Auf Standard zurücksetzen">
            <RotateCcw aria-hidden />
            <span className="hidden md:inline">Auf Standard zurücksetzen</span>
          </Button>
        </div>
      </div>

      <div
        className={cn(
          'grid min-h-0 flex-1',
          showPreviewColumn
            ? 'grid-cols-[13.5rem_minmax(0,1fr)_minmax(20rem,0.9fr)]'
            : isLg
              ? 'grid-cols-[13.5rem_minmax(0,1fr)]'
              : 'grid-cols-1'
        )}
      >
        {isLg ? (
          <aside className="min-h-0 overflow-y-auto border-r bg-muted/20">
            <BlockList selected={selected} onSelect={setSelected} config={config} />
          </aside>
        ) : null}

        <main ref={editorScrollRef} className="min-h-0 min-w-0 overflow-y-auto" aria-label="Block bearbeiten">
          {!isLg ? (
            <div className="sticky top-0 z-10 border-b bg-background/95 px-3 py-2 backdrop-blur">
              <BlockPicker selected={selected} onSelect={setSelected} />
            </div>
          ) : null}
          <div className="mx-auto w-full max-w-3xl p-3 sm:p-4">
            <BlockEditor
              block={selected}
              config={config}
              update={update}
              festival={festival}
              paymentMethods={paymentQuery.data}
              logo={{ file: logoFile, dataUrl: logoDataUrl, busy: logoBusy, onUpload: () => void uploadLogo(), onRemove: removeLogo }}
              confirm={setConfirmRequest}
            />
          </div>
        </main>

        {showPreviewColumn ? (
          <section className="flex min-h-0 min-w-0 flex-col border-l bg-muted/40" aria-label="Vorschau" data-testid="vorlage-preview-pane">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-background/60 px-3 py-2">
              <span className="text-sm font-medium">Vorschau</span>
              <PreviewControls options={previewOptions} onChange={setPreviewOptions} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">{preview}</div>
          </section>
        ) : null}
      </div>

      {!isXl ? (
        <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
          <SheetContent side="right" className="w-[min(44rem,94vw)] gap-0 p-0 sm:max-w-none" data-testid="vorlage-preview-sheet">
            <SheetHeader className="border-b px-4 py-3 pr-12">
              <SheetTitle>Vorschau</SheetTitle>
              <SheetDescription className="sr-only">Live-Vorschau der Rechnung mit Beispieldaten</SheetDescription>
              <PreviewControls options={previewOptions} onChange={setPreviewOptions} className="pt-1" />
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto bg-muted/40 p-3 sm:p-4">{preview}</div>
          </SheetContent>
        </Sheet>
      ) : null}

      <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </div>
  )
}
