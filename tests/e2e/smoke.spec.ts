import { expect, test } from '@playwright/test'
import {
  closeApp,
  dismissToasts,
  expectNoHorizontalOverflow,
  gotoRoute,
  invoke,
  launchApp,
  prepareFestival,
  screenshot,
  setTheme,
  setWindowSize,
  VIEWPORTS,
  type AppContext,
  type ViewportName
} from './helpers'

/** Alle Routen laut docs/architecture.md §9 (ohne /setup). */
const ROUTES = [
  '/festbuero',
  '/rechnungen',
  '/auswertung',
  '/fest/allgemein',
  '/fest/nummern',
  '/fest/produkte',
  '/fest/zahlarten',
  '/fest/vereine',
  '/fest/vorlage',
  '/einstellungen'
] as const

const MAIN_LINKS: Array<[string, string]> = [
  ['Festbüro', '/festbuero'],
  ['Rechnungen', '/rechnungen'],
  ['Auswertung', '/auswertung'],
  ['Fest-Einstellungen', '/fest/allgemein'],
  ['App-Einstellungen', '/einstellungen']
]

const FEST_LINKS: Array<[string, string]> = [
  ['Allgemein', '/fest/allgemein'],
  ['Nummern', '/fest/nummern'],
  ['Produkte', '/fest/produkte'],
  ['Zahlarten', '/fest/zahlarten'],
  ['Vereine', '/fest/vereine'],
  ['Vorlage', '/fest/vorlage']
]

async function expectRoute(ctx: AppContext, route: string) {
  await expect.poll(() => ctx.page.evaluate(() => window.location.hash)).toBe(`#${route}`)
  await expect(ctx.page.getByTestId('main-content')).toBeVisible()
}

test.describe.serial('Smoke: App-Start, Navigation, Fest anlegen, Responsive', () => {
  let ctx: AppContext

  test.beforeAll(async () => {
    ctx = await launchApp({ viewport: 'large' })
  })

  test.afterAll(async () => {
    if (ctx) await closeApp(ctx)
  })

  test('startet isoliert im Dry-Run und zeigt die Ersteinrichtung', async () => {
    const info = await invoke(ctx.page, 'app.getInfo')
    expect(info.printDryRun).toBe(true)
    expect(info.isPackaged).toBe(false)
    expect(info.userDataDir).toBe(ctx.userDataDir)

    const settings = await invoke(ctx.page, 'app.getSettings')
    expect(settings.setupCompleted).toBe(false)
    await expect.poll(() => ctx.page.evaluate(() => window.location.hash)).toBe('#/setup')
    await expect(ctx.page.getByRole('heading', { name: 'Willkommen im Festbüro' })).toBeVisible()
    await screenshot(ctx.page, 'smoke-setup')
  })

  test('nicht implementierte Kanäle liefern eine verständliche Meldung', async () => {
    // Bewusst ein Kanal, den es nie geben wird – echte Kanäle werden nach und nach implementiert.
    const message = await ctx.page.evaluate(async () => {
      try {
        await (window.festbuero.invoke as unknown as (c: string) => Promise<unknown>)('diagnose.nieVorhanden')
        return 'kein Fehler'
      } catch (err) {
        return err instanceof Error ? err.message : String(err)
      }
    })
    // Der Renderer-Proxy (lib/api.ts) macht daraus „Funktion noch nicht verfügbar: diagnose.nieVorhanden“
    expect(message).toContain("No handler registered for 'diagnose.nieVorhanden'")
  })

  test('Kopfleiste und Navigation sind sichtbar, alle Routen erreichbar', async () => {
    const festival = await prepareFestival(ctx.page)
    await expect(ctx.page.getByTestId('festival-switcher')).toContainText(festival.name)
    await expect(ctx.page.getByTestId('printer-menu')).toBeVisible()
    await expect(ctx.page.getByTestId('theme-menu')).toBeVisible()
    const sidebar = ctx.page.getByTestId('sidebar')
    await expect(sidebar).toBeVisible()

    for (const [label, route] of MAIN_LINKS) {
      await sidebar.getByRole('link', { name: label, exact: true }).click()
      await expectRoute(ctx, route)
    }

    await sidebar.getByRole('link', { name: 'Fest-Einstellungen', exact: true }).click()
    const festNav = ctx.page.getByTestId('fest-nav')
    for (const [label, route] of FEST_LINKS) {
      await festNav.getByRole('link', { name: label, exact: true }).click()
      await expectRoute(ctx, route)
      await expect(festNav.getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page')
    }

    for (const route of ROUTES) {
      await gotoRoute(ctx.page, route)
      await expectRoute(ctx, route)
      await expect(ctx.page.getByTestId('no-festival')).toHaveCount(0)
    }

    // Menü-Shortcut aus dem Main-Prozess (Ansicht → Rechnungen)
    await ctx.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('app.navigate', { path: '/rechnungen' })
    })
    await expectRoute(ctx, '/rechnungen')

    await gotoRoute(ctx.page, '/festbuero')
    await expect(ctx.page.getByTestId('invoice-preview').locator('iframe')).toBeVisible()
    await screenshot(ctx.page, 'smoke-festbuero-large')
  })

  test('neues Fest über die Kopfleiste anlegen', async () => {
    await ctx.page.getByTestId('festival-switcher').click()
    await ctx.page.getByRole('menuitem', { name: 'Neues Fest anlegen …' }).click()
    const dialog = ctx.page.getByRole('dialog', { name: 'Neues Gründungsfest anlegen' })
    await expect(dialog).toBeVisible()

    await dialog.getByLabel('Name des Fests').fill('Sommerfest mit einem ziemlich langen Namen 2026')
    await dialog.getByLabel('Festdatum').fill('2026-07-04')
    await expect(dialog.getByLabel('Präfix')).toHaveValue('2026-')
    await dialog.getByLabel('Startnummer').fill('5')
    await dialog.getByLabel('Stellenzahl').fill('4')
    await expect(dialog).toContainText('2026-0005')
    await screenshot(ctx.page, 'smoke-new-festival-dialog')
    await dialog.getByRole('button', { name: 'Fest anlegen' }).click()

    await expect(dialog).toBeHidden()
    await expect(ctx.page.getByTestId('festival-switcher')).toContainText('Sommerfest mit einem ziemlich langen Namen 2026')

    const festivals = await invoke(ctx.page, 'festivals.list')
    expect(festivals).toHaveLength(2)
    const created = festivals.find((f) => f.name.startsWith('Sommerfest'))!
    expect(created).toMatchObject({ numberPrefix: '2026-', numberStart: 5, numberDigits: 4, numberNext: 5 })
    const settings = await invoke(ctx.page, 'app.getSettings')
    expect(settings.lastFestivalId).toBe(created.id)

    // zurück zum ersten Fest über das Dropdown
    await ctx.page.getByTestId('festival-switcher').click()
    await ctx.page.getByRole('menuitemradio', { name: /Testfest 2025/ }).click()
    await expect(ctx.page.getByTestId('festival-switcher')).toContainText('Testfest 2025')
    await dismissToasts(ctx.page)
  })

  for (const name of Object.keys(VIEWPORTS) as ViewportName[]) {
    test(`responsiv bei ${name} (${VIEWPORTS[name].join('×')})`, async () => {
      const [w, h] = VIEWPORTS[name]
      const size = await setWindowSize(ctx.app, w, h, ctx.page)
      expect(size.width).toBe(w)

      for (const route of ROUTES) {
        await gotoRoute(ctx.page, route)
        await expect(ctx.page.getByTestId('app-header')).toBeVisible()
        await expectNoHorizontalOverflow(ctx.page)
      }

      // Navigation erreichbar: Seitenleiste ab 1024 px, sonst Menü-Button + Sheet
      await gotoRoute(ctx.page, '/festbuero')
      await expect(ctx.page.getByTestId('nav-menu-button')).toBeVisible()
      if (size.width >= 1024) {
        const sidebar = ctx.page.getByTestId('sidebar')
        await expect(sidebar).toBeVisible()
        await sidebar.getByRole('link', { name: 'Rechnungen', exact: true }).click()
      } else {
        await expect(ctx.page.getByTestId('sidebar')).toBeHidden()
        await ctx.page.getByTestId('nav-menu-button').click()
        const sheet = ctx.page.getByRole('dialog')
        await expect(sheet.getByRole('link', { name: 'Rechnungen', exact: true })).toBeVisible()
        await screenshot(ctx.page, `smoke-nav-sheet-${name}`)
        await sheet.getByRole('link', { name: 'Rechnungen', exact: true }).click()
        await expect(sheet).toBeHidden()
      }
      await expectRoute(ctx, '/rechnungen')

      // Kopfleiste: alle Bedienelemente sichtbar und innerhalb des Fensters
      for (const id of ['festival-switcher', 'printer-menu', 'theme-menu', 'header-settings']) {
        const box = await ctx.page.getByTestId(id).boundingBox()
        expect(box, id).not.toBeNull()
        expect(box!.x).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 0.5)
      }

      // Dialog bleibt bedienbar (max-h + interner Scroll)
      await ctx.page.getByTestId('festival-switcher').click()
      await ctx.page.getByRole('menuitem', { name: 'Neues Fest anlegen …' }).click()
      const dialog = ctx.page.getByRole('dialog', { name: 'Neues Gründungsfest anlegen' })
      await expect(dialog).toBeVisible()
      const dbox = await dialog.boundingBox()
      expect(dbox!.y).toBeGreaterThanOrEqual(0)
      expect(dbox!.y + dbox!.height).toBeLessThanOrEqual(size.height + 0.5)
      await dialog.getByRole('button', { name: 'Fest anlegen' }).scrollIntoViewIfNeeded()
      await expect(dialog.getByRole('button', { name: 'Fest anlegen' })).toBeInViewport()
      await expectNoHorizontalOverflow(ctx.page)
      await screenshot(ctx.page, `smoke-dialog-${name}`)
      await ctx.page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()

      await gotoRoute(ctx.page, '/festbuero')
      await screenshot(ctx.page, `smoke-${name}`)
      await gotoRoute(ctx.page, '/fest/vorlage')
      await expect(ctx.page.getByTestId('fest-nav')).toBeVisible()
      await screenshot(ctx.page, `smoke-fest-${name}`)
    })
  }

  test('kompakte Seitenleiste zwischen lg und xl, per Tastatur bedienbar', async () => {
    const size = await setWindowSize(ctx.app, 1100, 800, ctx.page)
    expect(size.width).toBe(1100)
    await gotoRoute(ctx.page, '/festbuero')
    const sidebar = ctx.page.getByTestId('sidebar')
    await expect(sidebar).toBeVisible()
    expect((await sidebar.boundingBox())!.width).toBeLessThan(80)
    const link = sidebar.getByRole('link', { name: 'Auswertung', exact: true })
    await link.focus()
    await expect(ctx.page.getByRole('tooltip')).toContainText('Auswertung')
    await screenshot(ctx.page, 'smoke-compact-1100')
    await ctx.page.keyboard.press('Enter')
    await expectRoute(ctx, '/auswertung')
    await expectNoHorizontalOverflow(ctx.page)
  })

  test('Hell- und Dunkelmodus', async () => {
    await setWindowSize(ctx.app, ...VIEWPORTS.laptop, ctx.page)
    await gotoRoute(ctx.page, '/festbuero')
    await setTheme(ctx.page, 'dark')
    expect((await invoke(ctx.page, 'app.getSettings')).theme).toBe('dark')
    await screenshot(ctx.page, 'smoke-dark-laptop')
    await setWindowSize(ctx.app, ...VIEWPORTS.min, ctx.page)
    await screenshot(ctx.page, 'smoke-dark-min')
    await setTheme(ctx.page, 'light')
    expect((await invoke(ctx.page, 'app.getSettings')).theme).toBe('light')
  })
})
