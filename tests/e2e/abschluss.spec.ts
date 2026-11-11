/**
 * E2E „Abschluss & Druck“: Nummernvergabe, PDF-Ablage, Dry-Run-Druck, Storno, Fehlerfälle,
 * Nachholen fehlender PDFs, ZIP-/PDF-Export, Testseite. Alles über IPC (`invoke`), Druck nur simuliert.
 *
 * Erzeugte PDFs werden zur Sichtprüfung nach `test-results/abschluss/` kopiert.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Club, Festival, InvoiceDraft, ProductInput } from '../../src/shared/types'
import {
  closeApp,
  countCrashReports,
  invoke,
  launchApp,
  prepareFestival,
  PROJECT_ROOT,
  stubDialogs,
  type AppContext
} from './helpers'

const PRINTER = 'E2E-Testdrucker'
const ARTIFACTS = join(PROJECT_ROOT, 'test-results', 'abschluss')

/** Die 8 Produkte der Beispielrechnung (öffentlich übernehmbar) und ihre Mengen → 670,20 €. */
const PRODUCTS: ProductInput[] = [
  { name: '1 Maß Bier (ohne Bedienung)', priceCents: 970, vatRate: 19, mode: 'feste_anzahl', defaultQuantity: 0 },
  { name: 'Brotzeit', priceCents: 800, vatRate: 7, mode: 'feste_anzahl', defaultQuantity: 0 },
  { name: 'Festzeichen', priceCents: 300, vatRate: 19, mode: 'pro_person', defaultQuantity: 1 },
  { name: 'Festessen', priceCents: 1450, vatRate: 7, mode: 'pro_person', defaultQuantity: 1 },
  { name: 'Korsoeinsatz', priceCents: 200, vatRate: 19, mode: 'feste_anzahl', defaultQuantity: 0 },
  { name: 'Käsespätzle', priceCents: 1000, vatRate: 7, mode: 'feste_anzahl', defaultQuantity: 0 },
  { name: 'Festschrift', priceCents: 1500, vatRate: 7, mode: 'feste_anzahl', defaultQuantity: 1 },
  { name: 'Alkoholfreies Getränk (0,5l)', priceCents: 380, vatRate: 19, mode: 'feste_anzahl', defaultQuantity: 0 }
]
const QUANTITIES = [0, 0, 45, 18, 0, 13, 1, 34]

interface Setup {
  festival: Festival
  productIds: number[]
  club: Club
}

/** Fest (Startnummer 81), Drucker, 8 Produkte, erfundener Verein. */
async function setupFestival(ctx: AppContext, name = 'Testfest 2025'): Promise<Setup> {
  const festival = await prepareFestival(ctx.page, { festival: { name, numberStart: 81, numberPrefix: '2025-', numberDigits: 3 } })
  await invoke(ctx.page, 'app.updateSettings', { defaultPrinter: PRINTER })
  const productIds: number[] = []
  for (const p of PRODUCTS) productIds.push((await invoke(ctx.page, 'products.create', festival.id, { ...p, active: true })).id)
  const club = await invoke(ctx.page, 'clubs.create', festival.id, {
    contactName: 'Erika Musterfrau',
    clubName: 'Musterverein Beispielhausen e.V.',
    street: 'Musterweg 3',
    zip: '01234',
    city: 'Beispielhausen',
    registeredPersons: 45
  })
  return { festival, productIds, club }
}

function buildDraft(s: Setup, quantities: number[] = QUANTITIES): InvoiceDraft {
  return {
    festivalId: s.festival.id,
    customer: {
      kind: 'verein',
      clubId: s.club.id,
      contactName: s.club.contactName,
      clubName: s.club.clubName,
      street: s.club.street,
      zip: s.club.zip,
      city: s.club.city,
      registeredPersons: s.club.registeredPersons
    },
    persons: 45,
    paymentKind: 'bar',
    invoiceDate: '2025-06-01',
    serviceDate: '2025-06-01',
    lines: PRODUCTS.map((p, i) => ({
      productId: s.productIds[i]!,
      name: p.name,
      priceCents: p.priceCents,
      vatRate: p.vatRate,
      quantity: quantities[i] ?? 0
    }))
  }
}

function readDryRunLog(ctx: AppContext): Array<{ file: string; printer: string; copies: number; time: string; ok: boolean }> {
  const path = join(ctx.userDataDir, 'print-dry-run.log')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
}

function keepArtifact(source: string, name: string): void {
  mkdirSync(ARTIFACTS, { recursive: true })
  copyFileSync(source, join(ARTIFACTS, name))
}

function expectPdf(path: string): void {
  expect(existsSync(path), path).toBe(true)
  const head = readFileSync(path).subarray(0, 5).toString('latin1')
  expect(head).toBe('%PDF-')
}

let crashReportsBefore = 0
test.beforeAll(() => {
  crashReportsBefore = countCrashReports()
})
test.afterAll(() => {
  expect(countCrashReports(), 'neue Absturzberichte').toBe(crashReportsBefore)
})

test.describe.serial('Abschluss & Druck: Normalablauf', () => {
  let ctx: AppContext
  let s: Setup
  let firstId = 0
  let stornoId = 0

  test.beforeAll(async () => {
    ctx = await launchApp({ viewport: 'laptop' })
    s = await setupFestival(ctx)
  })

  test.afterAll(async () => {
    if (ctx) await closeApp(ctx)
  })

  test('finalize: 670,20 €, PDF unter <Fest>/Rechnungen/<Nummer>.pdf, Dry-Run mit 2 Kopien', async () => {
    expect(await invoke(ctx.page, 'invoices.nextNumberPreview', s.festival.id)).toBe('2025-081')
    const result = await invoke(ctx.page, 'invoices.finalize', buildDraft(s))
    firstId = result.invoice.id

    expect(result.invoice.number).toBe('2025-081')
    expect(result.invoice.totals.grossCents).toBe(67020)
    expect(result.invoice.lines).toHaveLength(8)
    const expectedPath = join(ctx.documentsDir, 'Testfest 2025', 'Rechnungen', '2025-081.pdf')
    expect(result.pdf).toEqual({ ok: true, path: expectedPath })
    expectPdf(expectedPath)
    keepArtifact(expectedPath, 'abschluss-2025-081.pdf')

    expect(result.print).toMatchObject({ ok: true, dryRun: true, printer: PRINTER, copies: 2 })
    expect(result.invoice).toMatchObject({ printed: true, printError: null, pdfPath: expectedPath, status: 'abgeschlossen' })
    const log = readDryRunLog(ctx)
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ file: expectedPath, printer: PRINTER, copies: 2, ok: true })
    expect(Date.parse(log[0]!.time)).not.toBeNaN()

    expect(await invoke(ctx.page, 'invoices.nextNumberPreview', s.festival.id)).toBe('2025-082')
    const list = await invoke(ctx.page, 'invoices.list', s.festival.id)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ number: '2025-081', customerLabel: 'Musterverein Beispielhausen e.V.', totalGrossCents: 67020, printed: true })
  })

  test('0-€-Rechnung und fehlerhafte Entwürfe werden abgelehnt, ohne Nummer zu verbrauchen', async () => {
    await expect(invoke(ctx.page, 'invoices.finalize', buildDraft(s, [0, 0, 0, 0, 0, 0, 0, 0]))).rejects.toThrow(/Endbetrag 0 €/)
    const bad = buildDraft(s)
    bad.lines[2]!.quantity = -1
    await expect(invoke(ctx.page, 'invoices.finalize', bad)).rejects.toThrow(/Menge muss eine ganze Zahl ab 0/)
    expect(await invoke(ctx.page, 'invoices.nextNumberPreview', s.festival.id)).toBe('2025-082')
  })

  test('Storno: neue Nummer aus derselben Reihe, PDF unter Stornos/, Original storniert', async () => {
    await expect(invoke(ctx.page, 'invoices.storno', firstId, '  ')).rejects.toThrow('Bitte einen Grund für das Storno angeben.')
    const result = await invoke(ctx.page, 'invoices.storno', firstId, 'Falsche Personenzahl')
    stornoId = result.invoice.id
    expect(result.invoice).toMatchObject({ type: 'storno', number: '2025-082', originalNumber: '2025-081', stornoReason: 'Falsche Personenzahl' })
    expect(result.invoice.totals.grossCents).toBe(-67020)
    expect(result.invoice.lines.map((l) => l.quantity)).toEqual([0, 0, -45, -18, 0, -13, -1, -34])
    const expectedPath = join(ctx.documentsDir, 'Testfest 2025', 'Stornos', '2025-082.pdf')
    expect(result.pdf).toEqual({ ok: true, path: expectedPath })
    expectPdf(expectedPath)
    keepArtifact(expectedPath, 'abschluss-storno-2025-082.pdf')
    expect(result.print).toMatchObject({ ok: true, copies: 2 })
    expect(readDryRunLog(ctx).at(-1)).toMatchObject({ file: expectedPath, copies: 2 })

    const original = await invoke(ctx.page, 'invoices.get', firstId)
    expect(original).toMatchObject({ status: 'storniert', stornoInvoiceId: stornoId, stornoNumber: '2025-082' })
    await expect(invoke(ctx.page, 'invoices.storno', firstId, 'Nochmal')).rejects.toThrow(/bereits storniert/)
    await expect(invoke(ctx.page, 'invoices.storno', stornoId, 'Storno vom Storno')).rejects.toThrow(/Stornobeleg kann nicht storniert/)
  })

  test('erneut drucken mit anderem Drucker, printMany nacheinander', async () => {
    const one = await invoke(ctx.page, 'invoices.print', firstId, { printer: 'Anderer Drucker' })
    expect(one).toMatchObject({ ok: true, printer: 'Anderer Drucker', copies: 2, dryRun: true })
    const many = await invoke(ctx.page, 'invoices.printMany', [firstId, stornoId])
    expect(many.map((m) => [m.id, m.result.ok, m.result.printer])).toEqual([
      [firstId, true, PRINTER],
      [stornoId, true, PRINTER]
    ])
  })

  test('PDF öffnen (in E2E nur protokolliert) und PDF exportieren', async () => {
    await invoke(ctx.page, 'invoices.openPdf', firstId)
    const shellLog = readFileSync(join(ctx.userDataDir, 'shell.log'), 'utf8')
    expect(shellLog).toContain(join(ctx.documentsDir, 'Testfest 2025', 'Rechnungen', '2025-081.pdf'))

    const exportDir = mkdtempSync(join(tmpdir(), 'festbuero-e2e-export-'))
    try {
      await stubDialogs(ctx.app, { save: join(exportDir, 'Kopie') })
      const target = await invoke(ctx.page, 'invoices.exportPdf', firstId)
      expect(target).toBe(join(exportDir, 'Kopie.pdf'))
      expectPdf(target!)
      await stubDialogs(ctx.app, { save: null })
      expect(await invoke(ctx.page, 'invoices.exportPdf', firstId)).toBeNull()
    } finally {
      rmSync(exportDir, { recursive: true, force: true })
    }
  })

  test('ZIP-Export mit Ordnern Rechnungen/ und Stornos/', async () => {
    const exportDir = mkdtempSync(join(tmpdir(), 'festbuero-e2e-zip-'))
    try {
      await stubDialogs(ctx.app, { save: join(exportDir, 'Export.zip') })
      const target = await invoke(ctx.page, 'invoices.exportZip', [firstId, stornoId])
      expect(target).toBe(join(exportDir, 'Export.zip'))
      const zip = readFileSync(target!)
      expect(zip.subarray(0, 2).toString('latin1')).toBe('PK')
      const text = zip.toString('latin1')
      expect(text).toContain('Rechnungen/2025-081.pdf')
      expect(text).toContain('Stornos/2025-082.pdf')
      await stubDialogs(ctx.app, { save: null })
      expect(await invoke(ctx.page, 'invoices.exportZip', [firstId])).toBeNull()
    } finally {
      rmSync(exportDir, { recursive: true, force: true })
    }
  })

  test('Testseite: Musterrechnung mit Vorlage des Fests, 1 Kopie, nicht als Rechnung gespeichert', async () => {
    const countBefore = (await invoke(ctx.page, 'invoices.list', s.festival.id)).length
    const result = await invoke(ctx.page, 'printing.printTestPage', s.festival.id)
    expect(result).toMatchObject({ ok: true, dryRun: true, printer: PRINTER, copies: 1 })
    const entry = readDryRunLog(ctx).at(-1)!
    expect(entry.file).toMatch(/testseite-.*\.pdf$/)
    expectPdf(entry.file)
    keepArtifact(entry.file, 'abschluss-testseite.pdf')
    expect((await invoke(ctx.page, 'invoices.list', s.festival.id)).length).toBe(countBefore)
    expect(await invoke(ctx.page, 'invoices.nextNumberPreview', s.festival.id)).toBe('2025-083')
  })

  test('Druckerstatus: gespeicherter Drucker fehlt → nicht verfügbar mit Begründung', async () => {
    const status = await invoke(ctx.page, 'printing.getStatus')
    expect(status.printer).toBe(PRINTER)
    expect(status.available).toBe(false)
    expect(status.message).toMatch(/nicht gefunden|deaktiviert/)
  })
})

test.describe.serial('Abschluss & Druck: Fehlerfälle', () => {
  test('Druckfehler (FESTBUERO_FAKE_PRINT_FAIL=1) lässt die Rechnung gültig', async () => {
    const ctx = await launchApp({ env: { FESTBUERO_FAKE_PRINT_FAIL: '1' } })
    try {
      const s = await setupFestival(ctx)
      const result = await invoke(ctx.page, 'invoices.finalize', buildDraft(s))
      expect(result.invoice).toMatchObject({ number: '2025-081', status: 'abgeschlossen', printed: false })
      expect(result.invoice.printError).toMatch(/simulierter Druckfehler/)
      expect(result.pdf.ok).toBe(true)
      expect(result.print).toMatchObject({ ok: false, dryRun: true, copies: 2 })
      expect(readDryRunLog(ctx).at(-1)).toMatchObject({ ok: false })
      expect(await invoke(ctx.page, 'invoices.nextNumberPreview', s.festival.id)).toBe('2025-082')

      // Drucker wieder „bereit“ → erneut drucken klappt, Fehler wird gelöscht
      await ctx.app.evaluate(() => {
        delete process.env.FESTBUERO_FAKE_PRINT_FAIL
      })
      expect(await invoke(ctx.page, 'invoices.print', result.invoice.id)).toMatchObject({ ok: true })
      expect(await invoke(ctx.page, 'invoices.get', result.invoice.id)).toMatchObject({ printed: true, printError: null })

      // ohne Drucker: Fehler „Kein Drucker ausgewählt“, Rechnung trotzdem gültig
      await invoke(ctx.page, 'app.updateSettings', { defaultPrinter: null })
      const noPrinter = await invoke(ctx.page, 'invoices.finalize', buildDraft(s))
      expect(noPrinter.invoice.number).toBe('2025-082')
      expect(noPrinter.print.ok).toBe(false)
      expect(noPrinter.print.error).toMatch(/^Kein Drucker ausgewählt/)
      expect(noPrinter.pdf.ok).toBe(true)
    } finally {
      await closeApp(ctx)
    }
  })

  test('PDF-Fehler (FESTBUERO_FAKE_PDF_FAIL=1): Rechnung gültig, PDF wird nach Neustart bei get nachgeholt', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'festbuero-e2e-data-'))
    const documentsDir = mkdtempSync(join(tmpdir(), 'festbuero-e2e-docs-'))
    try {
      const first = await launchApp({ userDataDir, documentsDir, env: { FESTBUERO_FAKE_PDF_FAIL: '1' } })
      let invoiceId = 0
      try {
        const s = await setupFestival(first)
        const result = await invoke(first.page, 'invoices.finalize', buildDraft(s))
        invoiceId = result.invoice.id
        expect(result.invoice).toMatchObject({ number: '2025-081', status: 'abgeschlossen', pdfPath: null, printed: false })
        expect(result.pdf.ok).toBe(false)
        expect(result.pdf.error).toMatch(/PDF/)
        expect(result.print.ok).toBe(false)
        expect(result.print.error).toMatch(/Kein PDF vorhanden/)
        expect(await invoke(first.page, 'invoices.ensurePdf', invoiceId)).toMatchObject({ ok: false })
      } finally {
        await closeApp(first)
      }

      // „beim nächsten Öffnen“: neuer Start ohne Fehler-Simulation
      const second = await launchApp({ userDataDir, documentsDir })
      try {
        const invoice = await invoke(second.page, 'invoices.get', invoiceId)
        const expectedPath = join(documentsDir, 'Testfest 2025', 'Rechnungen', '2025-081.pdf')
        expect(invoice.number).toBe('2025-081')
        expect(invoice.pdfPath).toBe(expectedPath)
        expectPdf(expectedPath)
        expect(await invoke(second.page, 'invoices.print', invoiceId)).toMatchObject({ ok: true, copies: 2 })
      } finally {
        await closeApp(second)
      }
    } finally {
      rmSync(userDataDir, { recursive: true, force: true })
      rmSync(documentsDir, { recursive: true, force: true })
    }
  })

  test('Nummernkollision über Feste: verständliche Meldung, nichts gespeichert', async () => {
    const ctx = await launchApp()
    try {
      const a = await setupFestival(ctx, 'Fest A')
      await invoke(ctx.page, 'invoices.finalize', buildDraft(a))
      const b = await setupFestival(ctx, 'Fest B')
      await expect(invoke(ctx.page, 'invoices.finalize', buildDraft(b))).rejects.toThrow(
        'Die Rechnungsnummer 2025-081 existiert bereits (anderes Fest?). Bitte Präfix oder Startnummer prüfen.'
      )
      expect(await invoke(ctx.page, 'invoices.list', b.festival.id)).toHaveLength(0)
      expect(await invoke(ctx.page, 'invoices.nextNumberPreview', b.festival.id)).toBe('2025-081')
    } finally {
      await closeApp(ctx)
    }
  })
})
