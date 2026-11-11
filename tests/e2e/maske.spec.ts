/**
 * E2E: Festbüro-Maske (Bereich „Maske“).
 *
 * Pflichtablauf „Suche → Positionen → Abschluss“ komplett per Tastatur mit den Produkten der
 * Beispielrechnung (Prüfsumme 670,20 €), dazu Einzelrechnung, Personenänderung, Druckfehler,
 * `?from=`/`?club=`-Vorbelegung, Vorschau als Sheet und alle Fenstergrößen hell/dunkel.
 * Alle Daten sind erfunden; gedruckt wird nur simuliert (launchApp setzt FESTBUERO_PRINT_DRY_RUN=1).
 */
import { expect, test, type Page } from '@playwright/test'
import type { Club, Festival, ProductInput } from '../../src/shared/types'
import {
  closeApp,
  countCrashReports,
  E2E_TEST_PRINTER,
  expectNoHorizontalOverflow,
  gotoRoute,
  invoke,
  launchApp,
  POLL,
  prepareFestival,
  screenshot,
  setTheme,
  setWindowSize,
  VIEWPORTS,
  type AppContext,
  type LaunchOptions,
  type ViewportName
} from './helpers'

/** Produkte, Preise und Mengen der Beispielrechnung (laut CLAUDE.md übernehmbar). */
const PRODUCTS: ProductInput[] = [
  { name: '1 Maß Bier (ohne Bedienung)', priceCents: 970, vatRate: 19, mode: 'pro_person', defaultQuantity: 0 },
  { name: 'Brotzeit', priceCents: 800, vatRate: 7, mode: 'pro_person', defaultQuantity: 0 },
  { name: 'Festzeichen', priceCents: 300, vatRate: 19, mode: 'pro_person', defaultQuantity: 0 },
  { name: 'Festessen', priceCents: 1450, vatRate: 7, mode: 'pro_person', defaultQuantity: 0 },
  { name: 'Korsoeinsatz', priceCents: 200, vatRate: 19, mode: 'pro_person', defaultQuantity: 0 },
  { name: 'Käsespätzle', priceCents: 1000, vatRate: 7, mode: 'pro_person', defaultQuantity: 0 },
  { name: 'Festschrift', priceCents: 1500, vatRate: 7, mode: 'feste_anzahl', defaultQuantity: 1 },
  { name: 'Alkoholfreies Getränk (0,5l)', priceCents: 380, vatRate: 19, mode: 'pro_person', defaultQuantity: 0 }
]
const EXAMPLE_QUANTITIES = [0, 0, 45, 18, 0, 13, 1, 34]
const TOTAL_670 = /^670,20\s€$/

const VIEWPORT_NAMES = Object.keys(VIEWPORTS) as ViewportName[]

interface Seeded {
  ctx: AppContext
  page: Page
  festival: Festival
  club: Club
}

/** App starten, Fest mit den 8 Produkten und erfundenen Vereinen anlegen, Maske öffnen. */
async function launchSeeded(opts: LaunchOptions & { taxExempt?: boolean } = {}): Promise<Seeded> {
  const ctx = await launchApp({ viewport: 'laptop', ...opts })
  const { page } = ctx
  const festival = await prepareFestival(page, { festival: { taxExempt: opts.taxExempt ?? true } })
  for (const product of PRODUCTS) await invoke(page, 'products.create', festival.id, product)
  const club = await invoke(page, 'clubs.create', festival.id, {
    contactName: 'Erika Beispiel',
    clubName: 'Musterverein Beispielhausen e.V.',
    street: 'Musterweg 3',
    zip: '01234',
    city: 'Beispielhausen',
    registeredPersons: 45
  })
  await invoke(page, 'clubs.create', festival.id, {
    contactName: 'Max Probe',
    clubName: 'Trachtenverein Talheim',
    street: 'Am Anger 7',
    zip: '54321',
    city: 'Talheim',
    registeredPersons: 30
  })
  await invoke(page, 'clubs.create', festival.id, {
    contactName: 'Anna Test',
    clubName: 'Freiwillige Feuerwehr Bergdorf',
    street: 'Dorfplatz 1',
    zip: '98765',
    city: 'Bergdorf',
    registeredPersons: 22
  })
  await gotoRoute(page, '/festbuero', { reload: true })
  await expect(page.getByTestId('festbuero-mask')).toBeVisible()
  await expect(page.getByTestId('position-row')).toHaveCount(PRODUCTS.length)
  return { ctx, page, festival, club }
}

/** Klickt einen Menüeintrag (wie in der Menüleiste); wartet vorher, bis er aktiv ist. */
async function clickMenuItem(ctx: AppContext, id: string): Promise<void> {
  await expect.poll(() => menuItemEnabled(ctx, id), { message: `Menüeintrag ${id} aktiv` }).toBe(true)
  await ctx.app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu()?.getMenuItemById(itemId)?.click(), id)
}

/** Theme über das Anwendungsmenü (funktioniert auch bei offenem Dialog). */
async function setThemeViaMenu(ctx: AppContext, theme: 'dark' | 'light'): Promise<void> {
  await clickMenuItem(ctx, `theme:${theme}`)
  await ctx.page.waitForFunction(
    (t) => document.documentElement.classList.contains('dark') === (t === 'dark'),
    theme,
    POLL
  )
}

/** Hash-Route setzen, ohne auf die (von der Maske sofort bereinigte) Query zu warten. */
async function setHash(page: Page, route: string): Promise<void> {
  await page.evaluate((r) => {
    window.location.hash = `#${r}`
  }, route)
}

async function menuItemEnabled(ctx: AppContext, id: string): Promise<boolean | null> {
  return ctx.app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu()?.getMenuItemById(itemId)?.enabled ?? null, id)
}

/** Sichtbares Dokument der Vorschau-Spalte (die Vorschau puffert doppelt: aktives iframe hat diesen Titel). */
function previewDocument(page: Page) {
  return page.frameLocator('[data-testid="preview-column"] iframe[title="Rechnungsvorschau"]').locator('body')
}

function quantity(page: Page, productName: string) {
  return page.getByLabel(`Menge ${productName}`, { exact: true })
}

function row(page: Page, productName: string) {
  return page.getByTestId('position-row').filter({ has: quantity(page, productName) })
}

async function quantities(page: Page): Promise<number[]> {
  return page
    .getByTestId('quantity-input')
    .evaluateAll((els) => els.map((el) => Number((el as HTMLInputElement).value)))
}

/** Kunde per Tastatur suchen und mit Enter wählen. */
async function chooseClubByKeyboard(page: Page, query: string): Promise<void> {
  const search = page.getByTestId('club-search')
  await expect(search).toBeFocused()
  await page.keyboard.type(query)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('customer-card')).toBeVisible()
}

/** Alle Größen: kein horizontaler Overflow, Abschlussleiste sichtbar, Screenshot. */
async function checkAllViewports(seeded: Seeded, name: string): Promise<void> {
  const { ctx, page } = seeded
  for (const vp of VIEWPORT_NAMES) {
    const [w, h] = VIEWPORTS[vp]
    await setWindowSize(ctx.app, w, h, page)
    await expectNoHorizontalOverflow(page)
    await expect(page.getByTestId('finalize-button')).toBeInViewport({ ratio: 1 })
    await expect(page.getByTestId('grand-total')).toBeInViewport({ ratio: 1 })
    await screenshot(page, `maske-${name}-${vp}`, { hideToasts: true })
  }
  await setWindowSize(ctx.app, ...VIEWPORTS.laptop, page)
}

let crashReportsBefore = 0
test.beforeAll(() => {
  crashReportsBefore = countCrashReports()
})
test.afterAll(() => {
  expect(countCrashReports(), 'keine neuen Absturzberichte').toBe(crashReportsBefore)
})

test('Pflichtablauf per Tastatur: Suche → Personen → Positionen → Abschluss (670,20 €)', async () => {
  const seeded = await launchSeeded()
  const { ctx, page } = seeded
  try {
    // leere Maske bei allen Größen
    await checkAllViewports(seeded, 'leer')
    await page.getByTestId('club-search').focus()

    // Schritt 1: Suche (fehlertolerant) + Enter
    await chooseClubByKeyboard(page, 'Musterferein')
    await expect(page.getByTestId('customer-card')).toContainText('Musterverein Beispielhausen e.V.')

    // Schritt 2: Personen vorbelegt mit der angemeldeten Zahl, Hinweis daneben
    const persons = page.getByTestId('persons-input')
    await expect(persons).toBeFocused()
    await expect(persons).toHaveValue('45')
    await expect(page.getByTestId('persons-registered')).toHaveText('angemeldet: 45')
    expect(await quantities(page)).toEqual([45, 45, 45, 45, 45, 45, 1, 45])
    await page.keyboard.type('45')
    await page.keyboard.press('Enter')

    // Schritt 3: Mengen, Tab springt nur von Mengenfeld zu Mengenfeld
    await expect(quantity(page, PRODUCTS[0]!.name)).toBeFocused()
    for (const [i, q] of EXAMPLE_QUANTITIES.entries()) {
      await expect(quantity(page, PRODUCTS[i]!.name)).toBeFocused()
      await page.keyboard.type(String(q))
      if (i < EXAMPLE_QUANTITIES.length - 1) await page.keyboard.press('Tab')
    }
    expect(await quantities(page)).toEqual(EXAMPLE_QUANTITIES)

    // Endbetrag und Markierungen (abweichend von der Vorbelegung = von Hand geändert)
    await expect(page.getByTestId('grand-total')).toHaveText(TOTAL_670)
    await expect(page.locator('[data-testid="position-row"][data-manual="true"]')).toHaveCount(6)
    await expect(row(page, 'Festzeichen')).toHaveAttribute('data-manual', 'false')
    await expect(row(page, 'Festschrift')).toHaveAttribute('data-manual', 'false')

    // Vorschau (≥ xl als rechte Spalte) ist gerendert und zeigt den Endbetrag
    const preview = page.getByTestId('preview-column').getByTestId('invoice-preview')
    await expect(preview).toHaveAttribute('data-rendered', 'true')
    await expect(previewDocument(page)).toContainText('670,20')
    await expect(previewDocument(page)).toContainText('Musterverein Beispielhausen e.V.')

    // gefüllte Maske bei allen Größen, hell und dunkel
    await checkAllViewports(seeded, 'gefuellt')
    await setTheme(page, 'dark')
    await checkAllViewports(seeded, 'gefuellt-dunkel')
    await setTheme(page, 'light')

    // ⌘↩ über das Anwendungsmenü
    await quantity(page, PRODUCTS[7]!.name).focus()
    await clickMenuItem(ctx, 'invoice.finalize')
    const dialog = page.getByTestId('success-dialog')
    await expect(dialog).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('success-number')).toContainText('2025-001')
    await expect(page.getByTestId('success-total')).toHaveText(TOTAL_670)
    await expect(page.getByTestId('print-status')).toContainText('Druck simuliert')
    await expect(page.getByTestId('pdf-status')).toBeVisible()
    await expect(page.getByTestId('new-invoice')).toBeFocused()
    expect(await menuItemEnabled(ctx, 'invoice.finalize')).toBe(false)
    await expect.poll(() => menuItemEnabled(ctx, 'invoice.reprintLast')).toBe(true)
    await screenshot(page, 'maske-erfolg-laptop')

    const list = await invoke(page, 'invoices.list', seeded.festival.id)
    expect(list).toHaveLength(1)
    expect(list[0]!.totalGrossCents).toBe(67020)

    // „Neue Rechnung“ (Enter) setzt alles zurück und fokussiert das Suchfeld
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()
    await expect(page.getByTestId('club-search')).toBeFocused()
    await expect(page.getByTestId('grand-total')).toHaveText(/^0,00\s€$/)
    expect(await quantities(page)).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    await expect(page.getByTestId('next-number')).toHaveText('Nr. 2025-002')
    // Verein ist jetzt als abgerechnet markiert
    await expect(page.getByTestId('club-results').getByText('Musterverein Beispielhausen e.V.')).toBeVisible()
    await expect(page.getByRole('option', { name: /Musterverein/ })).toContainText(/abgerechnet/)
  } finally {
    await closeApp(ctx)
  }
})

test('Doppelte Auslösung erzeugt nur eine Rechnung', async () => {
  const seeded = await launchSeeded()
  const { ctx, page } = seeded
  try {
    await chooseClubByKeyboard(page, 'Talheim')
    await expect(page.getByTestId('finalize-button')).toBeEnabled()
    // Doppelklick auf den Button und zusätzlich der Menübefehl
    await page.getByTestId('finalize-button').dblclick()
    await ctx.app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('invoice.finalize')?.click())
    await expect(page.getByTestId('success-dialog')).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(500)
    expect(await invoke(page, 'invoices.list', seeded.festival.id)).toHaveLength(1)
  } finally {
    await closeApp(ctx)
  }
})

test('Einzelrechnung: keine Schnellwahl, alle Mengen 0, Sperre bei 0 €', async () => {
  const seeded = await launchSeeded()
  const { ctx, page } = seeded
  try {
    await clickMenuItem(ctx, 'invoice.newEinzel')
    await expect(page.getByTestId('customer-card')).toContainText('Einzelrechnung')
    await expect(page.getByTestId('step-personen')).toHaveCount(0)
    await expect(page.getByTestId('quick-1')).toHaveCount(0)
    expect(await quantities(page)).toEqual([0, 0, 0, 0, 0, 0, 0, 0])

    // 0 € → gesperrt (Button und Menü)
    await expect(page.getByTestId('finalize-button')).toBeDisabled()
    await expect(page.getByTestId('finalize-blocker')).toContainText('0 €')
    await expect.poll(() => menuItemEnabled(ctx, 'invoice.finalize')).toBe(false)

    // Fokus im ersten Mengenfeld, ↑ erhöht die Menge
    await expect(quantity(page, PRODUCTS[0]!.name)).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await expect(quantity(page, PRODUCTS[0]!.name)).toHaveValue('2')
    await expect(page.getByTestId('grand-total')).toHaveText(/^19,40\s€$/)
    await expect(page.getByTestId('finalize-button')).toBeEnabled()
    await expect.poll(() => menuItemEnabled(ctx, 'invoice.finalize')).toBe(true)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await expect(quantity(page, PRODUCTS[0]!.name)).toHaveValue('0')
    await expect(page.getByTestId('finalize-button')).toBeDisabled()

    // Anschrift optional; Vorschau zeigt sonst „Einzelrechnung“
    await page.getByRole('button', { name: 'Anschrift' }).click()
    await page.getByLabel('Name', { exact: true }).fill('Max Mustergast')
    await page.getByLabel('Ort', { exact: true }).fill('Musterstadt')
    await quantity(page, 'Festessen').fill('2')
    await expect(page.getByTestId('grand-total')).toHaveText(/^29,00\s€$/)
    await expect(previewDocument(page)).toContainText('Max Mustergast')

    // Freie Zusatzposition (Ausnahmefall)
    await page.getByTestId('add-extra').click()
    await expect(page.getByTestId('extra-name')).toBeFocused()
    await expect(page.getByTestId('finalize-button')).toBeDisabled()
    await expect(page.getByTestId('finalize-blocker')).toContainText('Bezeichnung')
    await page.keyboard.type('Tischdekoration')
    await page.getByTestId('extra-price').fill('12,50')
    await expect(page.getByTestId('grand-total')).toHaveText(/^41,50\s€$/)
    await expect(page.getByTestId('finalize-button')).toBeEnabled()

    await checkAllViewports(seeded, 'einzel')
    await setTheme(page, 'dark')
    await setWindowSize(ctx.app, ...VIEWPORTS.min, page)
    await expectNoHorizontalOverflow(page)
    await screenshot(page, 'maske-einzel-dunkel-min', { hideToasts: true })
    await setTheme(page, 'light')
  } finally {
    await closeApp(ctx)
  }
})

test('Personenänderung: unveränderte Zeilen folgen, Handänderungen bleiben', async () => {
  const seeded = await launchSeeded({ taxExempt: false })
  const { ctx, page } = seeded
  try {
    await chooseClubByKeyboard(page, 'Beispielhausen')
    await page.keyboard.press('Enter') // Personen 45 übernehmen → Positionen

    // Handänderung per Eingabe und per Schnellwahl (Maus)
    await quantity(page, 'Festessen').fill('18')
    await row(page, PRODUCTS[0]!.name).getByTestId('quick-2').click()
    await row(page, 'Brotzeit').getByTestId('quick-0').click()
    await expect(quantity(page, PRODUCTS[0]!.name)).toHaveValue('90')
    await expect(row(page, PRODUCTS[0]!.name)).toHaveAttribute('data-manual', 'true')
    await expect(page.getByTestId('manual-count')).toHaveText('3 Zeilen von Hand geändert')

    // Personen 45 → 50
    const persons = page.getByTestId('persons-input')
    await persons.focus()
    await page.keyboard.type('50')
    await expect(persons).toHaveValue('50')
    expect(await quantities(page)).toEqual([90, 0, 50, 18, 50, 50, 1, 50])
    await expect(page.getByTestId('persons-registered')).toHaveText('angemeldet: 45')

    // Zurücksetzen: Zeile folgt wieder den Personen
    await row(page, 'Festessen').getByTestId('reset-line').click()
    await expect(quantity(page, 'Festessen')).toHaveValue('50')
    await expect(row(page, 'Festessen')).toHaveAttribute('data-manual', 'false')

    // ↑ im Mengenfeld ändert die Menge (und markiert die Zeile)
    await quantity(page, 'Festzeichen').focus()
    await page.keyboard.press('ArrowUp')
    await expect(quantity(page, 'Festzeichen')).toHaveValue('51')
    await expect(row(page, 'Festzeichen')).toHaveAttribute('data-manual', 'true')

    // ohne Steuerbefreiung: Netto und MwSt je Satz
    await expect(page.getByTestId('tax-summary')).toContainText(/netto [\d.]+,\d\d\s€/)
    await expect(page.getByTestId('tax-summary')).toContainText(/MwSt 7 % [\d.]+,\d\d\s€ · 19 % [\d.]+,\d\d\s€/)

    // Datum ändern ist der Ausnahmefall: klein, aufklappbar, Änderung deutlich sichtbar
    await page.getByRole('button', { name: 'Datum ändern' }).click()
    await page.getByLabel('Leistungsdatum', { exact: true }).fill('2025-05-31')
    await expect(page.getByTestId('date-changed')).toContainText('31.05.2025')
    await expect(previewDocument(page)).toContainText('31. Mai 2025')

    await setWindowSize(ctx.app, ...VIEWPORTS.split, page)
    await expectNoHorizontalOverflow(page)
    await screenshot(page, 'maske-personen-split', { hideToasts: true })
    await setWindowSize(ctx.app, ...VIEWPORTS.min, page)
    await expectNoHorizontalOverflow(page)
    await expect(page.getByTestId('finalize-button')).toBeInViewport({ ratio: 1 })
    await screenshot(page, 'maske-personen-min', { hideToasts: true })
  } finally {
    await closeApp(ctx)
  }
})

test('Druckfehler: Rechnung bleibt gültig, Hinweis mit „Erneut drucken“ und Druckerauswahl', async () => {
  const seeded = await launchSeeded({ env: { FESTBUERO_FAKE_PRINT_FAIL: '1' } })
  const { ctx, page } = seeded
  try {
    await chooseClubByKeyboard(page, 'Feuerwehr')
    await page.getByTestId('finalize-button').click()
    const dialog = page.getByTestId('success-dialog')
    await expect(dialog).toBeVisible({ timeout: 20_000 })
    const error = page.getByTestId('print-error')
    await expect(error).toBeVisible()
    await expect(error).toContainText('Drucken fehlgeschlagen')
    await expect(error).toContainText('trotzdem gültig')
    await expect(dialog.getByRole('combobox', { name: 'Drucker für den erneuten Druck' })).toContainText(
      E2E_TEST_PRINTER
    )
    await expect(page.getByTestId('new-invoice')).toBeFocused()
    expect(await invoke(page, 'invoices.list', seeded.festival.id)).toHaveLength(1)

    await page.getByTestId('retry-print').click()
    await expect(page.locator('[data-sonner-toast]').first()).toBeVisible()
    await expect(error).toBeVisible()

    await screenshot(page, 'maske-druckfehler-laptop', { hideToasts: true })
    await setWindowSize(ctx.app, ...VIEWPORTS.min, page)
    await expectNoHorizontalOverflow(page)
    await expect(page.getByTestId('new-invoice')).toBeInViewport({ ratio: 1 })
    await expect(page.getByTestId('retry-print')).toBeInViewport({ ratio: 1 })
    await expect(error.getByText('Drucken fehlgeschlagen')).toBeInViewport({ ratio: 1 })
    await screenshot(page, 'maske-druckfehler-min', { hideToasts: true })
    await setThemeViaMenu(ctx, 'dark')
    await screenshot(page, 'maske-druckfehler-dunkel-min', { hideToasts: true })
  } finally {
    await closeApp(ctx)
  }
})

test('Vorbelegung über ?from= (Korrektur) und ?club=', async () => {
  const seeded = await launchSeeded()
  const { ctx, page, festival, club } = seeded
  try {
    const products = await invoke(page, 'products.list', festival.id)
    const byName = new Map(products.map((p) => [p.name, p]))
    const line = (name: string, quantity: number) => {
      const p = byName.get(name)!
      return { productId: p.id, name: p.name, priceCents: p.priceCents, vatRate: p.vatRate, quantity }
    }
    const original = await invoke(page, 'invoices.finalize', {
      festivalId: festival.id,
      customer: {
        kind: 'verein',
        clubId: club.id,
        contactName: club.contactName,
        clubName: club.clubName,
        street: club.street,
        zip: club.zip,
        city: club.city,
        registeredPersons: club.registeredPersons
      },
      persons: 40,
      paymentKind: 'ueberweisung',
      invoiceDate: '2025-06-01',
      serviceDate: festival.festivalDate,
      lines: [
        line('Festzeichen', 40),
        line('Festessen', 12),
        line('Festschrift', 1),
        { productId: null, name: 'Sonderposten Musik', priceCents: 2500, vatRate: 19, quantity: 1 }
      ]
    })

    await setHash(page, `/festbuero?from=${original.invoice.id}`)
    await expect(page.getByTestId('correction-banner')).toContainText(
      `Korrektur von Rechnung Nr. ${original.invoice.number}`
    )
    await expect(page.getByTestId('customer-card')).toContainText(club.clubName)
    await expect(page.getByTestId('persons-input')).toHaveValue('40')
    await expect(page.getByRole('radio', { name: 'Überweisung' })).toBeChecked()
    await expect(quantity(page, 'Festzeichen')).toHaveValue('40')
    await expect(quantity(page, 'Festessen')).toHaveValue('12')
    await expect(row(page, 'Festessen')).toHaveAttribute('data-manual', 'true')
    await expect(row(page, 'Festzeichen')).toHaveAttribute('data-manual', 'true')
    // nicht in der alten Rechnung → normal vorbelegt
    await expect(quantity(page, 'Brotzeit')).toHaveValue('40')
    await expect(row(page, 'Brotzeit')).toHaveAttribute('data-manual', 'false')
    // Position ohne Produkt → Zusatzposition
    await expect(page.getByTestId('extra-name')).toHaveValue('Sonderposten Musik')
    await expect(page.getByTestId('grand-total')).toHaveText(/\d/)
    await setWindowSize(ctx.app, ...VIEWPORTS.split, page)
    await expectNoHorizontalOverflow(page)
    await screenshot(page, 'maske-korrektur-split', { hideToasts: true })
    await setWindowSize(ctx.app, ...VIEWPORTS.laptop, page)

    // ?club= wählt den Verein vor
    await clickMenuItem(ctx, 'invoice.new')
    const other = (await invoke(page, 'clubs.list', festival.id)).find((c) => c.clubName === 'Trachtenverein Talheim')!
    await setHash(page, `/festbuero?club=${other.id}`)
    await expect(page.getByTestId('customer-card')).toContainText('Trachtenverein Talheim')
    await expect(page.getByTestId('persons-input')).toHaveValue('30')
    await expect(page.getByTestId('persons-input')).toBeFocused()
    await expect(page.getByTestId('correction-banner')).toHaveCount(0)
  } finally {
    await closeApp(ctx)
  }
})

test('Vorschau: rechte Spalte ab xl (einklappbar), darunter als Sheet', async () => {
  const seeded = await launchSeeded()
  const { ctx, page } = seeded
  try {
    await chooseClubByKeyboard(page, 'Musterverein')
    // ≥ xl: Spalte, per ⌥⌘P einklappbar
    await expect(page.getByTestId('preview-column')).toBeVisible()
    await clickMenuItem(ctx, 'preview.toggle')
    await expect(page.getByTestId('preview-column')).toHaveCount(0)
    await screenshot(page, 'maske-ohne-vorschau-laptop', { hideToasts: true })
    await clickMenuItem(ctx, 'preview.toggle')
    await expect(page.getByTestId('preview-column')).toBeVisible()

    // 740 px: standardmäßig zu, öffnet sich per Button als Sheet
    await setWindowSize(ctx.app, ...VIEWPORTS.split, page)
    await expect(page.getByTestId('preview-column')).toHaveCount(0)
    await expect(page.getByTestId('preview-sheet')).toHaveCount(0)
    await page.getByTestId('preview-toggle').click()
    const sheet = page.getByTestId('preview-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet.getByTestId('invoice-preview')).toHaveAttribute('data-rendered', 'true')
    await expectNoHorizontalOverflow(page)
    await screenshot(page, 'maske-vorschau-sheet-split')
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()

    // ⌥⌘P öffnet das Sheet ebenfalls (auch bei 600 × 560)
    await setWindowSize(ctx.app, ...VIEWPORTS.min, page)
    await clickMenuItem(ctx, 'preview.toggle')
    await expect(page.getByTestId('preview-sheet')).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await screenshot(page, 'maske-vorschau-sheet-min')
    await setThemeViaMenu(ctx, 'dark')
    await screenshot(page, 'maske-vorschau-sheet-dunkel-min')
  } finally {
    await closeApp(ctx)
  }
})

test('Suche: Trefferliste mit Tastatur, ⌘F und „Ändern“', async () => {
  const seeded = await launchSeeded()
  const { ctx, page } = seeded
  try {
    const search = page.getByTestId('club-search')
    await expect(search).toBeFocused()
    await expect(search).toHaveAttribute('role', 'combobox')
    await expect(page.getByRole('option')).toHaveCount(3)
    // ohne Suchbegriff ist nichts vorausgewählt – ein versehentliches Enter wählt keinen Verein
    await expect(search).not.toHaveAttribute('aria-activedescendant', /.+/)
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('customer-card')).toHaveCount(0)
    // ↓ wählt den ersten Treffer
    await page.keyboard.press('ArrowDown')
    const activeId = await search.getAttribute('aria-activedescendant')
    expect(activeId).toBeTruthy()
    await expect(page.locator(`[id="${activeId}"]`)).toHaveAttribute('aria-selected', 'true')
    // PLZ-Suche
    await page.keyboard.type('5432')
    await expect(page.getByRole('option').first()).toContainText('Trachtenverein Talheim')
    await screenshot(page, 'maske-suche-laptop')
    await setWindowSize(ctx.app, ...VIEWPORTS.min, page)
    await expectNoHorizontalOverflow(page)
    await screenshot(page, 'maske-suche-min')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('customer-card')).toContainText('Trachtenverein Talheim')

    // ⌘F öffnet die Suche erneut; Escape bricht ab, der Kunde bleibt
    await clickMenuItem(ctx, 'search.focus')
    await expect(search).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('customer-card')).toContainText('Trachtenverein Talheim')
    // „Ändern“ → anderer Verein
    await page.getByRole('button', { name: 'Kunde ändern' }).click()
    await expect(search).toBeFocused()
    await page.keyboard.type('Bergdorf')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('customer-card')).toContainText('Freiwillige Feuerwehr Bergdorf')
    await expect(page.getByTestId('persons-input')).toHaveValue('22')

    // ⌘N setzt zurück (mit „Rückgängig“)
    await clickMenuItem(ctx, 'invoice.new')
    await expect(search).toBeFocused()
    await expect(page.getByTestId('customer-card')).toHaveCount(0)
    await page.locator('[data-sonner-toast]').getByRole('button', { name: 'Rückgängig' }).click()
    await expect(page.getByTestId('customer-card')).toContainText('Freiwillige Feuerwehr Bergdorf')
  } finally {
    await closeApp(ctx)
  }
})
