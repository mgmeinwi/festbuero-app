/**
 * Generator für die README-Screenshots (kein Test im eigentlichen Sinn).
 *
 *   npm run docs:screenshots      # baut nach out/docs und schreibt docs/screenshots/*.png
 *
 * Läuft NICHT bei `npm run test:e2e` mit (eigene Config `playwright.docs.config.ts`, Ordner tests/docs).
 *
 * Ablauf: App isoliert starten (temporäre Daten, Druck nur simuliert) im Doku-Modus
 * (FESTBUERO_DOCS_SCREENSHOTS=1: nur erfundene Demo-Drucker, kein „Druck simuliert“-Hinweis), das
 * Beispiel-Fest anlegen, Demo-Rechnungen an die erfundenen Vereine erzeugen, Seiten ansteuern und
 * fotografieren. Die Bilder werden mit `sips` (macOS) auf höchstens 1600 px verkleinert.
 * Alle Daten sind erfunden (Beispiel-Fest, Muster-Vereine, tests/fixtures/vereine-beispiel.xlsx).
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { addDays, todayIso } from '../../src/shared/dates'
import type { Club, CustomerSnapshot, Festival, InvoiceDraft, PaymentKind, Product } from '../../src/shared/types'
import {
  closeApp,
  countCrashReports,
  dismissToasts,
  gotoRoute,
  invoke,
  launchApp,
  POLL,
  PROJECT_ROOT,
  setWindowSize,
  stubDialogs,
  VIEWPORTS,
  waitForStableUi,
  type AppContext,
  type ViewportName
} from '../e2e/helpers'

const OUTPUT_DIR = join(PROJECT_ROOT, 'docs', 'screenshots')
const FIXTURE_XLSX = join(PROJECT_ROOT, 'tests', 'fixtures', 'vereine-beispiel.xlsx')
/** Doku-Modus (src/main/env.ts#isDocsScreenshots) – wirkt nur zusammen mit FESTBUERO_E2E=1 aus launchApp() */
const DOCS_ENV = { FESTBUERO_DOCS_SCREENSHOTS: '1' }
/** erfundener Standarddrucker des Doku-Modus (src/main/services/printing.ts#DOCS_DEMO_PRINTERS) */
const DEMO_PRINTER = 'Festdrucker Kasse'
/** maximale Kantenlänge der fertigen Bilder */
const MAX_SIZE_PX = 1600

const written: string[] = []

/* ------------------------------------------------------------------ */
/* Hilfen                                                              */
/* ------------------------------------------------------------------ */

/** Verkleinert ein Bild auf höchstens MAX_SIZE_PX (macOS `sips`; sonst bleibt es unverändert). */
function shrink(file: string): void {
  if (process.platform !== 'darwin') {
    console.warn(`[docs] sips gibt es nur unter macOS – ${file} bleibt in Originalgröße.`)
    return
  }
  execFileSync('sips', ['-Z', String(MAX_SIZE_PX), file], { stdio: 'ignore' })
}

/** Screenshot des Fensterinhalts nach docs/screenshots/<name>.png (ohne Toasts, ohne Hover-Zustand). */
async function capture(page: Page, name: string): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true })
  await dismissToasts(page)
  await page.mouse.move(1, 1) // Maus aus dem Inhalt (kein Hover-Zustand, keine Tooltips)
  await waitForStableUi(page)
  const file = join(OUTPUT_DIR, `${name}.png`)
  await page.screenshot({ path: file, animations: 'disabled' })
  shrink(file)
  written.push(file)
}

async function setViewport(ctx: AppContext, name: ViewportName): Promise<void> {
  const [width, height] = VIEWPORTS[name]
  await setWindowSize(ctx.app, width, height, ctx.page)
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await invoke(page, 'app.updateSettings', { theme })
  await page.waitForFunction((t) => document.documentElement.classList.contains('dark') === (t === 'dark'), theme, POLL)
}

/** Fokus entfernen (kein Fokusrahmen im Bild) und alle Scrollbereiche nach oben setzen. */
async function resetFocusAndScroll(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(document.activeElement as HTMLElement | null)?.blur()
    document.querySelectorAll<HTMLElement>('*').forEach((el) => {
      if (el.scrollTop > 0) el.scrollTop = 0
    })
  })
}

/* ------------------------------------------------------------------ */
/* Demo-Daten                                                          */
/* ------------------------------------------------------------------ */

/** Kurznamen für die 8 Produkte des Beispiel-Fests (src/main/services/sample-data.ts). */
const PRODUCT_NAMES = {
  bier: '1 Maß Bier (ohne Bedienung)',
  brotzeit: 'Brotzeit',
  zeichen: 'Festzeichen',
  essen: 'Festessen',
  korso: 'Korsoeinsatz',
  spaetzle: 'Käsespätzle',
  schrift: 'Festschrift',
  alkfrei: 'Alkoholfreies Getränk (0,5l)'
} as const
type ProductKey = keyof typeof PRODUCT_NAMES
type Quantities = Partial<Record<ProductKey, number>>

interface DemoInvoice {
  /** Vereinsname aus dem Beispiel-Fest oder Einzelrechnung */
  club?: string
  einzel?: Partial<CustomerSnapshot>
  persons?: number
  payment: PaymentKind
  /** Tag relativ zu heute (−2, −1, 0) */
  day: number
  q: Quantities
}

/**
 * Rechnungen an erfundene Vereine, über drei Tage verteilt (Festabend, Festtag, Festsonntag).
 * Ohne Rechnung bleiben: Krieger- und Soldatenverein Musterberg, Gartenbauverein Musterau,
 * Fischereiverein Beispielsee (→ „Vereine ohne Rechnung“). „Musterverein Beispielhausen e.V.“ wird in
 * der Maske abgerechnet (Prüfsumme 670,20 €), Musterwald später storniert und neu erstellt.
 */
const DEMO_INVOICES: DemoInvoice[] = [
  { club: 'Trachtenverein Musterdorf', persons: 30, payment: 'bar', day: -2, q: { zeichen: 30, bier: 24, brotzeit: 14, alkfrei: 8, schrift: 1 } },
  { club: 'Burschenverein Exempelfeld', persons: 24, payment: 'bar', day: -2, q: { zeichen: 24, bier: 36, brotzeit: 12, alkfrei: 6, schrift: 1 } },
  { einzel: {}, payment: 'bar', day: -2, q: { bier: 2, brotzeit: 2 } },
  { club: 'Freiwillige Feuerwehr Musterhausen', persons: 58, payment: 'ueberweisung', day: -1, q: { zeichen: 58, essen: 42, korso: 58, bier: 40, alkfrei: 22, schrift: 2 } },
  { club: 'Musikkapelle Beispieltal', persons: 38, payment: 'bar', day: -1, q: { zeichen: 38, essen: 30, spaetzle: 6, korso: 38, bier: 28, alkfrei: 10, schrift: 1 } },
  { club: 'Schützengesellschaft Beispielstadt', persons: 26, payment: 'bar', day: -1, q: { zeichen: 26, essen: 18, spaetzle: 5, korso: 26, bier: 20, schrift: 1 } },
  { club: 'Sportverein Beispielingen 1920', persons: 52, payment: 'ueberweisung', day: -1, q: { zeichen: 52, essen: 35, spaetzle: 10, korso: 52, bier: 30, alkfrei: 25, schrift: 1 } },
  {
    einzel: { contactName: 'Anton Gast', street: 'Lindenweg 4', zip: '12345', city: 'Beispielhausen' },
    payment: 'bar',
    day: -1,
    q: { essen: 2, schrift: 1 }
  },
  { club: 'Landjugend Probedorf', persons: 40, payment: 'ueberweisung', day: 0, q: { zeichen: 40, bier: 44, brotzeit: 20, alkfrei: 12, schrift: 1 } },
  { club: 'Heimat- und Brauchtumsverein Musterwald', persons: 22, payment: 'bar', day: 0, q: { zeichen: 22, essen: 16, spaetzle: 4, schrift: 1 } }
]
const STORNO_CLUB = 'Heimat- und Brauchtumsverein Musterwald'
const STORNO_REASON = 'Personenzahl korrigiert: 20 statt 22 Personen'
const CORRECTED: DemoInvoice = { club: STORNO_CLUB, persons: 20, payment: 'bar', day: 0, q: { zeichen: 20, essen: 16, spaetzle: 4, schrift: 1 } }
/** Vorschau-Rechnung aus der Liste (Überweisung) */
const PREVIEW_CLUB = 'Freiwillige Feuerwehr Musterhausen'

/** Maske: Verein und Mengen der Beispielrechnung (0/0/45/18/0/13/1/34 = 670,20 €) */
const MASK_CLUB = 'Musterverein Beispielhausen e.V.'
const MASK_QUANTITIES = [0, 0, 45, 18, 0, 13, 1, 34]

interface DemoContext {
  festival: Festival
  products: Product[]
  clubs: Club[]
  today: string
}

function customerFor(demo: DemoInvoice, clubs: Club[]): CustomerSnapshot {
  if (demo.einzel) {
    return { kind: 'einzel', clubId: null, contactName: '', clubName: '', street: '', zip: '', city: '', registeredPersons: null, ...demo.einzel }
  }
  const club = clubs.find((c) => c.clubName === demo.club)
  if (!club) throw new Error(`Beispiel-Verein fehlt: ${demo.club}`)
  return {
    kind: 'verein',
    clubId: club.id,
    contactName: club.contactName,
    clubName: club.clubName,
    street: club.street,
    zip: club.zip,
    city: club.city,
    registeredPersons: club.registeredPersons
  }
}

async function finalizeDemo(page: Page, data: DemoContext, demo: DemoInvoice): Promise<string> {
  const date = addDays(data.today, demo.day)
  const draft: InvoiceDraft = {
    festivalId: data.festival.id,
    customer: customerFor(demo, data.clubs),
    persons: demo.einzel ? null : (demo.persons ?? null),
    paymentKind: demo.payment,
    invoiceDate: date,
    serviceDate: date,
    lines: data.products.map((p) => {
      const key = (Object.keys(PRODUCT_NAMES) as ProductKey[]).find((k) => PRODUCT_NAMES[k] === p.name)
      return { productId: p.id, name: p.name, priceCents: p.priceCents, vatRate: p.vatRate, quantity: key ? (demo.q[key] ?? 0) : 0 }
    })
  }
  const result = await invoke(page, 'invoices.finalize', draft)
  return result.invoice.number
}

function invoiceRow(page: Page, number: string) {
  return page.locator(`[data-testid="invoice-row"][data-number="${number}"]`)
}

/* ------------------------------------------------------------------ */
/* Ablauf                                                              */
/* ------------------------------------------------------------------ */

let crashReportsBefore = 0
test.beforeAll(() => {
  crashReportsBefore = countCrashReports()
})
test.afterAll(() => {
  for (const file of written) {
    console.log(`[docs] ${file.replace(`${PROJECT_ROOT}/`, '')}  ${Math.round(statSync(file).size / 1024)} KB`)
  }
  expect(countCrashReports(), 'keine neuen Absturzberichte').toBe(crashReportsBefore)
})

test('README-Screenshots mit dem Beispiel-Fest', async () => {
  const ctx = await launchApp({ viewport: 'laptop', env: DOCS_ENV })
  const { page } = ctx
  try {
    // --- Beispiel-Fest einrichten -------------------------------------------------------------
    const today = todayIso()
    const sample = await invoke(page, 'app.createSampleFestival')
    // Festsonntag = heute: Stornos tragen immer das heutige Datum, so passen alle Belege ins Fest
    const festival = await invoke(page, 'festivals.update', sample.id, { festivalDate: today })
    await invoke(page, 'app.updateSettings', {
      documentsDir: join(ctx.documentsDir, 'Festbüro'),
      setupCompleted: true,
      lastFestivalId: festival.id,
      defaultPrinter: DEMO_PRINTER,
      theme: 'light'
    })
    const printers = await invoke(page, 'printing.listPrinters')
    expect(printers.map((p) => p.name).sort()).toEqual(['Bürodrucker', DEMO_PRINTER])

    const data: DemoContext = {
      festival,
      products: await invoke(page, 'products.list', festival.id),
      clubs: await invoke(page, 'clubs.list', festival.id),
      today
    }
    expect(data.products).toHaveLength(8)
    const numbers = new Map<DemoInvoice, string>()
    for (const demo of DEMO_INVOICES) numbers.set(demo, await finalizeDemo(page, data, demo))

    // --- Festbüro-Maske -----------------------------------------------------------------------
    await gotoRoute(page, '/festbuero', { reload: true })
    await expect(page.getByTestId('festbuero-mask')).toBeVisible()
    await expect(page.getByTestId('position-row')).toHaveCount(8)

    // Suche mit Trefferliste (Tippfehler: „Musterferein“)
    const search = page.getByTestId('club-search')
    await search.click()
    await page.keyboard.type('Musterferein')
    await expect(page.getByTestId('club-results')).toBeVisible()
    await capture(page, '02-vereinssuche')

    // Verein wählen, Personen übernehmen, Mengen der Beispielrechnung eintragen
    await search.fill('')
    await page.keyboard.type('Musterverein Beispielhausen')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('customer-card')).toContainText(MASK_CLUB)
    await expect(page.getByTestId('persons-input')).toBeFocused()
    await page.keyboard.type('45')
    await page.keyboard.press('Enter')
    for (const [i, q] of MASK_QUANTITIES.entries()) {
      await page.keyboard.type(String(q))
      if (i < MASK_QUANTITIES.length - 1) await page.keyboard.press('Tab')
    }
    await expect(page.getByTestId('grand-total')).toHaveText(/^670,20\s€$/)

    await setViewport(ctx, 'large')
    await resetFocusAndScroll(page)
    await expect(page.getByTestId('preview-column').getByTestId('invoice-preview')).toHaveAttribute('data-rendered', 'true')
    await capture(page, '01-festbuero-maske')

    await setViewport(ctx, 'laptop')
    await setTheme(page, 'dark')
    await resetFocusAndScroll(page)
    await capture(page, '16-dunkelmodus')
    await setTheme(page, 'light')

    await setViewport(ctx, 'split')
    await resetFocusAndScroll(page)
    await capture(page, '17-splitscreen')

    // Abschließen & drucken → Erfolgsdialog
    await setViewport(ctx, 'laptop')
    await page.getByTestId('finalize-button').click()
    await expect(page.getByTestId('success-dialog')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('print-status')).toContainText(DEMO_PRINTER)
    await capture(page, '03-abschluss-erfolg')
    await page.getByTestId('new-invoice').click()
    await expect(page.getByTestId('success-dialog')).toBeHidden()

    // --- Rechnungsliste: Storno, Liste, Vorschau ----------------------------------------------
    await gotoRoute(page, '/rechnungen', { reload: true })
    await expect(page.getByTestId('invoice-row')).toHaveCount(DEMO_INVOICES.length + 1)
    const stornoNumber = numbers.get(DEMO_INVOICES.find((d) => d.club === STORNO_CLUB)!)!
    await invoiceRow(page, stornoNumber).getByRole('button', { name: `Aktionen für ${stornoNumber}` }).click()
    await page.getByRole('menuitem', { name: 'Stornieren …' }).click()
    const stornoDialog = page.getByTestId('storno-dialog')
    await expect(stornoDialog).toBeVisible()
    await stornoDialog.getByLabel(/Grund/).fill(STORNO_REASON)
    await stornoDialog.getByLabel(/Grund/).blur()
    await capture(page, '05-storno')
    await stornoDialog.getByRole('button', { name: 'Stornieren', exact: true }).click()
    await expect(stornoDialog).toBeHidden()
    await finalizeDemo(page, data, CORRECTED)

    await gotoRoute(page, '/rechnungen', { reload: true })
    await expect(page.getByTestId('invoice-row')).toHaveCount(DEMO_INVOICES.length + 3)
    await expect(invoiceRow(page, stornoNumber)).toContainText('storniert')
    await capture(page, '04-rechnungsliste')

    // Vorschau im großen Fenster (mehr von der A4-Seite sichtbar)
    await setViewport(ctx, 'large')
    const previewNumber = numbers.get(DEMO_INVOICES.find((d) => d.club === PREVIEW_CLUB)!)!
    await invoiceRow(page, previewNumber).getByRole('button', { name: previewNumber, exact: true }).click()
    const previewDialog = page.getByTestId('preview-dialog')
    await expect(previewDialog).toBeVisible()
    await expect(previewDialog.getByTestId('invoice-preview')).toHaveAttribute('data-rendered', 'true')
    await capture(page, '06-rechnungsvorschau')
    await page.keyboard.press('Escape')
    await expect(previewDialog).toBeHidden()
    await setViewport(ctx, 'laptop')

    // --- Auswertung ---------------------------------------------------------------------------
    await gotoRoute(page, '/auswertung', { reload: true })
    await expect(page.getByTestId('day-row')).toHaveCount(3)
    await expect(page.getByTestId('clubs-without-count')).toHaveText('3')
    await capture(page, '07-auswertung')

    // --- Vereine und Excel-Import -------------------------------------------------------------
    await gotoRoute(page, '/fest/vereine', { reload: true })
    await expect(page.getByTestId('club-row')).toHaveCount(12)
    await capture(page, '08-vereine')

    await stubDialogs(ctx.app, { open: [FIXTURE_XLSX] })
    await page.getByRole('button', { name: 'Aus Excel importieren' }).click()
    const importDialog = page.getByRole('dialog', { name: 'Vereine importieren' })
    await expect(importDialog.getByTestId('club-import-stats')).toBeVisible()
    await expect(importDialog.getByTestId('club-import-errors')).toBeVisible()
    await capture(page, '09-excel-import')
    await importDialog.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(importDialog).toHaveCount(0)

    // --- Fest-Einstellungen -------------------------------------------------------------------
    await gotoRoute(page, '/fest/produkte')
    await expect(page.getByText(PRODUCT_NAMES.alkfrei).first()).toBeVisible()
    await capture(page, '10-produkte')

    await gotoRoute(page, '/fest/zahlarten')
    await expect(page.getByText('Überweisung').first()).toBeVisible()
    await capture(page, '11-zahlungsarten')

    await gotoRoute(page, '/fest/nummern')
    await expect(page.getByLabel(/Präfix/).first()).toBeVisible()
    await capture(page, '12-nummernkreis')

    await setViewport(ctx, 'large')
    await gotoRoute(page, '/fest/vorlage')
    await expect(page.getByTestId('vorlage-page')).toBeVisible()
    await page.getByTestId('vorlage-block-list').getByRole('button', { name: /^Hinweise/ }).click()
    await expect(page.getByTestId('vorlage-preview-pane').getByTestId('invoice-preview')).toHaveAttribute('data-rendered', 'true')
    await capture(page, '13-vorlagen-editor')
    await setViewport(ctx, 'laptop')

    // --- App-Einstellungen --------------------------------------------------------------------
    await gotoRoute(page, '/einstellungen', { reload: true })
    await expect(page.getByRole('heading', { name: 'App-Einstellungen' })).toBeVisible()
    await expect(page.getByTestId('settings-printer-status')).toContainText('Verfügbar')
    // Entwicklungshinweis „Druck wird simuliert“ nur im Bild ausblenden (gehört nicht in die Doku)
    await page.addStyleTag({ content: '[data-testid="settings-dry-run"] { display: none !important; }' })
    await capture(page, '15-app-einstellungen')
  } finally {
    await closeApp(ctx)
  }
})

test('README-Screenshot: Einrichtungsassistent', async () => {
  // frische App ohne Ersteinrichtung
  const ctx = await launchApp({ viewport: 'laptop', env: DOCS_ENV })
  const { page } = ctx
  try {
    await invoke(page, 'app.updateSettings', { theme: 'light' })
    await expect(page.getByRole('heading', { name: 'Willkommen im Festbüro' })).toBeVisible()
    await page.getByTestId('setup-next').click()
    await expect(page.getByTestId('setup-step-documents')).toBeVisible()
    await page.getByTestId('setup-next').click()
    await expect(page.getByTestId('setup-step-printer')).toBeVisible()
    await page.getByRole('radio', { name: DEMO_PRINTER }).click()
    await page.getByTestId('setup-next').click()
    await expect(page.getByTestId('setup-step-festival')).toBeVisible()
    await page.getByLabel('Name des Fests').fill('125 Jahre Musterverein')
    await capture(page, '14-einrichtungsassistent')
  } finally {
    await closeApp(ctx)
  }
})
