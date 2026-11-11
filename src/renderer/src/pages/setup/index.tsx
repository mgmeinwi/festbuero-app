/**
 * Route: /setup – Ersteinrichtungs-Assistent (Bereich „Setup & Auslieferung“).
 *
 * Erscheint, solange `setupCompleted === false` (SetupGuard in App.tsx), und lässt sich über das
 * Menü bzw. die App-Einstellungen erneut öffnen. Schritte: Willkommen → Dokumentenordner → Drucker →
 * erstes Gründungsfest → Fertig. Komplett per Tastatur bedienbar (Enter = weiter, Tab, Pfeiltasten).
 */
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ReceiptText, X } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { WindowDragBar } from '@/components/layout/WindowDragBar'
import { Button } from '@/components/ui/button'
import { useAppSettings } from '@/hooks/use-app-settings'
import { useDefaultDocumentsDir } from '../einstellungen/actions'
import { DocumentsStep } from './DocumentsStep'
import { DoneStep } from './DoneStep'
import { FestivalStep } from './FestivalStep'
import { PrinterStep } from './PrinterStep'
import { WelcomeStep } from './WelcomeStep'
import { StepProgress, WIZARD_STEPS, WizardContext } from './wizard'

/** Enter löst die Hauptaktion aus – außer auf Buttons/Links (eigene Aktion) und in Eingabefeldern (Formular). */
function shouldHandleEnter(event: KeyboardEvent): boolean {
  if (event.key !== 'Enter' || event.isComposing) return false
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false
  const target = event.target instanceof HTMLElement ? event.target : null
  if (!target) return true
  if (target.closest('[role="dialog"], [role="menu"], [role="listbox"], [data-sonner-toaster]')) return false
  if (target.matches('input, textarea, select, [contenteditable="true"]')) return false
  if (target.getAttribute('role') === 'radio') return true
  if (target.closest('button, a[href], [role="button"], [role="link"], [role="combobox"]')) return false
  return true
}

export default function SetupPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { settings } = useAppSettings()
  const { data: suggestion } = useDefaultDocumentsDir()

  const [step, setStep] = useState(0)
  const [documentsDir, setDocumentsDir] = useState<string | null>(null)
  const [printer, setPrinter] = useState<string | null | undefined>(undefined)
  const [actionsEl, setActionsEl] = useState<HTMLElement | null>(null)
  const primaryRef = useRef<(() => void) | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // bereits eingerichtet (Assistent erneut geöffnet) → gespeicherte Werte als Ausgangspunkt
  const reopened = settings?.setupCompleted === true
  const currentDir = documentsDir ?? settings?.documentsDir ?? null

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!shouldHandleEnter(event) || !primaryRef.current) return
      event.preventDefault()
      primaryRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [step])

  const goTo = (index: number) => setStep(Math.max(0, Math.min(WIZARD_STEPS.length - 1, index)))
  const next = () => goTo(step + 1)

  function close() {
    if (location.key !== 'default') void navigate(-1)
    else void navigate('/einstellungen', { replace: true })
  }

  const stepId = WIZARD_STEPS[step]!.id

  return (
    <WizardContext.Provider value={{ actionsEl, primaryRef }}>
      <div className="flex h-full min-h-0 flex-col bg-muted/40" data-testid="setup-page">
        <WindowDragBar className="justify-between px-3">
          <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-muted-foreground">
            <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <ReceiptText className="size-3.5" aria-hidden />
            </span>
            <span className="truncate">Festbüro einrichten</span>
          </span>
          {reopened ? (
            <Button variant="ghost" size="sm" onClick={close} data-testid="setup-close">
              <X aria-hidden />
              Schließen
            </Button>
          ) : null}
        </WindowDragBar>

        <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {/* my-auto: bei viel Platz vertikal zentriert, sonst oben beginnend und scrollbar */}
          <div className="mx-auto my-auto flex w-full max-w-2xl flex-col gap-5 px-4 pt-2 pb-6 sm:px-6 sm:pt-4">
            <StepProgress current={step} onSelect={goTo} />
            <main
              className="rounded-xl border bg-card p-4 text-card-foreground shadow-sm sm:p-6"
              data-testid={`setup-step-${stepId}`}
            >
              {stepId === 'welcome' ? <WelcomeStep onNext={next} /> : null}
              {stepId === 'documents' ? (
                <DocumentsStep
                  value={currentDir}
                  suggestion={suggestion}
                  onChange={setDocumentsDir}
                  onDone={next}
                />
              ) : null}
              {stepId === 'printer' ? <PrinterStep value={printer} onChange={setPrinter} onDone={next} /> : null}
              {stepId === 'festival' ? <FestivalStep onDone={next} /> : null}
              {stepId === 'done' ? <DoneStep onEditStep={goTo} /> : null}
            </main>
          </div>
        </div>

        <footer className="shrink-0 border-t bg-background/95">
          <div className="mx-auto flex w-full max-w-2xl items-center gap-2 px-4 py-3 sm:px-6">
            {step > 0 ? (
              <Button variant="outline" onClick={() => goTo(step - 1)} data-testid="setup-back">
                <ArrowLeft aria-hidden />
                Zurück
              </Button>
            ) : null}
            <span className="hidden text-sm text-muted-foreground tabular-nums sm:inline">
              Schritt {step + 1} von {WIZARD_STEPS.length}
            </span>
            <div ref={setActionsEl} className="ml-auto flex items-center gap-2" />
          </div>
        </footer>
      </div>
    </WizardContext.Provider>
  )
}
