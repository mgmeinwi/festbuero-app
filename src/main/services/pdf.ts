/**
 * PDF-Erzeugung: Rechnungs-HTML (derselbe Renderer wie die Vorschau) → verstecktes BrowserWindow →
 * `webContents.printToPDF` (A4, ohne Ränder, Hintergründe).
 *
 * Zuständig: Bereich „Abschluss & Druck“.
 *
 * - Das HTML wird als temporäre Datei unter `<userData>/tmp/` geladen (keine riesige data:-URL).
 * - Gewartet wird auf `window.__FESTBUERO_RENDER_DONE__` (Seitenumbruch/Schriften fertig).
 * - Jobs laufen nacheinander (Queue). Beim Beenden werden offene Fenster zerstört.
 * - Das Fenster ist sandboxed, ohne Node, ohne Netzwerkzugriff (eigene In-Memory-Session).
 * - Tests: `FESTBUERO_FAKE_PDF_FAIL=1` simuliert einen Fehler (wird bei jedem Aufruf neu gelesen).
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { BrowserWindow, session, type Session } from 'electron'
import { invoiceToRenderData, renderInvoiceHtml } from '@shared/invoice-render'
import type { Invoice, InvoiceRenderData, TemplateConfig } from '@shared/types'
import { getLogosDir, getUserDataDir } from '../env'
import { isShuttingDown, registerShutdownHook } from '../lifecycle'

/** Wartezeit auf `__FESTBUERO_RENDER_DONE__` */
export const RENDER_TIMEOUT_MS = 20_000
const POLL_INTERVAL_MS = 50
/** A4 bei 96 dpi */
const A4_WIDTH_PX = 794
const A4_HEIGHT_PX = 1123

/** Simulierter PDF-Fehler (Tests)? */
export function isFakePdfFail(): boolean {
  return process.env.FESTBUERO_FAKE_PDF_FAIL === '1'
}

let staleCleanupDone = false

/** Ordner für temporäre Dateien (Render-HTML, Testseiten-PDF). Räumt beim ersten Zugriff Reste alter Läufe auf. */
export function getTempDir(): string {
  const dir = join(getUserDataDir(), 'tmp')
  mkdirSync(dir, { recursive: true })
  if (!staleCleanupDone) {
    staleCleanupDone = true
    try {
      for (const name of readdirSync(dir)) {
        if (/^render-.*\.html$/.test(name)) unlinkSync(join(dir, name))
      }
    } catch {
      // ignorieren
    }
  }
  return dir
}

export function tempFileName(prefix: string, ext: string): string {
  return `${prefix}-${Date.now()}-${randomBytes(4).toString('hex')}${ext}`
}

/* ------------------------------------------------------------------ */
/* Logo & HTML                                                         */
/* ------------------------------------------------------------------ */

const LOGO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
}

/**
 * Logo aus `<userData>/logos/` als data:-URL; null, wenn keine Datei angegeben ist oder sie fehlt.
 * Nur reine Dateinamen werden akzeptiert (kein Pfad außerhalb des Logo-Ordners).
 */
export function loadLogoDataUrl(logoFile: string | null | undefined, logosDir: string = getLogosDir()): string | null {
  if (!logoFile || basename(logoFile) !== logoFile) return null
  const mime = LOGO_MIME[extname(logoFile).toLowerCase()]
  if (!mime) return null
  const path = join(logosDir, logoFile)
  try {
    if (!existsSync(path)) return null
    return `data:${mime};base64,${readFileSync(path).toString('base64')}`
  } catch {
    return null
  }
}

/** HTML einer abgeschlossenen Rechnung – ausschließlich aus ihrem Snapshot. */
export function buildInvoiceHtml(invoice: Invoice, logoDataUrl: string | null = loadLogoDataUrl(invoice.logoFile)): string {
  return renderInvoiceHtml({ data: invoiceToRenderData(invoice), template: invoice.template, logoDataUrl })
}

/** HTML beliebiger Render-Daten (z. B. Testseite). */
export function buildHtml(data: InvoiceRenderData, template: TemplateConfig, logoDataUrl: string | null): string {
  return renderInvoiceHtml({ data, template, logoDataUrl })
}

/* ------------------------------------------------------------------ */
/* HTML → PDF                                                          */
/* ------------------------------------------------------------------ */

const openWindows = new Set<BrowserWindow>()
let queue: Promise<unknown> = Promise.resolve()
let hookRegistered = false
let pdfSession: Session | null = null

function ensureShutdownHook(): void {
  if (hookRegistered) return
  hookRegistered = true
  registerShutdownHook('pdf-windows', () => {
    for (const win of openWindows) {
      try {
        if (!win.isDestroyed()) win.destroy()
      } catch {
        // ignorieren
      }
    }
    openWindows.clear()
  })
}

/** Eigene In-Memory-Session ohne Netzwerkzugriff (die App ist offline, das PDF soll es auch sein). */
function getPdfSession(): Session {
  if (pdfSession) return pdfSession
  const ses = session.fromPartition('festbuero-pdf', { cache: false })
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) =>
    callback({ cancel: true })
  )
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  pdfSession = ses
  return ses
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForRenderDone(win: BrowserWindow, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (win.isDestroyed()) throw new Error('Das PDF-Fenster wurde unerwartet geschlossen.')
    const done = (await win.webContents.executeJavaScript('window.__FESTBUERO_RENDER_DONE__ === true', true)) as boolean
    if (done) return
    if (Date.now() > deadline) {
      throw new Error('Zeitüberschreitung beim Aufbereiten der Rechnung für das PDF.')
    }
    await delay(POLL_INTERVAL_MS)
  }
}

async function runPdfJob(html: string, timeoutMs: number): Promise<Buffer> {
  if (isShuttingDown()) throw new Error('Die App wird gerade beendet – das PDF wurde nicht erzeugt.')
  if (isFakePdfFail()) throw new Error('Simulierter Fehler bei der PDF-Erzeugung (Test).')
  ensureShutdownHook()

  const htmlPath = join(getTempDir(), tempFileName('render', '.html'))
  writeFileSync(htmlPath, html, 'utf8')
  let win: BrowserWindow | null = null
  try {
    win = new BrowserWindow({
      show: false,
      width: A4_WIDTH_PX,
      height: A4_HEIGHT_PX,
      useContentSize: true,
      paintWhenInitiallyHidden: true,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: true,
        spellcheck: false,
        backgroundThrottling: false,
        session: getPdfSession()
      }
    })
    openWindows.add(win)
    const current = win
    current.on('closed', () => openWindows.delete(current))
    current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    current.webContents.on('will-navigate', (event) => event.preventDefault())

    await current.loadFile(htmlPath)
    await waitForRenderDone(current, timeoutMs)
    const pdf = await current.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      // entspricht marginType 'none' (Ränder kommen ausschließlich aus der Vorlage)
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      preferCSSPageSize: true
    })
    if (!pdf || pdf.length === 0) throw new Error('Das PDF ist leer.')
    return pdf
  } finally {
    if (win && !win.isDestroyed()) {
      openWindows.delete(win)
      win.destroy()
    }
    try {
      unlinkSync(htmlPath)
    } catch {
      // ignorieren
    }
  }
}

/**
 * Rendert ein vollständiges HTML-Dokument zu einem A4-PDF. Aufrufe werden serialisiert.
 * Fehler kommen als `Error` mit deutscher Meldung.
 */
export function renderHtmlToPdf(html: string, opts: { timeoutMs?: number } = {}): Promise<Buffer> {
  const job = queue.then(() => runPdfJob(html, opts.timeoutMs ?? RENDER_TIMEOUT_MS))
  queue = job.catch(() => undefined)
  return job.catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(message.startsWith('PDF') ? message : `PDF konnte nicht erzeugt werden: ${message}`)
  })
}
