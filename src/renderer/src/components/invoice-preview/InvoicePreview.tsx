/**
 * A4-Rechnungsvorschau: zeigt `renderInvoiceHtml(...)` in einem sandboxed iframe (srcdoc, nur `allow-scripts`),
 * skaliert auf die verfügbare Breite. Genutzt von Festbüro-Maske, Vorlagen-Editor und Rechnungsliste.
 *
 * - Alle Seiten stehen untereinander (Abstand + Schatten); die Seitenflächen zeichnet diese Komponente,
 *   das iframe liegt transparent darüber.
 * - Updates werden entprellt (120 ms) und doppelt gepuffert: Das neue Dokument rendert unsichtbar im
 *   zweiten iframe und wird erst nach „festbuero:rendered“ sichtbar → kein Flackern, kein Scroll-Sprung.
 * - `data-testid="invoice-preview"` mit `data-rendered="true"`, sobald das aktuelle Dokument sichtbar ist
 *   (Screenshots/Tests warten darauf), außerdem `data-pages`.
 *
 * Props bleiben stabil: `{ data, template, logoDataUrl, className? }`.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { LAYOUT_MM, renderInvoiceHtml, type RenderedMessage } from '@shared/invoice-render'
import type { InvoiceRenderData, TemplateConfig } from '@shared/types'
import { cn } from '@/lib/utils'

export interface InvoicePreviewProps {
  data: InvoiceRenderData
  template: TemplateConfig
  logoDataUrl: string | null
  className?: string
}

const PX_PER_MM = 96 / 25.4
/** A4-Breite/-Höhe und Seitenabstand in CSS-Pixeln (96 dpi). */
const A4_WIDTH_PX = LAYOUT_MM.pageWidth * PX_PER_MM
const A4_HEIGHT_PX = LAYOUT_MM.pageHeight * PX_PER_MM
const PAGE_GAP_PX = LAYOUT_MM.screenPageGap * PX_PER_MM
/** Entprellung der Aktualisierungen */
const UPDATE_DELAY_MS = 120

let renderCounter = 0

function errorDocument(message: string): string {
  return `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff;font-family:sans-serif;padding:24px;color:#b91c1c">Vorschau fehlgeschlagen: ${message.replace(/&/g, '&amp;').replace(/</g, '&lt;')}<script>parent.postMessage({type:'festbuero:rendered',height:${Math.round(A4_HEIGHT_PX)},pages:1,renderId:document.documentElement.getAttribute('data-render-id')},'*')</script></body>`
}

/** Versieht das Dokument mit einer Render-ID (Zuordnung der „gerendert“-Meldung). */
function withRenderId(html: string, id: string): string {
  if (/<html\b/i.test(html)) return html.replace(/<html\b/i, `<html data-render-id="${id}"`)
  return `<html data-render-id="${id}">${html}</html>`
}

interface Slot {
  /** Original-HTML (ohne Render-ID) */
  html: string | null
  /** srcdoc inkl. Render-ID */
  srcDoc: string | null
  id: string | null
}

interface Shown {
  html: string
  height: number
  pages: number
}

interface RenderedSlot {
  id: string
  height: number
  pages: number
}

function pageHeightTotal(pages: number): number {
  return pages * A4_HEIGHT_PX + Math.max(0, pages - 1) * PAGE_GAP_PX
}

export function InvoicePreview({ data, template, logoDataUrl, className }: InvoicePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const frameRefs = [useRef<HTMLIFrameElement>(null), useRef<HTMLIFrameElement>(null)] as const
  const [width, setWidth] = useState(0)

  const html = useMemo(() => {
    try {
      return renderInvoiceHtml({ data, template, logoDataUrl })
    } catch (err) {
      return errorDocument(err instanceof Error ? err.message : String(err))
    }
  }, [data, template, logoDataUrl])

  /** HTML, das in den (unsichtbaren) Puffer geladen werden soll – entprellt */
  const [target, setTarget] = useState(html)
  const firstRef = useRef(true)
  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false
      setTarget(html)
      return
    }
    const timer = setTimeout(() => setTarget(html), UPDATE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [html])

  const [slots, setSlots] = useState<[Slot, Slot]>(() => {
    const id = `r${++renderCounter}`
    return [
      { html, srcDoc: withRenderId(html, id), id },
      { html: null, srcDoc: null, id: null }
    ]
  })
  const [active, setActive] = useState<0 | 1>(0)
  const [shown, setShown] = useState<Shown | null>(null)

  const slotsRef = useRef(slots)
  const activeRef = useRef(active)
  const targetRef = useRef(target)
  const shownRef = useRef(shown)
  useLayoutEffect(() => {
    slotsRef.current = slots
    activeRef.current = active
    targetRef.current = target
    shownRef.current = shown
  }, [slots, active, target, shown])

  /** Ergebnis der letzten „gerendert“-Meldung je Puffer (auch wenn er nicht sichtbar wurde) */
  const metricsRef = useRef<[RenderedSlot | null, RenderedSlot | null]>([null, null])

  // Neues Ziel in den Hintergrund-Puffer laden (falls nicht schon sichtbar bzw. geladen)
  useEffect(() => {
    const current = slotsRef.current
    const a = activeRef.current
    if (current[a].html === target) return // sichtbar bzw. erster Durchlauf lädt noch
    const back: 0 | 1 = a === 0 ? 1 : 0
    if (current[back].html === target) {
      // liegt schon im Hintergrund-Puffer: fertig → sofort zeigen, sonst kommt die Meldung noch
      const m = metricsRef.current[back]
      if (m && m.id === current[back].id) {
        setActive(back)
        setShown({ html: target, height: m.height, pages: m.pages })
      }
      return
    }
    const id = `r${++renderCounter}`
    setSlots((prev) => {
      const next: [Slot, Slot] = [prev[0], prev[1]]
      next[back] = { html: target, srcDoc: withRenderId(target, id), id }
      return next
    })
  }, [target])

  // „gerendert“-Meldungen der iframes (Listener steht, bevor die iframes laden)
  useLayoutEffect(() => {
    function onMessage(event: MessageEvent) {
      const index = frameRefs.findIndex((r) => r.current && event.source === r.current.contentWindow)
      if (index < 0) return
      const msg = event.data as Partial<RenderedMessage> | null
      if (!msg || msg.type !== 'festbuero:rendered') return
      const slot = slotsRef.current[index as 0 | 1]
      if (!slot.html || !slot.id || (msg.renderId ?? null) !== slot.id) return // veraltete Meldung
      const pages = typeof msg.pages === 'number' && msg.pages > 0 ? Math.floor(msg.pages) : 1
      const height = Math.max(pageHeightTotal(pages), typeof msg.height === 'number' ? msg.height : 0)
      metricsRef.current[index as 0 | 1] = { id: slot.id, height, pages }
      // überholt: inzwischen gibt es ein neueres Ziel (der sichtbare Stand bleibt stehen)
      if (slot.html !== targetRef.current && shownRef.current) return
      setActive(index as 0 | 1)
      setShown({ html: slot.html, height, pages })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, []) // frameRefs/slotsRef/targetRef sind stabile Refs

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect.width ?? 0)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const scale = width > 0 ? width / A4_WIDTH_PX : 0
  const pages = shown?.pages ?? 1
  const docHeight = shown?.height ?? A4_HEIGHT_PX
  const rendered = shown !== null && shown.html === html

  return (
    <div
      ref={containerRef}
      className={cn('w-full', className)}
      data-testid="invoice-preview"
      data-rendered={rendered ? 'true' : 'false'}
      data-pages={pages}
    >
      <div
        className="relative"
        style={{ height: scale > 0 ? docHeight * scale : undefined, aspectRatio: scale > 0 ? undefined : '210 / 297' }}
      >
        {/* Seitenflächen mit Schatten (das iframe darüber ist transparent) */}
        {Array.from({ length: pages }, (_, i) => (
          <div
            key={i}
            aria-hidden
            className="absolute inset-x-0 rounded-[2px] bg-white shadow-md ring-1 ring-black/10 dark:ring-white/10"
            style={{ top: i * (A4_HEIGHT_PX + PAGE_GAP_PX) * scale, height: A4_HEIGHT_PX * scale }}
          />
        ))}
        {slots.map((slot, i) =>
          slot.srcDoc ? (
            <iframe
              key={i}
              ref={frameRefs[i]}
              title={i === active ? 'Rechnungsvorschau' : 'Rechnungsvorschau (wird aktualisiert)'}
              aria-hidden={i === active ? undefined : true}
              sandbox="allow-scripts"
              srcDoc={slot.srcDoc}
              tabIndex={-1}
              className="absolute top-0 left-0"
              style={{
                width: A4_WIDTH_PX,
                height: i === active ? docHeight : Math.max(docHeight, A4_HEIGHT_PX),
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                border: 0,
                display: 'block',
                background: 'transparent',
                // gleiche Farbschema-Angabe wie das Dokument → iframe bleibt durchsichtig (Dunkelmodus)
                colorScheme: 'light',
                pointerEvents: 'none',
                opacity: i === active && shown ? 1 : 0,
                zIndex: i === active ? 1 : 0
              }}
            />
          ) : null
        )}
      </div>
    </div>
  )
}
