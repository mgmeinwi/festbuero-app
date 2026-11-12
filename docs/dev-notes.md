# Entwickler-Notizen

Kurzanleitung für alle, die parallel an der App arbeiten. Verträge und Zuständigkeiten: `docs/architecture.md`.

## Befehle

| Zweck | Befehl |
| --- | --- |
| Typprüfung (Main+Preload+Shared, Renderer, E2E) | `npm run typecheck` |
| … einzeln (zeigt alle Fehler eines Teils) | `npm run typecheck:node` · `npm run typecheck:web` · `npm run typecheck:e2e` |
| Unit-Tests (Vitest über Electrons Node) | `npm test` bzw. `npm test -- src/shared/tax.test.ts` |
| Build | `npm run build` |
| E2E (baut vorher) | `npm run test:e2e` bzw. `npm run test:e2e -- tests/e2e/<datei>.spec.ts` |

`npm run typecheck` bricht beim ersten fehlerhaften Teil ab. Nur eigene Fehler ansehen, z. B.:

```bash
npm run typecheck:web 2>&1 | grep 'src/renderer/src/pages/fest/vorlage'
npm run typecheck:node 2>&1 | grep -E 'src/main/(services|ipc)/clubs'
```

## App isoliert starten (Entwicklung)

Nie mit echten Daten arbeiten. Immer ein eigenes Datenverzeichnis setzen:

```bash
FESTBUERO_USER_DATA="$PWD/.devdata/<bereich>" FESTBUERO_OUT_DIR=out/<bereich> npm run dev
```

- `FESTBUERO_USER_DATA` – App-Datenverzeichnis (DB `festbuero.sqlite`, Logos, Druckprotokoll). `.devdata/` ist in `.gitignore`. Fehlt die Variable, nimmt die unpaketierte App automatisch `.devdata/default`.
- `FESTBUERO_OUT_DIR=out/<bereich>` – eigener Build-Ordner. **Pflicht, wenn mehrere Agents gleichzeitig bauen**, sonst überschreiben sich `out/main`, `out/preload`, `out/renderer` gegenseitig. Gilt für `dev`, `build`, `test:e2e`.
- Als Dokumentenordner in der Ersteinrichtung einen temporären Ordner wählen (z. B. `.devdata/<bereich>/dokumente`).
- Drucken ist unpaketiert immer nur simuliert (Protokoll: `<userData>/print-dry-run.log`). `FESTBUERO_REAL_PRINT` nie setzen.
- `ELECTRON_RUN_AS_NODE` wird für `dev`/`preview` automatisch entfernt (manche Terminals vererben es); `npm test` setzt es bewusst.

## E2E-Tests und Screenshots

Helfer in `tests/e2e/helpers.ts`:

| Funktion | Zweck |
| --- | --- |
| `launchApp(opts?)` | startet die gebaute App mit neuem Temp-Datenverzeichnis, `FESTBUERO_PRINT_DRY_RUN=1`, `FESTBUERO_E2E=1` (Fenster ohne Fokus, keine fremden Programme öffnen, keine Hintergrund-Drosselung) → `{ app, page, userDataDir, documentsDir }`; `opts.viewport` = `'min' \| 'split' \| 'laptop' \| 'large'`; `opts.env` für z. B. `FESTBUERO_FAKE_PRINT_FAIL=1` |
| `buildAppEnv(userDataDir, extra?)` | dieselbe sichere Umgebung für eigene `spawn`-Starts |
| `countCrashReports()` | Anzahl macOS-Absturzberichte (Electron/Festbüro) – vor/nach Tests vergleichen |
| `closeApp(ctx)` | schließt die App, löscht die Temp-Ordner (`FESTBUERO_KEEP_E2E_DATA=1` behält sie) |
| `prepareFestival(page, opts?)` | Dokumentenordner = Temp, Ersteinrichtung erledigt, Fest „Testfest 2025“ angelegt und aktiv, Renderer neu geladen |
| `invoke(page, 'ns.methode', ...args)` | IPC-Aufruf typsicher über `window.festbuero.invoke` |
| `gotoRoute(page, '/fest/vorlage')` | Hash-Navigation (`{ reload: true }` = frischer Query-Cache) |
| `setWindowSize(app, w, h, page?)` | Fenstergröße setzen (inkl. Titelleiste, wie `minWidth/minHeight`) |
| `VIEWPORTS` | `min [600,560]`, `split [740,900]`, `laptop [1280,800]`, `large [1440,900]` |
| `expectNoHorizontalOverflow(page)` | prüft `scrollWidth <= clientWidth` |
| `screenshot(page, name, { hideToasts? })` | wartet auf stabile Darstellung (inkl. Rechnungsvorschau), speichert `test-results/screenshots/<name>.png` |
| `setTheme(page, 'dark' \| 'light')` | Darstellung umschalten |
| `stubDialogs(app, { open: [pfad] \| null, save: pfad \| null })` | native Datei-/Ordnerdialoge im Main ersetzen (`null` = Abbrechen) |

Beispiel für eine eigene Seite (eigene Datei `tests/e2e/<bereich>.spec.ts`):

```ts
import { expect, test } from '@playwright/test'
import { closeApp, expectNoHorizontalOverflow, gotoRoute, launchApp, prepareFestival, screenshot,
  setWindowSize, VIEWPORTS, type ViewportName } from './helpers'

test('Vorlage-Editor bei allen Größen', async () => {
  const ctx = await launchApp()
  await prepareFestival(ctx.page)
  await gotoRoute(ctx.page, '/fest/vorlage')
  for (const name of Object.keys(VIEWPORTS) as ViewportName[]) {
    await setWindowSize(ctx.app, ...VIEWPORTS[name], ctx.page)
    await expectNoHorizontalOverflow(ctx.page)
    await screenshot(ctx.page, `vorlage-editor-${name}`)
  }
  await closeApp(ctx)
})
```

Ausführen und Screenshots ansehen:

```bash
FESTBUERO_OUT_DIR=out/vorlage npm run test:e2e -- tests/e2e/vorlage.spec.ts
# Bilder: test-results/screenshots/vorlage-editor-{min,split,laptop,large}.png (mit dem Read-Tool öffnen)
```

- Screenshot-Namen mit dem eigenen Bereich beginnen (`vorlage-…`, `maske-…`), damit sich parallele Läufe nicht überschreiben.
- Playwright-Artefakte liegen in `test-results/playwright` bzw. mit `FESTBUERO_OUT_DIR` in `test-results/playwright-<bereich>` (wird pro Lauf geleert); `test-results/screenshots/` bleibt erhalten.
- Locator bevorzugt über Rollen/Beschriftungen (`getByRole`, `getByLabel`); Seitenleiste und Menü-Sheet existieren gleichzeitig im DOM, Rollen-Abfragen ignorieren versteckte Elemente.
- Menüeinträge im Test auslösen: `app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()?.getMenuItemById(id)?.click(), 'clubs.import')` (IDs: Aktionsname, `nav:/route`, `festival:<id>`, `printer:<name>`, `theme:dark`); Beispiele in `tests/e2e/shell.spec.ts`.
- `page.waitForFunction(fn, arg, POLL)` mit `POLL` aus den Helfern verwenden (Intervall statt rAF – Testfenster sind inaktiv/verdeckt).
- Stabile Test-IDs der Shell: `app-header`, `app-menu-button` (nur Windows/Linux), `sidebar`, `nav-menu-button` (Navigation ein-/ausblenden), `main-content`, `window-drag-bar`, `festival-switcher`, `festival-new`, `printer-menu`, `printer-warning`, `theme-menu`, `header-settings`, `fest-nav`, `no-festival`, `invoice-preview` (`data-rendered="true"`, sobald das Dokument gerendert ist).

## Responsive prüfen (600×560 · 740×900 · 1280×800 · 1440×900)

- Shell: ≥ 1280 px Seitenleiste mit Text; 1024–1279 px nur Icons (Tooltip); < 1024 px Navigation hinter dem Navigations-Button (Sheet); < 768 px Kopfleiste nur mit Icons (Drucker als Icon-Dropdown). Der Navigations-Button (⌃⌘S) blendet ab 1024 px die Seitenleiste aus/ein.
- Das Fenster scrollt nie. `<main>` scrollt intern. Seiten mit eigenen Scrollbereichen (Maske mit Vorschau, Editor) nutzen `h-full min-h-0` und setzen `overflow-auto` auf die jeweiligen Spalten.
- Lange Namen mit `truncate` + `title`/Tooltip, Flex-Kinder mit `min-w-0`.
- Dialoge haben `max-h` und scrollen intern (`DialogContent` erledigt das).
- In jedem eigenen E2E-Test für alle vier `VIEWPORTS`: `expectNoHorizontalOverflow` + Screenshot ansehen.

## Integrierte Titelleiste

- Das Fenster hat keinen System-Titelbalken (`titleBarStyle: 'hidden'`). Die App-Kopfleiste (`h-12` = 48 px) ist die Titelleiste: macOS-Ampel links (Position `{ x: 18, y: 17 }`), Windows/Linux native Fensterknöpfe rechts (`titleBarOverlay`, Farben folgen dem Theme).
- `<html data-platform="darwin|win32|linux">` und `data-fullscreen="true|false"` stehen im Renderer bereit. Tailwind-Varianten: `mac:`, `nonmac:`, `mac-titlebar:` (macOS mit sichtbarer Ampel). Klasse `.app-titlebar` reserviert links/rechts den Platz für die Fensterknöpfe (CSS-Variablen `--titlebar-inset-left/right`).
- Drag-Region: Klasse `.app-drag` (leere Flächen ziehen das Fenster); Buttons, Links, Eingabefelder darin sind automatisch `no-drag`. Bei offenem Dialog/Sheet ist die Drag-Region abgeschaltet.
- Seiten ohne App-Kopfleiste (z. B. `/setup`) nutzen `<WindowDragBar />` aus `@/components/layout/WindowDragBar`.
- Dialoge halten oben mindestens 48 px Abstand (`max-h-[calc(100vh-6rem)]`); seitliche Sheets beginnen unter Windows/Linux unterhalb der Titelleiste.
- Die Ampel selbst erscheint nicht in Playwright-Screenshots (nativ gezeichnet); der reservierte Platz ist sichtbar.

## Anwendungsmenü und Menüaktionen

Menü in `src/main/menu.ts` (macOS: Menüleiste; Windows/Linux: ☰-Button links in der Kopfleiste öffnet dasselbe Menü als Popup, Tastenkürzel werden dort über `before-input-event` genau einmal ausgelöst). Es baut sich automatisch neu auf bei Änderungen an Festen (`festivals.*`), Druckern, Einstellungen und Menüzustand.

Im Main erledigt (nichts zu tun): Navigation (⌘1–4, ⌘,, Fest-Unterseiten), Fest-Wechsel, Drucker-Wechsel, Erscheinungsbild, Dokumenten-/Datenordner öffnen, Einrichtungsassistent.

Seitenspezifische Aktionen schließt der zuständige Bereich mit einem Hook an:

```tsx
import { useMenuAction } from '@/lib/menu-actions'
import { updateMenuState, useCanFinalize } from '@/lib/menu-state'

useMenuAction('clubs.import', () => startImport())   // solange die Seite gemountet ist
useCanFinalize(canFinalize)                            // Maske: aktiviert „Abschließen & drucken“ / ⌘↩
updateMenuState({ lastInvoiceId: result.invoice.id }) // Maske: nach dem Abschluss
```

Ist kein Handler registriert, navigiert die Shell zur Route der Aktion und stellt sie zu, sobald die Seite ihren Handler registriert (sonst nach 5 s Hinweis „noch nicht verfügbar“). Dieselben Aktionen können auch Buttons auslösen: `dispatchMenuAction(action, navigate)`.

| Aktion | Kürzel (macOS) | Route | Zuständig |
| --- | --- | --- | --- |
| `invoice.new`, `invoice.newEinzel` | ⌘N, ⇧⌘N | `/festbuero` | Maske |
| `invoice.finalize` (+ `useCanFinalize`) | ⌘↩ | `/festbuero` | Maske |
| `preview.toggle` | ⌥⌘P | `/festbuero` | Maske (Vorlage-Editor darf ebenfalls registrieren) |
| `search.focus` | ⌘F | Maske, `/rechnungen`, `/fest/vereine` | jeweilige Seite (Standard: Maske) |
| `invoice.reprintLast`, `invoice.openLastPdf` | ⌘P, ⇧⌘O | – | zentral in der Shell über `lastInvoiceId` (Maske setzt sie); braucht `invoices.print`/`invoices.openPdf` von „Abschluss & Druck“ |
| `clubs.import`, `clubs.exportTemplate` | ⌘I | `/fest/vereine` | Vereine |
| `invoices.exportListExcel`, `invoices.exportZip` | – | `/rechnungen` | Liste & Auswertung |
| `evaluation.exportExcel` | ⇧⌘E | `/auswertung` | Liste & Auswertung |
| `festival.copy` | – | `/fest/allgemein` | Fest-Einstellungen |
| `app.backup` | – | `/einstellungen` | Setup & Auslieferung |
| `printing.testPage` | – | `/einstellungen` | Setup & Auslieferung (Druck: Abschluss & Druck) |
| `festival.new`, `nav.toggle`, `help.shortcuts`, `setup.open` | –, ⌃⌘S, ⌘/ | – | zentral (Basis) |

Wichtig: Kein eigener `keydown`-Listener für Kürzel aus dem Menü (z. B. ⌘↩) – sonst löst es doppelt aus. Neue Aktionen additiv in `MenuAction` (`src/shared/ipc.ts`), Menüeintrag in `src/main/menu.ts`, Route in `ACTION_ROUTES` (`src/renderer/src/lib/menu-actions.ts`). `services/printing.ts#listPrinters()` wird vom Menü genutzt – Signatur beibehalten.

## Sauberes Beenden (keine Absturzberichte)

- Apps in Tests **immer** mit `closeApp(ctx)` (= `app.close()`) beenden, nie per kill. `launchApp()` setzt `FESTBUERO_E2E=1`: Fenster öffnet ohne Fokus (`showInactive`), keine Fokus-Übernahme bei zweitem Start.
- Kontrolle: `countCrashReports()` aus den Helfern bzw. `ls ~/Library/Logs/DiagnosticReports | grep -ciE 'festb|electron'` vor und nach dem Lauf – die Zahl darf nicht steigen (`tests/e2e/lifecycle.spec.ts` prüft das).
- Main: Timer/Intervalle, laufende Kindprozesse (`lp`, SumatraPDF) usw. mit `registerShutdownHook(name, fn)` aus `src/main/lifecycle.ts` aufräumen. Kein `app.exit()`/`process.exit()` im normalen Beenden-Pfad. Die DB schließt `index.ts` genau einmal in `will-quit`.
- Gebaute `.app`/`.exe` nur starten, wenn wirklich nötig, und dann mit `FESTBUERO_USER_DATA=<temp>` und `FESTBUERO_PRINT_DRY_RUN=1`.

## Paketierung (Hinweis für „Setup & Auslieferung“)

- Technischer Produktname in `electron-builder.yml` ist **`Festbuero`** (ASCII), Anzeigename bleibt „Festbüro“ (`package.json#productName` zur Laufzeit, `CFBundleDisplayName`, NSIS-Verknüpfung). Mit „ü“ im Bundle-/Executable-Namen legt electron-builder Executable und Helper-Apps NFD-kodiert an, `CFBundleName` aber NFC – die paketierte macOS-App beendet sich dann sofort mit Absturzbericht (SIGTRAP). Mit ASCII-Namen startet und beendet sie sauber (geprüft mit `electron-builder --mac --dir`).
- Zum lokalen Prüfen ohne Signatur: `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir` (Ausgabe `release/`, in `.gitignore`). electron-builder paketiert `out/main`, `out/preload`, `out/renderer` – vorher `npm run build` **ohne** `FESTBUERO_OUT_DIR`, sonst landet ein alter Stand im Paket. Damit parallele Arbeit nicht gestört wird, am besten in einem APFS-Klon des Projekts bauen (`cp -c -R <projekt> <scratchpad>/klon`, dort `out/` und `release/` löschen, bauen, paketieren).
- Paketierte App im Test starten: `_electron.launch({ executablePath: '<…>/Festbuero.app/Contents/MacOS/Festbuero', env: buildAppEnv(<temp>) })` – `buildAppEnv` setzt u. a. `FESTBUERO_PRINT_DRY_RUN=1`; ohne diese Variable druckt die paketierte App **echt**. Danach `app.close()` und Absturzberichte zählen.
- `npmRebuild: false` (auch `nodeGypRebuild`/`buildDependenciesFromSource: false`): better-sqlite3 bringt N-API-Prebuilds für macOS (x64/arm64) und Windows (x64) mit, die mit jeder Electron-Version laufen. Kein Compiler nötig, `node_modules` bleibt beim Paketieren unverändert, und der **Windows-Cross-Build auf macOS funktioniert** (`npm run dist:win`, lädt vorher SumatraPDF).
- macOS-Signatur: Hook `afterSign: scripts/adhoc-sign-mac.cjs` signiert unsignierte Builds ad-hoc (`codesign --sign -`), sonst meldet macOS die App nach dem Download als „beschädigt“. Mit echtem Zertifikat (`CSC_LINK` …) tut der Hook nichts.

## PDF-Erzeugung (Schnittstelle)

Vorschau und PDF nutzen dasselbe HTML (`src/shared/invoice-render/`):

1. `renderInvoiceHtml({ data, template, logoDataUrl })` → vollständiges A4-HTML mit eingebetteten Schriften (data:-URLs) und einem Inline-Layout-Skript. Abgeschlossene Rechnungen: `data = invoiceToRenderData(invoice)` aus dem Snapshot (`services/pdf.ts#buildInvoiceHtml`).
2. Main (`services/pdf.ts#renderHtmlToPdf`): HTML als **Datei** unter `<userData>/tmp/render-*.html` schreiben und in einem versteckten, sandboxed `BrowserWindow` (eigene Session ohne Netzwerk) per `loadFile` laden – keine riesige data:-URL.
3. Auf `window.__FESTBUERO_RENDER_DONE__ === true` warten (Polling, Zeitlimit 20 s). Das Layout-Skript setzt es, nachdem Schriften/Logo geladen sind, das Dokument ein Layout hat und die Seiten verteilt sind (`window.__FESTBUERO_PAGES__` = Seitenzahl; im Vorschau-iframe zusätzlich `postMessage` `festbuero:rendered`).
4. `webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: 0, preferCSSPageSize: true })`. Jobs laufen nacheinander (Queue), offene Fenster werden beim Beenden zerstört.

- Das Layout-Skript bricht erst um, wenn das Dokument eine Größe hat: Ein frisch eingehängtes oder verborgenes iframe hat kein Layout (alle Maße 0) – früher landete dann jeder Block auf einer eigenen Seite („Seite 1 von 5“, Umbruch nach dem Betreff; Regressionstest in `tests/e2e/vorlage.spec.ts`).
- `FESTBUERO_FAKE_PDF_FAIL=1` (gelesen in `services/pdf.ts#isFakePdfFail`, bei jedem Aufruf neu): PDF-Erzeugung schlägt simuliert fehl – für Tests „Rechnung bleibt gültig, PDF wird beim Öffnen nachgeholt“.

## Druck in Tests und Grenzen der Fehlererkennung

- **Simulierter `E2E-Testdrucker`**: Nur unter Playwright (`FESTBUERO_E2E=1`) hängt `services/printing.ts` ihn an die Druckerliste an; `checkPrinter` meldet ihn immer als bereit, gedruckt wird per Dry-Run. `prepareFestival()` setzt ihn als Standarddrucker; `prepareFestival(page, { printer: null })` = kein Drucker ausgewählt (Warnung in der Kopfleiste). Konstante: `E2E_TEST_PRINTER` in `tests/e2e/helpers.ts`.
- Dry-Run-Protokoll: `<userData>/print-dry-run.log`, eine JSON-Zeile pro Auftrag (`file`, `printer`, `copies`, `ok`). `FESTBUERO_FAKE_PRINT_FAIL=1` lässt den Dry-Run fehlschlagen.
- **Grenzen unter macOS:** `lp` übergibt den Auftrag nur an CUPS und kehrt sofort zurück. Erkannt werden: Drucker existiert nicht, Drucker in CUPS deaktiviert/gestoppt (`lpstat`, `printer-state`), `lp` selbst scheitert. **Nicht** (zuverlässig) erkannt werden ausgeschalteter oder nicht erreichbarer Drucker, Papiermangel und Papierstau – der Auftrag wartet dann in der CUPS-Warteschlange, die App meldet „gedruckt“. Deshalb vor dem Fest mit dem echten Festdrucker testen (Testseite in den Einstellungen).

## Renderer-Bausteine

- Daten: `api.<ns>.<methode>()` aus `@/lib/api` (Fehler = deutsche Meldung; fehlender Handler → „Funktion noch nicht verfügbar: …“), react-query mit Schlüsseln aus `@/hooks/query-keys`.
- Hooks: `useActiveFestival()` → `{ festival, festivalId, festivals, setActiveFestival }`, `useAppSettings()`, `useAppInfo()`, `usePrinters()`, `usePrinterStatus()`, `useBreakpoint('lg')`, `useResolvedTheme()`.
- Festbezogene Seiten sind in `App.tsx` mit `RequireFestival` umschlossen – dort existiert immer ein aktives Fest.
- Seitenrahmen: `PageContainer`, `PageHeader` aus `@/components/layout/PageHeader`.
- UI: shadcn/ui unter `@/components/ui/*` (Buttons 40 px, `size="sm"` 36 px, `size="lg"` 48 px). Toasts: `import { toast } from 'sonner'`.
- `@shared/*` für gemeinsame Logik (Beträge nur über `money.ts`/`tax.ts`).

## Main-Bausteine

- Neuen Handler im eigenen Modul `src/main/ipc/<ns>.ts` in `register()` eintragen: `handle('ns.methode', (...args) => service.fn(...args))` – Typen kommen aus dem Vertrag. `ipc/index.ts` muss nicht geändert werden.
- DB: `getDb()` aus `src/main/db/connection.ts`; Tests: `openDatabase(':memory:')` (migriert) und Services mit `db`-Parameter.
- Pfade/Schalter: `src/main/env.ts` (`getUserDataDir`, `getDbPath`, `getLogosDir`, `getPrintDryRunLogPath`, `isPrintDryRun`, `isFakePrintFail`, `isE2E`); PDF-Fehlersimulation `FESTBUERO_FAKE_PDF_FAIL` in `services/pdf.ts`.
- Hauptfenster/Events: `src/main/window.ts` (`getMainWindow`, `requireMainWindow`, `emitToRenderer`).
- Dateien öffnen: `openPath`/`showItemInFolder` aus `src/main/services/shell.ts` (in E2E nur protokolliert).

## Abhängigkeiten

- `dependencies` = nur Laufzeitpakete des Main-Prozesses (better-sqlite3, exceljs, archiver, date-fns, zod) – werden paketiert und im Main nicht gebündelt.
- Renderer-Pakete (React, Radix, TipTap, dnd-kit, Fuse, Schriften …) stehen in `devDependencies`, weil Vite sie in den Renderer bündelt; so bleibt der Installer klein. Für Imports macht das keinen Unterschied.
- Keine neuen Pakete installieren (gemeinsames `node_modules`), Bedarf im Abschlussbericht melden.
