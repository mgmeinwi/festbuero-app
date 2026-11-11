/**
 * Druck: Befehlsaufbau (macOS/Windows), Vorabprüfung, Fehlermeldungen, Dry-Run.
 * Es wird NIE ein echtes Programm gestartet: `exec` ist immer ein Mock.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./invoice-test-utils')).electronMock())

import {
  buildPrintCommand,
  checkPrinter,
  describePrintFailure,
  NO_PRINTER_MESSAGE,
  parseLpstat,
  printPdf,
  resolvePrinter,
  stateFromOptions,
  type ExecFn,
  type ExecResult
} from './printing'
import { setupTestContext } from './invoice-test-utils'
import { updateSettings } from './settings'

const ok: ExecResult = { code: 0, stdout: '', stderr: '', timedOut: false }

function mockExec(result: ExecResult | ((file: string, args: string[]) => ExecResult) = ok) {
  return vi.fn<ExecFn>(async (file, args) => (typeof result === 'function' ? result(file, args) : result))
}

function printer(name: string, options: Record<string, string> = { 'printer-state': '3' }): Electron.PrinterInfo {
  return { name, displayName: name, description: '', options } as Electron.PrinterInfo
}

describe('Druckbefehl', () => {
  it('macOS/Linux: lp -d <Drucker> -n <Kopien> <pdf>', () => {
    expect(buildPrintCommand('darwin', { pdfPath: '/Dokumente/Fest/Rechnungen/2025-081.pdf', printer: 'Büro_Drucker', copies: 2 })).toEqual({
      file: 'lp',
      args: ['-d', 'Büro_Drucker', '-n', '2', '/Dokumente/Fest/Rechnungen/2025-081.pdf'],
      timeoutMs: 30_000
    })
    expect(buildPrintCommand('linux', { pdfPath: '/a b/c.pdf', printer: 'X', copies: 1 }).args).toEqual(['-d', 'X', '-n', '1', '/a b/c.pdf'])
  })

  it('Windows: SumatraPDF -print-to <Drucker> -print-settings <n>x -silent <pdf>', () => {
    const cmd = buildPrintCommand(
      'win32',
      { pdfPath: 'C:\\Users\\Fest\\Rechnungen\\2025-081.pdf', printer: 'HP LaserJet (Büro)', copies: 3 },
      'C:\\Programme\\Festbuero\\resources\\win\\SumatraPDF.exe'
    )
    expect(cmd).toEqual({
      file: 'C:\\Programme\\Festbuero\\resources\\win\\SumatraPDF.exe',
      args: ['-print-to', 'HP LaserJet (Büro)', '-print-settings', '3x', '-silent', 'C:\\Users\\Fest\\Rechnungen\\2025-081.pdf'],
      timeoutMs: 120_000
    })
    expect(() => buildPrintCommand('win32', { pdfPath: 'x', printer: 'y', copies: 1 })).toThrow(/SumatraPDF/)
  })
})

describe('Druck: Ausführung (gemockt)', () => {
  let root: string
  let pdf: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'festbuero-print-'))
    pdf = join(root, '2025-081.pdf')
    writeFileSync(pdf, '%PDF-1.4')
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('macOS: prüft den Drucker und ruft lp mit Kopienzahl auf', async () => {
    const exec = mockExec()
    const result = await printPdf(
      { pdfPath: pdf, printer: 'Festdrucker', copies: 2 },
      { dryRun: false, platform: 'darwin', exec, listSystemPrinters: async () => [printer('Festdrucker')] }
    )
    expect(result).toEqual({ ok: true, printer: 'Festdrucker', copies: 2 })
    expect(exec).toHaveBeenCalledTimes(1)
    expect(exec).toHaveBeenCalledWith('lp', ['-d', 'Festdrucker', '-n', '2', pdf], { timeoutMs: 30_000 })
  })

  it('macOS: unbekannter Drucker → „nicht gefunden“, kein lp-Aufruf', async () => {
    const exec = mockExec()
    const result = await printPdf(
      { pdfPath: pdf, printer: 'Weg', copies: 2 },
      { dryRun: false, platform: 'darwin', exec, listSystemPrinters: async () => [printer('Anderer')] }
    )
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Drucker „Weg“ nicht gefunden. Bitte einen anderen Drucker wählen.')
    expect(exec).not.toHaveBeenCalled()
  })

  it('macOS: deaktivierter Drucker → „deaktiviert/offline“', async () => {
    const exec = mockExec()
    const result = await printPdf(
      { pdfPath: pdf, printer: 'Festdrucker', copies: 1 },
      { dryRun: false, platform: 'darwin', exec, listSystemPrinters: async () => [printer('Festdrucker', { 'printer-state': '5' })] }
    )
    expect(result.error).toMatch(/^Drucker „Festdrucker“ ist deaktiviert\/offline/)
    expect(exec).not.toHaveBeenCalled()
  })

  it('macOS ohne Druckerliste: lpstat (Sprache C) entscheidet', async () => {
    const exec = mockExec((file) =>
      file === 'lpstat'
        ? { code: 0, stdout: 'printer Festdrucker disabled since Mon Jun  2 10:00:00 2025 -\n\tPaused', stderr: '', timedOut: false }
        : ok
    )
    const result = await printPdf(
      { pdfPath: pdf, printer: 'Festdrucker', copies: 1 },
      { dryRun: false, platform: 'darwin', exec, listSystemPrinters: async () => null }
    )
    expect(result.error).toMatch(/deaktiviert\/offline/)
    expect(exec).toHaveBeenCalledTimes(1)
    const [file, args, options] = exec.mock.calls[0]!
    expect(file).toBe('lpstat')
    expect(args).toEqual(['-p', 'Festdrucker'])
    expect(options.env?.LC_ALL).toBe('C')
  })

  it('macOS: lp-Fehler werden auf Deutsch gemeldet', async () => {
    const run = (stderr: string, code = 1) =>
      printPdf(
        { pdfPath: pdf, printer: 'Festdrucker', copies: 1 },
        {
          dryRun: false,
          platform: 'darwin',
          exec: mockExec({ code, stdout: '', stderr, timedOut: false }),
          listSystemPrinters: async () => [printer('Festdrucker')]
        }
      )
    expect((await run('lp: The printer or class does not exist.')).error).toMatch(/nicht gefunden/)
    expect((await run('lp: Destination "Festdrucker" is not accepting jobs.')).error).toMatch(/deaktiviert\/offline/)
    expect((await run('lp: Unbekannter Fehler XY')).error).toBe('Druck auf „Festdrucker“ fehlgeschlagen: lp: Unbekannter Fehler XY')
    expect((await run('', 3)).error).toBe('Druck auf „Festdrucker“ fehlgeschlagen (Rückgabewert 3).')
  })

  it('Windows: SumatraPDF fehlt → klare Meldung, kein Aufruf', async () => {
    const exec = mockExec()
    const result = await printPdf(
      { pdfPath: pdf, printer: 'HP', copies: 2 },
      { dryRun: false, platform: 'win32', exec, sumatraPath: join(root, 'fehlt', 'SumatraPDF.exe'), listSystemPrinters: async () => [printer('HP', {})] }
    )
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/^SumatraPDF wurde nicht gefunden/)
    expect(exec).not.toHaveBeenCalled()
  })

  it('Windows: SumatraPDF mit Drucker, Kopien und Timeout', async () => {
    const sumatra = join(root, 'SumatraPDF.exe')
    writeFileSync(sumatra, '')
    const exec = mockExec()
    const result = await printPdf(
      { pdfPath: pdf, printer: 'HP LaserJet', copies: 2 },
      { dryRun: false, platform: 'win32', exec, sumatraPath: sumatra, listSystemPrinters: async () => [printer('HP LaserJet', {})] }
    )
    expect(result).toEqual({ ok: true, printer: 'HP LaserJet', copies: 2 })
    expect(exec).toHaveBeenCalledWith(sumatra, ['-print-to', 'HP LaserJet', '-print-settings', '2x', '-silent', pdf], { timeoutMs: 120_000 })
  })

  it('Windows: unbekannter Drucker und Fehler-Exitcode', async () => {
    const sumatra = join(root, 'SumatraPDF.exe')
    writeFileSync(sumatra, '')
    const missing = await printPdf(
      { pdfPath: pdf, printer: 'Weg', copies: 1 },
      { dryRun: false, platform: 'win32', exec: mockExec(), sumatraPath: sumatra, listSystemPrinters: async () => [printer('HP', {})] }
    )
    expect(missing.error).toMatch(/Drucker „Weg“ nicht gefunden/)
    const failed = await printPdf(
      { pdfPath: pdf, printer: 'HP', copies: 1 },
      {
        dryRun: false,
        platform: 'win32',
        exec: mockExec({ code: 1, stdout: '', stderr: '', timedOut: false }),
        sumatraPath: sumatra,
        listSystemPrinters: async () => [printer('HP', {})]
      }
    )
    expect(failed).toMatchObject({ ok: false, error: 'Druck auf „HP“ fehlgeschlagen (Rückgabewert 1).' })
  })

  it('Startfehler und Zeitüberschreitung', () => {
    const enoent = Object.assign(new Error('spawn lp ENOENT'), { code: 'ENOENT' }) as NodeJS.ErrnoException
    expect(describePrintFailure('X', { code: null, stdout: '', stderr: '', spawnError: enoent, timedOut: false }, 'lp')).toBe(
      'Das Druckprogramm „lp“ wurde nicht gefunden.'
    )
    expect(describePrintFailure('X', { code: null, stdout: '', stderr: '', timedOut: true }, 'SumatraPDF')).toMatch(/Zeitüberschreitung/)
  })

  it('kein Drucker oder fehlendes PDF → Fehler ohne Aufruf', async () => {
    const exec = mockExec()
    expect(await printPdf({ pdfPath: pdf, printer: null, copies: 2 }, { dryRun: false, exec })).toEqual({
      ok: false,
      printer: null,
      copies: 2,
      error: NO_PRINTER_MESSAGE
    })
    expect(NO_PRINTER_MESSAGE).toMatch(/^Kein Drucker ausgewählt/)
    expect((await printPdf({ pdfPath: join(root, 'nix.pdf'), printer: 'X', copies: 1 }, { dryRun: false, exec })).error).toMatch(
      /PDF-Datei .* nicht gefunden/
    )
    expect(exec).not.toHaveBeenCalled()
  })
})

describe('Druck: Dry-Run', () => {
  let root: string
  let pdf: string
  let log: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'festbuero-dryrun-'))
    pdf = join(root, '2025-081.pdf')
    log = join(root, 'print-dry-run.log')
    writeFileSync(pdf, '%PDF-1.4')
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('protokolliert Datei, Drucker, Kopien und Zeit als JSON-Zeile, ohne Systemaufruf', async () => {
    const exec = mockExec()
    const now = new Date('2025-06-01T10:00:00.000Z')
    const result = await printPdf({ pdfPath: pdf, printer: 'Festdrucker', copies: 2 }, { dryRun: true, fakeFail: false, exec, dryRunLogPath: log, now: () => now })
    expect(result).toEqual({ ok: true, printer: 'Festdrucker', copies: 2, dryRun: true })
    await printPdf({ pdfPath: pdf, printer: 'Zweiter', copies: 1 }, { dryRun: true, fakeFail: false, exec, dryRunLogPath: log, now: () => now })
    const lines = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as unknown)
    expect(lines).toEqual([
      { time: '2025-06-01T10:00:00.000Z', file: pdf, printer: 'Festdrucker', copies: 2, ok: true },
      { time: '2025-06-01T10:00:00.000Z', file: pdf, printer: 'Zweiter', copies: 1, ok: true }
    ])
    expect(exec).not.toHaveBeenCalled()
  })

  it('FESTBUERO_FAKE_PRINT_FAIL liefert einen Fehler', async () => {
    const result = await printPdf({ pdfPath: pdf, printer: 'Festdrucker', copies: 2 }, { dryRun: true, fakeFail: true, dryRunLogPath: log })
    expect(result).toMatchObject({ ok: false, dryRun: true, printer: 'Festdrucker', copies: 2 })
    expect(result.error).toMatch(/simulierter Druckfehler/)
    expect(JSON.parse(readFileSync(log, 'utf8').trim())).toMatchObject({ ok: false, copies: 2 })
  })

  it('Standard: unpaketiert immer Dry-Run (env), Fake-Fehler über Umgebungsvariable', async () => {
    const ctx = setupTestContext()
    try {
      delete process.env.FESTBUERO_PRINT_DRY_RUN // unpaketiert (Mock: isPackaged=false) → trotzdem Dry-Run
      const exec = mockExec()
      expect(await printPdf({ pdfPath: pdf, printer: 'X', copies: 2 }, { exec })).toMatchObject({ ok: true, dryRun: true })
      process.env.FESTBUERO_FAKE_PRINT_FAIL = '1'
      expect(await printPdf({ pdfPath: pdf, printer: 'X', copies: 2 }, { exec })).toMatchObject({ ok: false, dryRun: true })
      expect(exec).not.toHaveBeenCalled()
      expect(existsSync(join(ctx.userData, 'print-dry-run.log'))).toBe(true)
    } finally {
      delete process.env.FESTBUERO_FAKE_PRINT_FAIL
      ctx.cleanup()
    }
  })
})

describe('Druck: Hilfsfunktionen', () => {
  it('stateFromOptions', () => {
    expect(stateFromOptions({ 'printer-state': '3' })).toBe('ok')
    expect(stateFromOptions({ 'printer-state': '4' })).toBe('ok')
    expect(stateFromOptions({ 'printer-state': '5' })).toBe('disabled')
    expect(stateFromOptions({ 'printer-is-accepting-jobs': 'false' })).toBe('disabled')
    expect(stateFromOptions({})).toBe('unknown')
    expect(stateFromOptions(undefined)).toBe('unknown')
  })

  it('parseLpstat', () => {
    expect(parseLpstat('printer A is idle.  enabled since Mon', '', 0)).toBe('ok')
    expect(parseLpstat('printer A disabled since Mon -\n\treason unknown', '', 0)).toBe('disabled')
    expect(parseLpstat('', 'lpstat: Invalid destination name in list "A".', 1)).toBe('not_found')
    expect(parseLpstat('', '', 1)).toBe('unknown')
  })

  it('checkPrinter unter Windows ohne Zustandsangaben: unbekannt, aber vorhanden', async () => {
    const exec = mockExec()
    expect(await checkPrinter('HP', { platform: 'win32', exec, listSystemPrinters: async () => [printer('HP', {})] })).toEqual({ state: 'unknown' })
    expect(exec).not.toHaveBeenCalled()
  })

  it('resolvePrinter: ausdrücklich gewählt vor Standarddrucker', () => {
    const ctx = setupTestContext({ printer: 'Standard' })
    try {
      expect(resolvePrinter({ printer: 'Anderer' }, ctx.db)).toBe('Anderer')
      expect(resolvePrinter({ printer: '  ' }, ctx.db)).toBe('Standard')
      expect(resolvePrinter(undefined, ctx.db)).toBe('Standard')
      updateSettings({ defaultPrinter: null }, ctx.db)
      expect(resolvePrinter({}, ctx.db)).toBeNull()
    } finally {
      ctx.cleanup()
    }
  })
})
