import { expect, test } from '@playwright/test'
import {
  closeApp,
  expectNoHorizontalOverflow,
  gotoRoute,
  invoke,
  launchApp,
  POLL,
  prepareFestival,
  screenshot,
  setWindowSize,
  VIEWPORTS,
  type AppContext,
  type ViewportName
} from './helpers'

const isMac = process.platform === 'darwin'

async function hashOf(ctx: AppContext) {
  return ctx.page.evaluate(() => window.location.hash)
}

/** Klickt einen Menüeintrag über seine ID im Main-Prozess (wie ein Klick in der Menüleiste). */
async function clickMenuItem(ctx: AppContext, id: string) {
  const found = await ctx.app.evaluate(({ Menu }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId)
    if (!item) return false
    item.click()
    return true
  }, id)
  expect(found, `Menüeintrag ${id}`).toBe(true)
}

async function menuItemState(ctx: AppContext, id: string) {
  return ctx.app.evaluate(({ Menu }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId)
    return item ? { enabled: item.enabled, checked: item.checked, label: item.label } : null
  }, id)
}

test.describe.serial('Shell: integrierte Titelleiste und Anwendungsmenü', () => {
  let ctx: AppContext

  test.beforeAll(async () => {
    ctx = await launchApp({ viewport: 'laptop' })
    await prepareFestival(ctx.page)
  })

  test.afterAll(async () => {
    if (ctx) await closeApp(ctx)
  })

  test('Kopfleiste ist Titelleiste: 48 px, Drag-Region, Platz für Fensterknöpfe', async () => {
    const header = ctx.page.getByTestId('app-header')
    const info = await header.evaluate((el) => {
      const cs = getComputedStyle(el)
      const button = el.querySelector('button') as HTMLElement
      return {
        height: el.getBoundingClientRect().height,
        region: cs.getPropertyValue('-webkit-app-region'),
        buttonRegion: getComputedStyle(button).getPropertyValue('-webkit-app-region'),
        paddingLeft: parseFloat(cs.paddingLeft),
        platform: document.documentElement.dataset.platform
      }
    })
    expect(info.height).toBe(48)
    expect(info.region).toBe('drag')
    expect(info.buttonRegion).toBe('no-drag')
    expect(info.platform).toBe(process.platform === 'win32' ? 'win32' : isMac ? 'darwin' : 'linux')

    const win = await ctx.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]!
      return {
        background: w.getBackgroundColor(),
        buttons: process.platform === 'darwin' ? w.getWindowButtonPosition() : null
      }
    })
    expect(win.background.toLowerCase()).toBe('#fbfcfd')
    if (isMac) {
      expect(info.paddingLeft).toBeGreaterThanOrEqual(76)
      // Ampel (≈ 14 px) vertikal mittig in der 48 px hohen Kopfleiste
      expect(win.buttons).toEqual({ x: 18, y: 17 })
    }
  })

  test('Vollbild: Platz für die Ampel entfällt', async () => {
    test.skip(!isMac, 'nur macOS')
    const header = ctx.page.getByTestId('app-header')
    await ctx.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]!.webContents.send('window.state', { fullscreen: true })
    })
    await expect.poll(() => header.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft))).toBeLessThan(16)
    await ctx.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]!.webContents.send('window.state', { fullscreen: false })
    })
    await expect.poll(() => header.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft))).toBeGreaterThanOrEqual(76)
  })

  test('offener Dialog deaktiviert die Drag-Region (Klicks gehen nicht verloren)', async () => {
    await ctx.page.getByTestId('festival-switcher').click()
    await ctx.page.getByRole('menuitem', { name: 'Neues Fest anlegen …' }).click()
    await expect(ctx.page.getByRole('dialog')).toBeVisible()
    const region = await ctx.page
      .getByTestId('app-header')
      .evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region'))
    expect(region).toBe('no-drag')
    await ctx.page.keyboard.press('Escape')
    await expect(ctx.page.getByRole('dialog')).toBeHidden()
  })

  test('Menüleiste: Struktur und deutsche Beschriftungen', async () => {
    const labels = await ctx.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.map((i) => i.label))
    expect(labels).toEqual(
      isMac
        ? ['Festbüro', 'Ablage', 'Bearbeiten', 'Fest', 'Darstellung', 'Drucker', 'Fenster', 'Hilfe']
        : ['Datei', 'Bearbeiten', 'Fest', 'Ansicht', 'Drucker', 'Fenster', 'Hilfe']
    )
    // Abschließen nur aktiv, wenn die Maske es meldet
    expect((await menuItemState(ctx, 'invoice.finalize'))?.enabled).toBe(false)
    await invoke(ctx.page, 'app.updateMenuState', { route: '/festbuero', canFinalize: true, lastInvoiceId: 7 })
    await expect.poll(async () => (await menuItemState(ctx, 'invoice.finalize'))?.enabled).toBe(true)
    expect((await menuItemState(ctx, 'invoice.reprintLast'))?.enabled).toBe(true)
    await invoke(ctx.page, 'app.updateMenuState', { route: '/festbuero', canFinalize: false, lastInvoiceId: null })
    await expect.poll(async () => (await menuItemState(ctx, 'invoice.finalize'))?.enabled).toBe(false)
  })

  test('Menü: Navigation, Fest-Wechsel, Erscheinungsbild', async () => {
    await clickMenuItem(ctx, 'nav:/rechnungen')
    await expect.poll(() => hashOf(ctx)).toBe('#/rechnungen')
    await clickMenuItem(ctx, 'nav:/fest/produkte')
    await expect.poll(() => hashOf(ctx)).toBe('#/fest/produkte')

    const second = await invoke(ctx.page, 'festivals.create', {
      name: 'Herbstfest 2026',
      festivalDate: '2026-10-03',
      numberPrefix: '2026-',
      numberStart: 1,
      numberDigits: 3
    })
    // Menü wird nach festivals.create neu aufgebaut
    await expect.poll(async () => (await menuItemState(ctx, `festival:${second.id}`))?.label).toBe('Herbstfest 2026')
    await clickMenuItem(ctx, `festival:${second.id}`)
    await expect(ctx.page.getByTestId('festival-switcher')).toContainText('Herbstfest 2026')
    expect((await invoke(ctx.page, 'app.getSettings')).lastFestivalId).toBe(second.id)
    await expect.poll(async () => (await menuItemState(ctx, `festival:${second.id}`))?.checked).toBe(true)

    await clickMenuItem(ctx, 'theme:dark')
    await ctx.page.waitForFunction(() => document.documentElement.classList.contains('dark'), undefined, POLL)
    const dark = await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBackgroundColor())
    expect(dark.toLowerCase()).toBe('#0c1015')
    await gotoRoute(ctx.page, '/festbuero')
    await screenshot(ctx.page, 'shell-dark-laptop', { hideToasts: true })
    await clickMenuItem(ctx, 'theme:light')
    await ctx.page.waitForFunction(() => !document.documentElement.classList.contains('dark'), undefined, POLL)
  })

  test('Menüaktionen: zentral (Neues Fest, Kurzbefehle) und mit Navigation zur zuständigen Seite', async () => {
    await clickMenuItem(ctx, 'festival.new')
    await expect(ctx.page.getByRole('dialog', { name: 'Neues Gründungsfest anlegen' })).toBeVisible()
    await ctx.page.keyboard.press('Escape')

    await clickMenuItem(ctx, 'help.shortcuts')
    const shortcuts = ctx.page.getByRole('dialog', { name: 'Tastaturkurzbefehle' })
    await expect(shortcuts).toBeVisible()
    await expect(shortcuts).toContainText('Abschließen & drucken')
    await screenshot(ctx.page, 'shell-shortcuts-laptop')
    await ctx.page.keyboard.press('Escape')

    // Ohne registrierten Handler: zur zuständigen Route navigieren (Seite stellt die Aktion zu)
    await gotoRoute(ctx.page, '/rechnungen')
    await clickMenuItem(ctx, 'clubs.import')
    await expect.poll(() => hashOf(ctx)).toBe('#/fest/vereine')
    await clickMenuItem(ctx, 'evaluation.exportExcel')
    await expect.poll(() => hashOf(ctx)).toBe('#/auswertung')
  })

  test('Navigation ein-/ausblenden (Seitenleiste ab lg)', async () => {
    const sidebar = ctx.page.getByTestId('sidebar')
    await expect(sidebar).toBeVisible()
    await clickMenuItem(ctx, 'nav.toggle')
    await expect(sidebar).toBeHidden()
    await ctx.page.getByTestId('nav-menu-button').click()
    await expect(sidebar).toBeVisible()
  })

  test('Seitenwechsel beginnt oben (Fest-Unterseiten und Hauptbereich)', async () => {
    const { page } = ctx
    const festival = (await invoke(page, 'festivals.list'))[0]!
    for (let i = 1; i <= 12; i++) {
      await invoke(page, 'clubs.create', festival.id, {
        contactName: `Person ${i}`,
        clubName: `Musterverein ${String(i).padStart(2, '0')}`,
        street: 'Musterweg 1',
        zip: '01234',
        city: 'Musterstadt',
        registeredPersons: 10 + i
      })
    }
    await setWindowSize(ctx.app, ...VIEWPORTS.min, page)
    const scrollTop = (testId: string) => page.getByTestId(testId).evaluate((el) => el.scrollTop)

    // Fest-Einstellungen: Inhalt unter der Tab-Leiste (Vereine setzt die Position nicht selbst zurück)
    await gotoRoute(page, '/fest/allgemein', { reload: true })
    const content = page.getByTestId('fest-content')
    await expect(content).toBeVisible()
    await content.evaluate((el) => el.scrollTo(0, el.scrollHeight))
    await expect.poll(() => scrollTop('fest-content')).toBeGreaterThan(0)
    await page.getByTestId('fest-nav').getByRole('link', { name: 'Vereine' }).click()
    await expect(page.getByText('Musterverein 12', { exact: true }).filter({ visible: true }).first()).toBeVisible()
    expect(await content.evaluate((el) => el.scrollHeight > el.clientHeight), 'Vereine-Seite scrollbar').toBe(true)
    await expect.poll(() => scrollTop('fest-content')).toBe(0)

    // Hauptbereich: App-Einstellungen (weit unten) → Auswertung beginnt oben
    await gotoRoute(page, '/einstellungen')
    const main = page.getByTestId('main-content')
    await main.evaluate((el) => el.scrollTo(0, el.scrollHeight))
    await expect.poll(() => scrollTop('main-content')).toBeGreaterThan(0)
    await gotoRoute(page, '/auswertung')
    await expect(page.getByTestId('evaluation-kpis')).toBeVisible()
    expect(await main.evaluate((el) => el.scrollHeight > el.clientHeight), 'Auswertung scrollbar').toBe(true)
    await expect.poll(() => scrollTop('main-content')).toBe(0)
    await setWindowSize(ctx.app, ...VIEWPORTS.laptop, page)
  })

  test('Dialoge überblenden nur per Animation (keine Transition auf Größen)', async () => {
    const { page } = ctx
    await gotoRoute(page, '/festbuero')
    await page.getByTestId('festival-switcher').click()
    await page.getByTestId('festival-new').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const transition = await dialog.evaluate((el) => getComputedStyle(el).transitionProperty)
    expect(transition).toBe('none')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  for (const name of Object.keys(VIEWPORTS) as ViewportName[]) {
    test(`Titelleiste bei ${name}`, async () => {
      const [w, h] = VIEWPORTS[name]
      const size = await setWindowSize(ctx.app, w, h, ctx.page)
      await gotoRoute(ctx.page, '/festbuero')
      await expectNoHorizontalOverflow(ctx.page)
      // Bedienelemente liegen rechts neben der Ampel und innerhalb des Fensters
      for (const id of ['nav-menu-button', 'festival-switcher', 'printer-menu', 'theme-menu', 'header-settings']) {
        const box = await ctx.page.getByTestId(id).boundingBox()
        expect(box, id).not.toBeNull()
        if (isMac) expect(box!.x, id).toBeGreaterThanOrEqual(76)
        expect(box!.x + box!.width, id).toBeLessThanOrEqual(size.width + 0.5)
      }
      await screenshot(ctx.page, `shell-titlebar-${name}`, { hideToasts: true })
    })
  }
})
