/**
 * A4-Rechnungsvorschau: zeigt `renderInvoiceHtml(...)` in einem sandboxed iframe (srcdoc), auf die
 * verfügbare Breite skaliert. Genutzt von Festbüro-Maske, Vorlagen-Editor und Rechnungsliste.
 *
 * STUB des Bereichs „Basis“ – der Bereich „Vorlage“ darf die Umsetzung ersetzen; die Props bleiben.
 * Das gerenderte Dokument meldet seine Höhe per `postMessage({ type: 'festbuero:rendered', height })`.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { renderInvoiceHtml, type RenderedMessage } from '@shared/invoice-render'
import type { InvoiceRenderData, TemplateConfig } from '@shared/types'
import { cn } from '@/lib/utils'

export interface InvoicePreviewProps {
  data: InvoiceRenderData
  template: TemplateConfig
  logoDataUrl: string | null
  className?: string
}

/** A4-Breite/-Höhe in CSS-Pixeln (96 dpi). */
const A4_WIDTH_PX = (210 / 25.4) * 96
const A4_HEIGHT_PX = (297 / 25.4) * 96

export function InvoicePreview({ data, template, logoDataUrl, className }: InvoicePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [width, setWidth] = useState(0)
  const [docHeight, setDocHeight] = useState(A4_HEIGHT_PX)
  /** HTML, für das zuletzt „festbuero:rendered“ gemeldet wurde (data-rendered für Tests/Screenshots) */
  const [renderedHtml, setRenderedHtml] = useState<string | null>(null)
  const htmlRef = useRef<string>('')

  const html = useMemo(() => {
    try {
      return renderInvoiceHtml({ data, template, logoDataUrl })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:24px;color:#b91c1c">Vorschau fehlgeschlagen: ${message.replace(/</g, '&lt;')}</body>`
    }
  }, [data, template, logoDataUrl])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      setWidth(w)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    htmlRef.current = html
  }, [html])
  const rendered = renderedHtml === html

  // useLayoutEffect: Listener steht, bevor das iframe (asynchron) geladen ist – sonst ginge die
  // „gerendert“-Meldung eines schnellen Dokuments verloren.
  useLayoutEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return
      const msg = event.data as Partial<RenderedMessage> | null
      if (msg && msg.type === 'festbuero:rendered' && typeof msg.height === 'number' && msg.height > 0) {
        setDocHeight(Math.max(A4_HEIGHT_PX, msg.height))
        setRenderedHtml(htmlRef.current)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const scale = width > 0 ? width / A4_WIDTH_PX : 0

  return (
    <div
      ref={containerRef}
      className={cn('w-full', className)}
      data-testid="invoice-preview"
      data-rendered={rendered ? 'true' : 'false'}
    >
      <div
        className="relative overflow-hidden rounded-sm bg-white shadow-md ring-1 ring-black/10"
        style={{ height: scale > 0 ? docHeight * scale : undefined, aspectRatio: scale > 0 ? undefined : '210 / 297' }}
      >
        <iframe
          ref={iframeRef}
          title="Rechnungsvorschau"
          sandbox="allow-scripts"
          srcDoc={html}
          tabIndex={-1}
          style={{
            width: A4_WIDTH_PX,
            height: docHeight,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            border: 0,
            display: 'block',
            visibility: scale > 0 ? 'visible' : 'hidden'
          }}
        />
      </div>
    </div>
  )
}
