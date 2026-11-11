/**
 * Drucker: Liste, Status, stiller Druck eines abgelegten PDFs, Testseite.
 *
 * Zuständig: Bereich „Abschluss & Druck“ (Basisversion von „Basis“: `listPrinters` – Signatur bleibt,
 * das Menü nutzt sie).
 *
 * WICHTIG: Niemals echte Druckaufträge in Entwicklung/Tests senden. Unpaketiert wird IMMER nur
 * simuliert (`isPrintDryRun()` in env.ts): Eintrag in `<userData>/print-dry-run.log`, kein Systemaufruf.
 *
 * - macOS/Linux: CUPS `lp -d <Drucker> -n <Kopien> <datei.pdf>`; vorab Prüfung, ob der Drucker
 *   existiert und nicht deaktiviert ist.
 * - Windows: gebündeltes `SumatraPDF.exe -print-to "<Drucker>" -print-settings "<Kopien>x" -silent "<pdf>"`.
 * - Laufende Kindprozesse werden beim Beenden der App abgebrochen (Shutdown-Hook).
 */
import { execFile, type ChildProcess } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { app } from 'electron'
import { addDays, todayIso } from '@shared/dates'
import { getDefaultTemplateConfig } from '@shared/invoice-render/default-template'
import { getSampleRenderData } from '@shared/invoice-render/sample-data'
import type { PrinterInfo, PrinterStatus, PrintResult, TemplateConfig } from '@shared/types'
import { getDb, nowIso, type Db } from '../db/connection'
import * as repo from '../db/repositories/invoices'
import { getPrintDryRunLogPath, isE2E, isFakePrintFail, isPrintDryRun } from '../env'
import { isShuttingDown, registerShutdownHook } from '../lifecycle'
import { emitToRenderer, getMainWindow, requireMainWindow } from '../window'
import { ensureInvoicePdf, type PdfResult } from './filing'
import { buildHtml, getTempDir, loadLogoDataUrl, renderHtmlToPdf, tempFileName } from './pdf'
import { getSettings } from './settings'

/** Zeitlimit für `lp` (übergibt nur an CUPS, kehrt sofort zurück) */
export const LP_TIMEOUT_MS = 30_000
/** Zeitlimit für SumatraPDF (druckt synchron) */
export const SUMATRA_TIMEOUT_MS = 120_000
/** Prüfintervall für den Druckerstatus */
export const STATUS_POLL_MS = 30_000

export const NO_PRINTER_MESSAGE = 'Kein Drucker ausgewählt. Bitte oben in der Kopfleiste einen Drucker wählen.'

/* ------------------------------------------------------------------ */
/* Druckerliste & Status                                               */
/* ------------------------------------------------------------------ */

function isDefaultPrinter(options: Record<string, unknown> | undefined): boolean {
  if (!options) return false
  for (const key of ['is-default', 'printer-is-default', 'isDefault']) {
    const value = options[key]
    if (value === true || value === 'true' || value === '1') return true
  }
  return false
}

/**
 * Simulierter Drucker, der nur unter Playwright (`FESTBUERO_E2E=1`) zusätzlich in der Liste erscheint.
 * So hängen Tests nicht von den Druckern des Rechners ab (CI hat keine), und `prepareFestival()`
 * kann ihn als Standarddrucker setzen. Gedruckt wird in E2E ohnehin nur per Dry-Run.
 */
export const E2E_TEST_PRINTER = 'E2E-Testdrucker'

function withE2ePrinter(printers: Electron.PrinterInfo[]): Electron.PrinterInfo[] {
  if (!isE2E() || printers.some((p) => p.name === E2E_TEST_PRINTER)) return printers
  const fake = { name: E2E_TEST_PRINTER, displayName: E2E_TEST_PRINTER, description: '', status: 0, isDefault: false, options: {} }
  return [...printers, fake as unknown as Electron.PrinterInfo]
}

/** Installierte Drucker über `webContents.getPrintersAsync()` des Hauptfensters. */
export async function listPrinters(): Promise<PrinterInfo[]> {
  const win = requireMainWindow()
  const printers = withE2ePrinter(await win.webContents.getPrintersAsync())
  return printers
    .map((p) => ({
      name: p.name,
      displayName: p.displayName || p.name,
      isDefault: isDefaultPrinter(p.options as Record<string, unknown> | undefined)
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'de'))
}

/** Rohliste des Systems inkl. Optionen; null, wenn (noch) kein Fenster existiert. */
async function systemPrinters(): Promise<Electron.PrinterInfo[] | null> {
  const win = getMainWindow()
  if (!win) return null
  try {
    return withE2ePrinter(await win.webContents.getPrintersAsync())
  } catch {
    return null
  }
}

/** Ergebnis der Vorabprüfung eines Druckers. */
export type PrinterCheck =
  | { state: 'ok' }
  | { state: 'unknown' }
  | { state: 'not_found'; message: string }
  | { state: 'disabled'; message: string }

export function printerNotFoundMessage(printer: string): string {
  return `Drucker „${printer}“ nicht gefunden. Bitte einen anderen Drucker wählen.`
}

export function printerDisabledMessage(printer: string): string {
  return `Drucker „${printer}“ ist deaktiviert/offline. Bitte den Drucker prüfen oder einen anderen wählen.`
}

/**
 * Wertet die Optionen aus `getPrintersAsync()` aus (CUPS: `printer-state` 5 = gestoppt,
 * `printer-is-accepting-jobs` = false). Windows liefert hier meist keine Zustände → 'unknown'.
 */
export function stateFromOptions(options: Record<string, unknown> | undefined): 'ok' | 'disabled' | 'unknown' {
  if (!options) return 'unknown'
  const state = options['printer-state']
  const accepting = options['printer-is-accepting-jobs']
  if (state === '5' || state === 5 || accepting === 'false' || accepting === false) return 'disabled'
  if (state !== undefined || accepting !== undefined) return 'ok'
  return 'unknown'
}

/** `lpstat -p <name>` (Sprache C) auswerten: „printer X disabled since …“ bzw. „is idle. enabled since …“. */
export function parseLpstat(stdout: string, stderr: string, code: number | null): 'ok' | 'disabled' | 'not_found' | 'unknown' {
  const text = `${stdout}\n${stderr}`
  if (/invalid destination|unknown destination|does not exist|no destinations added/i.test(text)) return 'not_found'
  if (/\bdisabled\b/i.test(stdout)) return 'disabled'
  if (code === 0 && /\b(idle|printing|enabled)\b/i.test(stdout)) return 'ok'
  return 'unknown'
}

/* ------------------------------------------------------------------ */
/* Kindprozesse                                                        */
/* ------------------------------------------------------------------ */

export interface ExecResult {
  code: number | null
  stdout: string
  stderr: string
  /** Startfehler, z. B. ENOENT (Programm nicht gefunden) */
  spawnError?: NodeJS.ErrnoException
  timedOut: boolean
}

export type ExecFn = (file: string, args: string[], options: { timeoutMs: number; env?: NodeJS.ProcessEnv }) => Promise<ExecResult>

const children = new Set<ChildProcess>()
let childHookRegistered = false

function ensureChildHook(): void {
  if (childHookRegistered) return
  childHookRegistered = true
  registerShutdownHook('print-processes', () => {
    for (const child of children) {
      try {
        child.kill()
      } catch {
        // ignorieren
      }
    }
    children.clear()
  })
}

/** Standard-Ausführung über `execFile` (keine Shell, Argumente einzeln). */
export const defaultExec: ExecFn = (file, args, options) =>
  new Promise((resolvePromise) => {
    if (isShuttingDown()) {
      resolvePromise({ code: null, stdout: '', stderr: 'Die App wird beendet.', timedOut: false })
      return
    }
    ensureChildHook()
    const child = execFile(
      file,
      args,
      { timeout: options.timeoutMs, windowsHide: true, encoding: 'utf8', env: options.env ?? process.env, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        children.delete(child)
        const err = error as (NodeJS.ErrnoException & { killed?: boolean; signal?: string; code?: unknown }) | null
        const spawnError = err && typeof err.code === 'string' ? err : undefined
        resolvePromise({
          code: err ? (typeof err.code === 'number' ? err.code : null) : 0,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          ...(spawnError ? { spawnError } : {}),
          timedOut: !!err && err.killed === true && !spawnError
        })
      }
    )
    children.add(child)
  })

/* ------------------------------------------------------------------ */
/* Befehle                                                             */
/* ------------------------------------------------------------------ */

export interface PrintCommand {
  file: string
  args: string[]
  timeoutMs: number
}

/** Pfad zu SumatraPDF: paketiert `resources/win/`, in Entwicklung `<Projekt>/resources/win/`. */
export function resolveSumatraPath(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'win', 'SumatraPDF.exe')
  const candidates = [
    join(app.getAppPath(), 'resources', 'win', 'SumatraPDF.exe'),
    join(process.cwd(), 'resources', 'win', 'SumatraPDF.exe'),
    resolve(__dirname, '..', '..', 'resources', 'win', 'SumatraPDF.exe'),
    resolve(__dirname, '..', '..', '..', 'resources', 'win', 'SumatraPDF.exe')
  ]
  return candidates.find((c) => existsSync(c)) ?? candidates[0]!
}

/** Baut den Druckbefehl für das Betriebssystem (reine Funktion, ohne Ausführung). */
export function buildPrintCommand(
  platform: NodeJS.Platform,
  job: { pdfPath: string; printer: string; copies: number },
  sumatraPath?: string
): PrintCommand {
  const copies = String(job.copies)
  if (platform === 'win32') {
    if (!sumatraPath) throw new Error('Der Pfad zu SumatraPDF fehlt.')
    return {
      file: sumatraPath,
      args: ['-print-to', job.printer, '-print-settings', `${copies}x`, '-silent', job.pdfPath],
      timeoutMs: SUMATRA_TIMEOUT_MS
    }
  }
  return { file: 'lp', args: ['-d', job.printer, '-n', copies, job.pdfPath], timeoutMs: LP_TIMEOUT_MS }
}

/** Übersetzt Fehlerausgaben von `lp`/SumatraPDF in eine deutsche Meldung. */
export function describePrintFailure(printer: string, result: ExecResult, program: string): string {
  if (result.spawnError) {
    if (result.spawnError.code === 'ENOENT') return `Das Druckprogramm „${program}“ wurde nicht gefunden.`
    return `Das Druckprogramm „${program}“ konnte nicht gestartet werden (${result.spawnError.code ?? result.spawnError.message}).`
  }
  if (result.timedOut) return `Zeitüberschreitung beim Drucken auf „${printer}“. Bitte den Drucker prüfen.`
  const text = `${result.stderr}\n${result.stdout}`.trim()
  if (/unknown destination|does not exist|invalid destination|no such printer|printer not found|unbekannte?s? ziel/i.test(text)) {
    return printerNotFoundMessage(printer)
  }
  if (/not accepting jobs|disabled|paused|offline|nimmt keine auftr/i.test(text)) return printerDisabledMessage(printer)
  const detail = text.split(/\r?\n/).find((l) => l.trim() !== '')?.trim()
  return detail
    ? `Druck auf „${printer}“ fehlgeschlagen: ${detail}`
    : `Druck auf „${printer}“ fehlgeschlagen (Rückgabewert ${result.code ?? 'unbekannt'}).`
}

/* ------------------------------------------------------------------ */
/* Drucken                                                             */
/* ------------------------------------------------------------------ */

export interface PrintDeps {
  exec?: ExecFn
  platform?: NodeJS.Platform
  dryRun?: boolean
  fakeFail?: boolean
  /** Druckerliste des Systems inkl. Optionen; null = nicht ermittelbar */
  listSystemPrinters?: () => Promise<Electron.PrinterInfo[] | null>
  sumatraPath?: string
  dryRunLogPath?: string
  now?: () => Date
}

export interface PrintJob {
  pdfPath: string
  printer: string | null | undefined
  copies: number
}

function appendDryRunLog(logPath: string, entry: Record<string, unknown>): void {
  mkdirSync(dirname(logPath), { recursive: true })
  appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8')
}

/** Prüft vorab, ob der Drucker existiert und nicht deaktiviert ist. */
export async function checkPrinter(
  printer: string,
  deps: Pick<PrintDeps, 'exec' | 'platform' | 'listSystemPrinters'> = {}
): Promise<PrinterCheck> {
  const platform = deps.platform ?? process.platform
  const list = await (deps.listSystemPrinters ?? systemPrinters)()
  if (list) {
    const found = list.find((p) => p.name === printer)
    if (!found) return { state: 'not_found', message: printerNotFoundMessage(printer) }
    const state = stateFromOptions(found.options as Record<string, unknown> | undefined)
    if (state === 'disabled') return { state: 'disabled', message: printerDisabledMessage(printer) }
    if (state === 'ok' || platform === 'win32') return { state: state === 'ok' ? 'ok' : 'unknown' }
  } else if (platform === 'win32') {
    return { state: 'unknown' }
  }
  // CUPS: Zustand per lpstat nachfragen (Sprache C, damit die Ausgabe auswertbar ist)
  const exec = deps.exec ?? defaultExec
  const res = await exec('lpstat', ['-p', printer], { timeoutMs: 10_000, env: { ...process.env, LC_ALL: 'C', LANG: 'C' } })
  if (res.spawnError) return { state: 'unknown' }
  const parsed = parseLpstat(res.stdout, res.stderr, res.code)
  if (parsed === 'not_found') return { state: 'not_found', message: printerNotFoundMessage(printer) }
  if (parsed === 'disabled') return { state: 'disabled', message: printerDisabledMessage(printer) }
  return { state: parsed === 'ok' ? 'ok' : 'unknown' }
}

/**
 * Druckt ein abgelegtes PDF still (ohne Dialog). Wirft nicht – Fehler stehen in `PrintResult.error`.
 * Unpaketiert bzw. mit FESTBUERO_PRINT_DRY_RUN=1 wird nur simuliert.
 */
export async function printPdf(job: PrintJob, deps: PrintDeps = {}): Promise<PrintResult> {
  const printer = typeof job.printer === 'string' && job.printer.trim() !== '' ? job.printer : null
  const copies = Number.isInteger(job.copies) && job.copies >= 1 ? job.copies : 1
  const base = { printer, copies }
  if (!printer) return { ok: false, ...base, error: NO_PRINTER_MESSAGE }
  if (!job.pdfPath || !existsSync(job.pdfPath)) {
    return { ok: false, ...base, error: 'Die PDF-Datei für den Druck wurde nicht gefunden.' }
  }

  const dryRun = deps.dryRun ?? isPrintDryRun()
  if (dryRun) {
    const fakeFail = deps.fakeFail ?? isFakePrintFail()
    const error = fakeFail ? `Drucker „${printer}“ antwortet nicht (simulierter Druckfehler).` : undefined
    try {
      appendDryRunLog(deps.dryRunLogPath ?? getPrintDryRunLogPath(), {
        time: (deps.now?.() ?? new Date()).toISOString(),
        file: job.pdfPath,
        printer,
        copies,
        ok: !fakeFail,
        ...(error ? { error } : {})
      })
    } catch (err) {
      console.error('[print] Dry-Run-Protokoll nicht schreibbar:', err)
    }
    return fakeFail ? { ok: false, ...base, dryRun: true, error } : { ok: true, ...base, dryRun: true }
  }

  const platform = deps.platform ?? process.platform
  const exec = deps.exec ?? defaultExec
  try {
    const check = await checkPrinter(printer, { exec, platform, ...(deps.listSystemPrinters ? { listSystemPrinters: deps.listSystemPrinters } : {}) })
    if (check.state === 'not_found' || check.state === 'disabled') return { ok: false, ...base, error: check.message }

    let sumatraPath: string | undefined
    if (platform === 'win32') {
      sumatraPath = deps.sumatraPath ?? resolveSumatraPath()
      if (!existsSync(sumatraPath)) {
        return {
          ok: false,
          ...base,
          error: `SumatraPDF wurde nicht gefunden (${sumatraPath}). Ohne SumatraPDF ist unter Windows kein stiller Druck möglich – bitte die App neu installieren.`
        }
      }
    }
    const cmd = buildPrintCommand(platform, { pdfPath: job.pdfPath, printer, copies }, sumatraPath)
    const result = await exec(cmd.file, cmd.args, { timeoutMs: cmd.timeoutMs })
    if (result.code === 0 && !result.spawnError && !result.timedOut) return { ok: true, ...base }
    return { ok: false, ...base, error: describePrintFailure(printer, result, platform === 'win32' ? 'SumatraPDF' : 'lp') }
  } catch (err) {
    return { ok: false, ...base, error: `Druck auf „${printer}“ fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/* ------------------------------------------------------------------ */
/* Belege drucken                                                      */
/* ------------------------------------------------------------------ */

/** Drucker für einen Auftrag: ausdrücklich gewählt, sonst der gespeicherte Standarddrucker. */
export function resolvePrinter(opts: { printer?: string } | undefined, db: Db = getDb()): string | null {
  const explicit = opts?.printer
  if (typeof explicit === 'string' && explicit.trim() !== '') return explicit
  return getSettings(db).defaultPrinter
}

/**
 * Druckt das abgelegte PDF eines Belegs (fehlendes PDF wird vorher erzeugt) mit der Kopienzahl des
 * Fests und hält das Ergebnis am Beleg fest (`printed`/`printed_at` bzw. `print_error`).
 * `opts.pdf`: Ergebnis einer gerade erfolgten Ablage (Abschluss) – dann kein zweiter Versuch.
 */
export async function printInvoice(
  id: number,
  opts: { printer?: string; pdf?: PdfResult } = {},
  db: Db = getDb(),
  deps: PrintDeps = {}
): Promise<PrintResult> {
  const invoice = repo.findInvoice(db, id)
  if (!invoice) throw new Error('Die Rechnung wurde nicht gefunden.')
  const festival = repo.readFestival(db, invoice.festivalId)
  const copies = festival?.copies ?? 1
  const printer = resolvePrinter(opts, db)

  let result: PrintResult
  if (!printer) {
    result = { ok: false, printer: null, copies, error: NO_PRINTER_MESSAGE }
  } else {
    const pdf = opts.pdf ?? (await ensureInvoicePdf(id, db))
    result =
      pdf.ok && pdf.path
        ? await printPdf({ pdfPath: pdf.path, printer, copies }, deps)
        : { ok: false, printer, copies, error: `Kein PDF vorhanden, daher nicht gedruckt. ${pdf.error ?? ''}`.trim() }
  }
  if (result.ok) repo.setPrinted(db, id, nowIso())
  else repo.setPrintError(db, id, result.error ?? 'Unbekannter Druckfehler.')
  return result
}

/** Mehrere Belege nacheinander drucken. */
export async function printInvoices(
  ids: number[],
  opts: { printer?: string } = {},
  db: Db = getDb(),
  deps: PrintDeps = {}
): Promise<Array<{ id: number; result: PrintResult }>> {
  if (!Array.isArray(ids)) throw new Error('Ungültige Auswahl.')
  const results: Array<{ id: number; result: PrintResult }> = []
  for (const id of ids) {
    try {
      results.push({ id, result: await printInvoice(id, { printer: opts.printer }, db, deps) })
    } catch (err) {
      results.push({
        id,
        result: { ok: false, printer: resolvePrinter(opts, db), copies: 0, error: err instanceof Error ? err.message : String(err) }
      })
    }
  }
  return results
}

/* ------------------------------------------------------------------ */
/* Testseite                                                           */
/* ------------------------------------------------------------------ */

function readTemplateConfig(db: Db, festivalId: number): { config: TemplateConfig; logoFile: string | null } {
  const tpl = repo.readTemplate(db, festivalId)
  if (!tpl) return { config: getDefaultTemplateConfig(), logoFile: null }
  try {
    return { config: JSON.parse(tpl.configJson) as TemplateConfig, logoFile: tpl.logoFile }
  } catch {
    return { config: getDefaultTemplateConfig(), logoFile: tpl.logoFile }
  }
}

function removeOldTestPages(dir: string): void {
  try {
    for (const name of readdirSync(dir)) {
      if (/^testseite-.*\.pdf$/.test(name)) unlinkSync(join(dir, name))
    }
  } catch {
    // ignorieren
  }
}

/**
 * Testseite: Musterrechnung mit Vorlage und Logo des Fests (Nummer „MUSTER“, Kunde „Testseite“),
 * als Temp-PDF erzeugen und drucken. Wird NICHT als Rechnung gespeichert.
 */
export async function printTestPage(festivalId: number, opts: { printer?: string } = {}, db: Db = getDb(), deps: PrintDeps = {}): Promise<PrintResult> {
  const festival = repo.readFestival(db, festivalId)
  if (!festival) throw new Error('Das Gründungsfest wurde nicht gefunden.')
  const printer = resolvePrinter(opts, db)
  if (!printer) return { ok: false, printer: null, copies: 1, error: NO_PRINTER_MESSAGE }

  const { config, logoFile } = readTemplateConfig(db, festivalId)
  const today = todayIso()
  const sample = getSampleRenderData()
  const data = getSampleRenderData({
    number: 'MUSTER',
    festivalName: festival.name,
    invoiceDate: today,
    serviceDate: festival.festivalDate,
    dueDate: addDays(today, 7),
    today,
    customer: { ...sample.customer, contactName: 'Testseite', clubName: 'Musterrechnung – keine gültige Rechnung' },
    taxExempt: festival.taxExempt,
    taxExemptText: festival.taxExemptText
  })
  const pdf = await renderHtmlToPdf(buildHtml(data, config, loadLogoDataUrl(logoFile)))
  const dir = getTempDir()
  removeOldTestPages(dir)
  const path = join(dir, tempFileName('testseite', '.pdf'))
  writeFileSync(path, pdf)
  const dryRun = deps.dryRun ?? isPrintDryRun()
  try {
    // Testseite immer einfach drucken (nicht mit der Kopienzahl des Fests)
    return await printPdf({ pdfPath: path, printer, copies: 1 }, deps)
  } finally {
    // Im Dry-Run bleibt die Datei bis zur nächsten Testseite liegen (Kontrolle des Protokolls)
    if (!dryRun) {
      try {
        unlinkSync(path)
      } catch {
        // ignorieren
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

/** Ist der gespeicherte Standarddrucker vorhanden und nicht deaktiviert? */
export async function getPrinterStatus(deps: Pick<PrintDeps, 'exec' | 'platform' | 'listSystemPrinters'> = {}): Promise<PrinterStatus> {
  const printer = getSettings().defaultPrinter
  if (!printer) return { printer: null, available: false, message: 'Kein Drucker ausgewählt.' }
  const list = await (deps.listSystemPrinters ?? systemPrinters)()
  if (!list) {
    // ohne Fenster keine Liste – über lpstat bzw. als verfügbar annehmen
    const check = await checkPrinter(printer, { ...deps, listSystemPrinters: async () => null })
    return check.state === 'not_found' || check.state === 'disabled'
      ? { printer, available: false, message: check.message }
      : { printer, available: true }
  }
  const check = await checkPrinter(printer, { ...deps, listSystemPrinters: async () => list })
  return check.state === 'not_found' || check.state === 'disabled'
    ? { printer, available: false, message: check.message }
    : { printer, available: true }
}

let monitorTimer: ReturnType<typeof setInterval> | null = null
let lastStatusKey: string | null = null
let checking = false

async function pollStatus(): Promise<void> {
  if (checking || isShuttingDown() || !getMainWindow()) return
  checking = true
  try {
    const status = await getPrinterStatus()
    const key = JSON.stringify(status)
    if (lastStatusKey !== null && key !== lastStatusKey) emitToRenderer('printing.statusChanged', status)
    lastStatusKey = key
  } catch {
    // Druckerstatus ist nur ein Hinweis – Fehler ignorieren
  } finally {
    checking = false
  }
}

/**
 * Prüft den Druckerstatus alle 30 s und bei Fensterfokus; meldet Änderungen per
 * `printing.statusChanged`. Wird beim Beenden gestoppt.
 */
export function startPrinterStatusMonitor(): void {
  if (monitorTimer) return
  monitorTimer = setInterval(() => void pollStatus(), STATUS_POLL_MS)
  monitorTimer.unref?.()
  let lastFocusCheck = 0
  const onFocus = (): void => {
    const now = Date.now()
    if (now - lastFocusCheck < 2000) return
    lastFocusCheck = now
    void pollStatus()
  }
  app.on('browser-window-focus', onFocus)
  registerShutdownHook('printer-status-monitor', () => {
    if (monitorTimer) clearInterval(monitorTimer)
    monitorTimer = null
    app.removeListener('browser-window-focus', onFocus)
  })
}
