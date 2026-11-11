# Architektur & Verträge

Dieses Dokument ist der verbindliche Vertrag für alle, die an der App arbeiten. Fachliche Details stehen in der Spezifikation (`Festbüro-Software – Spezifikation.md`).

## 1. Stack

- **Electron + TypeScript**, Build mit **electron-vite** (Main, Preload, Renderer).
- **Renderer**: React 19, Vite, Tailwind CSS v4, shadcn/ui (Radix), lucide-react, sonner (Toasts), react-router (HashRouter, wegen `file://`), @tanstack/react-query (IPC-Daten, Invalidierung), Fuse.js (Suche), @dnd-kit (Sortierung), TipTap (Rich Text).
- **Main**: better-sqlite3, exceljs, archiver, date-fns (de).
- **Tests**: Vitest (läuft via `ELECTRON_RUN_AS_NODE=1`, damit better-sqlite3 dieselbe ABI hat), Playwright `_electron`.
- **Installer**: electron-builder → `.dmg` (universal) und NSIS `.exe` (x64). SumatraPDF wird nur im Windows-Build mitgeliefert.

## 2. Ordnerstruktur

```
src/
  shared/                     plattformneutral (Main + Renderer)
    types.ts                  Domänentypen (VERTRAG)
    ipc.ts                    IPC-Vertrag FestbueroApi (VERTRAG)
    money.ts                  formatEuro, formatEuroOrDash, parseEuroToCents
    tax.ts                    calculateLineTotal, calculateTotals (Rundung pro Steuersatz auf Rechnungsebene)
    numbering.ts              formatInvoiceNumber(prefix, seq, digits)
    dates.ts                  todayIso, addDays, formatDate(iso, variant|pattern)
    placeholders.ts           PLACEHOLDERS (Definitionen), buildPlaceholderValues, replacePlaceholders
    filename.ts               buildPdfFileName, sanitizeFileName, validateFilenamePattern
    invoice-draft.ts          Vorbelegung der Positionen (pro Person / feste Anzahl / Schnellwahl)
    invoice-render/           Vorlagen-Renderer: TemplateConfig + InvoiceRenderData -> HTML (A4)
      index.ts                renderInvoiceHtml(...) – EINZIGE Quelle für Vorschau UND PDF
      default-template.ts     getDefaultTemplateConfig() – nach Muster der Beispielrechnung
      fonts.ts                gebündelte Schriften (FontId -> @font-face)
      sample-data.ts          Beispieldaten für Editor-Vorschau und Testseite
  main/
    index.ts                  App-Start, Fenster, Single-Instance, userData-Override
    db/
      migrations.ts           versionierte Migrationen (VERTRAG)
      connection.ts           openDatabase(path), runMigrations(db), getDb()
      repositories/*.ts       SQL pro Tabelle (Row <-> Domänentyp)
    services/*.ts             Fachlogik (festivals, products, clubs, club-import, templates,
                              finalize, pdf, filing, printing, storno, invoice-export, evaluation,
                              evaluation-export, backup, sample-data, settings)
    ipc/
      handle.ts               typsicherer handle('<ns>.<methode>', fn)
      index.ts                registerAllIpc() – importiert alle Module unten
      app.ts festivals.ts products.ts paymentMethods.ts clubs.ts templates.ts
      invoices.ts printing.ts evaluation.ts
  preload/
    index.ts                  exponiert window.festbuero = { invoke(channel, ...args), on(event, cb) }
  renderer/
    index.html
    src/
      main.tsx App.tsx        Router, QueryClient, Theme, Toaster
      lib/api.ts              typsicherer Proxy: api.<ns>.<methode>() -> invoke('<ns>.<methode>')
      lib/utils.ts            cn() etc.
      components/ui/          shadcn/ui-Komponenten
      components/layout/      AppShell, Kopfleiste (Fest-Auswahl, Druckerauswahl, Warnung), Navigation
      components/invoice-preview/InvoicePreview.tsx   A4-Vorschau (iframe) – genutzt von Maske, Editor, Liste
      hooks/                  useActiveFestival, useAppSettings, ...
      pages/
        festbuero/            Festbüro-Maske
        rechnungen/           Rechnungsliste, Storno
        auswertung/           Auswertung
        fest/                 Fest-Einstellungen: allgemein, nummern, produkte, zahlarten, vereine, vorlage
        einstellungen/        App-Einstellungen
        setup/                Ersteinrichtungs-Assistent
tests/
  e2e/                        Playwright-Tests + Helfer (launchApp mit temp userData)
  fixtures/                   erfundene Testdateien (z. B. vereine-beispiel.xlsx)
resources/
  sample/beispiel-logo.jpg    Vereinswappen für die Beispielvorlage
  win/                        SumatraPDF (wird per Skript geladen, nicht eingecheckt)
```

## 3. IPC-Mechanik

- `src/shared/ipc.ts` definiert `FestbueroApi` (Namespaces → Methoden, alle async).
- **Preload** exponiert nur generisch `window.festbuero.invoke(channel: string, ...args)` und `window.festbuero.on(event, cb) → unsubscribe`. Der Preload wird von Feature-Arbeit nie angefasst.
- **Renderer** `lib/api.ts`: `export const api: FestbueroApi` als Proxy; `api.festivals.list()` → `invoke('festivals.list')`. Fehlermeldungen werden vom Electron-Präfix („Error invoking remote method …: Error: “) bereinigt.
- **Main** `ipc/handle.ts`: `handle<C extends ApiChannel>(channel, fn)` mit aus dem Vertrag abgeleiteten Parameter-/Rückgabetypen. Jedes Feature-Modul exportiert `register()`; `ipc/index.ts` ruft alle auf.
- Renderer-Datenhaltung über react-query. Query-Keys: `['festivals']`, `['products', festivalId]`, `['clubs', festivalId]`, `['paymentMethods', festivalId]`, `['template', festivalId]`, `['invoices', festivalId]`, `['evaluation', festivalId]`, `['settings']`, `['printers']`, `['printerStatus']`. Nach Mutationen passende Keys invalidieren.

## 4. Daten

- SQLite-Datei `<userData>/festbuero.sqlite`, Logos in `<userData>/logos/<sha256>.<ext>` (inhaltsadressiert, nie überschrieben → Rechnungs-Snapshots bleiben gültig).
- `userData` = `app.getPath('userData')`, überschreibbar mit Umgebungsvariable `FESTBUERO_USER_DATA` (Tests/Entwicklung). Muss vor `app.whenReady()` gesetzt werden.
- Pragmas: `journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000`.
- Migrationen: `PRAGMA user_version`, siehe `src/main/db/migrations.ts`.
- `app_settings`: Schlüssel/Wert, Wert JSON-kodiert, Schlüssel = Felder von `AppSettings`.
- Repositories mappen snake_case-Zeilen auf die camelCase-Domänentypen. Abgeleitete Felder (`hasInvoices`, `usedInInvoices`, `hasInvoice`) per Subquery.
- Fest-Anlage erzeugt immer: 2 Zahlungsarten (bar = Standard, Überweisung, Frist 7 Tage, Texte laut Spezifikation) und 1 Vorlage (`getDefaultTemplateConfig()`).

## 5. Fachregeln (Kurzfassung)

- **Nummer** = `numberPrefix + String(seq).padStart(numberDigits, '0')`. Vergabe in EINER Transaktion: `number_next` lesen, erhöhen, Rechnung + Positionen speichern. UNIQUE auf `invoice.number` über alle Feste; Kollision → verständlicher Fehler, nichts gespeichert.
- **Steuer**: Preise sind brutto. Pro Steuersatz Brutto summieren, `netto = round(brutto × 100 / (100 + satz))` (kaufmännisch, auf Betragsbasis, Vorzeichen danach), `mwst = brutto − netto`. Bei Steuerbefreiung wird nichts ausgewiesen, Sätze bleiben gespeichert.
- **Storno**: neue Nummer aus derselben Reihe, Positionen mit negierter Menge (Einzelpreis unverändert, Zeilensumme negativ), Summen negativ, Betreff aus `template.stornoSubject`. Original → `status = 'storniert'`. Nur einmal möglich (Unique-Index).
- **Fälligkeitsdatum** = Rechnungsdatum + `dueDays` der gewählten Zahlungsart.
- **Endbetrag 0 €** → Abschluss nicht möglich (Renderer sperrt, Main prüft erneut).
- **Snapshot**: Rechnung speichert Kunde, Positionen, Preise, Sätze, Zahlungstext, Steuerhinweis, Festname, Vorlage (JSON) und Logo-Dateiname.

## 6. Rendering-Pipeline (Vorschau = PDF)

1. `renderInvoiceHtml({ data: InvoiceRenderData, template: TemplateConfig, logoDataUrl: string | null })` → vollständiges HTML-Dokument (A4, mm-Maße, `@page { size: A4; margin: 0 }`, eingebettete Schriften).
2. Seitenumbruch: Das HTML enthält ein kleines Inline-Skript, das die Positionstabelle auf A4-Seiten verteilt (wiederholte Tabellenkopfzeile, Fußzeile auf jeder Seite) und danach `window.__FESTBUERO_RENDER_DONE__ = true` setzt.
3. **Vorschau**: `InvoicePreview` zeigt das HTML in einem sandboxed `iframe` (srcdoc), skaliert auf die Spaltenbreite.
4. **PDF** (Main, `services/pdf.ts`): verstecktes `BrowserWindow` lädt dasselbe HTML, wartet auf `__FESTBUERO_RENDER_DONE__`, dann `webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { marginType: 'none' } })`.
5. Für abgeschlossene Rechnungen wird `InvoiceRenderData` aus dem gespeicherten Snapshot gebaut (`invoiceToRenderData(invoice)` in `src/shared/invoice-render/`), nie aus aktuellen Stammdaten.

## 7. Abschluss-Ablauf (`invoices.finalize`)

1. Validieren (Fest existiert, Endbetrag ≠ 0, Dokumentenordner gesetzt).
2. Transaktion: Nummer vergeben, Rechnung + Positionen mit allen Kopien speichern.
3. PDF erzeugen → `<Dokumentenordner>/<Festname>/Rechnungen/<Dateiname>.pdf` (Stornos: `/Stornos/`). Dateiname aus Muster, unzulässige Zeichen ersetzt, existierende Dateien nie überschreiben. Bei Fehler: Rechnung bleibt gültig, `pdf_path` bleibt leer; `invoices.get`/`ensurePdf` holt nach.
4. Gespeichertes PDF drucken (Kopienzahl des Fests, Drucker = `opts.printer` ?? `defaultPrinter`). Fehler → `printed = 0`, `print_error` gesetzt, Rechnung bleibt gültig.
5. Status setzen, `FinalizeResult` zurückgeben.

## 8. Druck

- Druckerliste: `webContents.getPrintersAsync()` → `PrinterInfo` (`name`, `displayName`, `isDefault`).
- macOS: `execFile('lp', ['-d', printer, '-n', String(copies), pdfPath])`.
- Windows: gebündeltes `SumatraPDF.exe -print-to "<printer>" -print-settings "<copies>x" -silent "<pdf>"` (Pfad über `process.resourcesPath` bzw. `resources/win/` in Entwicklung).
- **Dry-Run** (Pflicht in Entwicklung/Tests): wenn `!app.isPackaged && process.env.FESTBUERO_REAL_PRINT !== '1'` oder `FESTBUERO_PRINT_DRY_RUN === '1'` → kein Systemaufruf, Eintrag in `<userData>/print-dry-run.log`, Ergebnis `{ ok: true, dryRun: true }`. Mit `FESTBUERO_FAKE_PRINT_FAIL=1` liefert der Dry-Run einen Fehler (für Fehlerfall-Tests).

## 9. Routen (HashRouter)

| Route | Seite | Zuständig |
| --- | --- | --- |
| `/festbuero` (Start) | Festbüro-Maske; `?from=<invoiceId>` = Vorbelegung aus alter Rechnung („Stornieren und neu erstellen“) | Maske |
| `/rechnungen` | Rechnungsliste | Liste & Auswertung |
| `/auswertung` | Auswertung | Liste & Auswertung |
| `/fest/allgemein` | Name, Datum, Kopien, Steuerbefreiung, Dateinamensmuster, Fest kopieren, archivieren | Fest-Einstellungen |
| `/fest/nummern` | Präfix, Startnummer, Stellenzahl | Fest-Einstellungen |
| `/fest/produkte` | Produkte (Drag-and-drop) | Fest-Einstellungen |
| `/fest/zahlarten` | Zahlungsarten | Fest-Einstellungen |
| `/fest/vereine` | Vereinsstamm, Excel-Import, Vorlagen-Export | Vereine |
| `/fest/vorlage` | Vorlagen-Editor | Vorlage |
| `/einstellungen` | App-Einstellungen (Dokumentenordner, Drucker, Testseite, Datensicherung, Theme, Beispieldaten) | Setup |
| `/setup` | Ersteinrichtungs-Assistent | Setup |

## 10. Responsive Layout (verbindlich für alle Seiten)

Die App muss auch bei verkleinertem Laptop-Fenster problemlos funktionieren, **auch im Splitscreen** (halber Bildschirm: auf Laptops typischerweise 640–760 px breit).

- **Mindestfenster 600 × 560.** Bei keiner Größe ab 600 × 560 scrollt das ganze Fenster horizontal, und kein Bedienelement wird abgeschnitten. Lange Texte (Fest, Drucker, Vereine) werden gekürzt (`truncate`), der volle Text steht im Tooltip bzw. `title`.
- **Breakpoints** (Tailwind-Standard): `xl` ≥ 1280 = volles Layout · `lg` 1024–1279 = kompakt · `md` 768–1023 = schmal · `< md` (600–767) = Splitscreen. Wo eine Komponente von ihrer eigenen Breite abhängt (Spalten, Panels), Container-Queries (`@container`) statt Fenster-Breakpoints verwenden.
- **Splitscreen (< md):** Kopfleiste nur mit Icons bzw. sehr kompakt, Navigation hinter dem Menü-Button, Formulare einspaltig, Tabellen nur mit den wichtigsten Spalten.
- **Höhe:** Bei 560 px muss alles bedienbar sein. Kopfleiste fix, Inhaltsbereiche scrollen intern. Wichtige Aktionsleisten (z. B. Endbetrag + „Abschließen & drucken“) bleiben sichtbar (sticky). Dialoge haben `max-h` mit internem Scroll.
- **Shell:** Navigation ≥ xl mit Text, lg–xl kompakt (Icons + Tooltip), < lg hinter einem Menü-Button (Sheet). Kopfleiste < lg kompakt.
- **Festbüro-Maske:** ≥ xl zwei Spalten (Eingaben | Vorschau), Vorschau einklappbar. Unter xl ist die Vorschau standardmäßig zu und öffnet sich per Button bzw. Kurzbefehl als Fenster (Sheet/Dialog), wie in der Spezifikation vorgesehen. Eingabespalte nie schmaler als nötig: Mengenfelder und Schnellwahl-Buttons bleiben in einer Zeile.
- **Tabellen** (Rechnungen, Produkte, Vereine): Unwichtige Spalten werden bei kleiner Breite ausgeblendet, oder die Tabelle scrollt innerhalb ihres Containers. Zeilenaktionen bei kleiner Breite in einem „…“-Menü.
- **Vorlagen-Editor:** ≥ xl drei Bereiche (Blockliste | Editor | Vorschau). Darunter Vorschau per Umschalter/Sheet, < lg Blockliste als Auswahl/Drawer.
- **Prüfung:** Jede Seite wird bei 600 × 560 (min), 740 × 900 (split), 1280 × 800 (laptop) und 1440 × 900 (large) per Playwright-Screenshot geprüft (`setWindowSize`, `VIEWPORTS` in `tests/e2e/helpers.ts`), inklusive Check auf horizontalen Overflow.

## 11. Fenster, Titelleiste & Menü

- **Integrierte Titelleiste:** Kein separater System-Titelbalken. macOS: `titleBarStyle: 'hidden'`, Ampel mittig in der App-Kopfleiste (links Platz reserviert, im Vollbild nicht). Windows: `titleBarStyle: 'hidden'` + `titleBarOverlay`, native Fensterknöpfe rechts in der Kopfleiste, Farben folgen dem Theme. Leere Kopfleistenflächen sind Drag-Region, Bedienelemente `no-drag`.
- **Menüleiste (macOS):** Festbüro · Ablage · Bearbeiten · Fest · Darstellung · Drucker · Fenster · Hilfe, mit den wichtigsten Funktionen und Kurzbefehlen (Aufbau: `src/main/menu.ts`). **Windows:** dasselbe Menü über einen Menü-Button (☰) links in der Kopfleiste, Kurzbefehle mit Strg.
- **Menüaktionen:** Der Main-Prozess sendet `'menu.action'` an den Renderer. Seiten schließen ihre Aktionen mit `useMenuAction(action, handler)` an. Ist die passende Seite nicht offen, navigiert die Shell erst dorthin und stellt die Aktion dann zu. Der Renderer meldet seinen Zustand mit `app.updateMenuState(...)` (z. B. ob „Abschließen & drucken“ aktiv ist). Welche Aktion welcher Bereich anschließt, steht in `docs/dev-notes.md`.

## 12. Dateizuständigkeiten (parallele Arbeit)

Jeder Bereich bearbeitet nur seine Dateien. Gemeinsame Dateien (`src/shared/types.ts`, `src/shared/ipc.ts`) nur additiv. Die Vorlagen von Basis-Agent (Stubs) dürfen vom jeweils zuständigen Bereich ersetzt werden.

| Bereich | Dateien |
| --- | --- |
| **Basis** | Projektkonfiguration, `src/main/index.ts`, `src/main/db/connection.ts`, `src/main/ipc/handle.ts`, `src/main/ipc/index.ts`, `src/preload/**`, `src/renderer/src/{main.tsx,App.tsx,lib/**,components/ui/**,components/layout/**,hooks/**}`, `src/shared/{money,tax,numbering,dates,placeholders,filename}.ts` + Tests, `src/main/services/settings.ts`, `tests/e2e/helpers.ts` |
| **Fest-Einstellungen** | `src/main/services/{festivals,products,payment-methods}.ts`, `src/main/db/repositories/{festivals,products,payment-methods}.ts`, `src/main/ipc/{festivals,products,paymentMethods}.ts`, `src/renderer/src/pages/fest/{allgemein,nummern,produkte,zahlarten}/**` |
| **Vereine** | `src/main/services/{clubs,club-import,club-template-export}.ts`, `src/main/db/repositories/clubs.ts`, `src/main/ipc/clubs.ts`, `src/renderer/src/pages/fest/vereine/**`, `tests/fixtures/vereine*.xlsx` |
| **Vorlage** | `src/shared/invoice-render/**`, `src/renderer/src/components/invoice-preview/**`, `src/main/services/templates.ts`, `src/main/db/repositories/templates.ts`, `src/main/ipc/templates.ts`, `src/renderer/src/pages/fest/vorlage/**` |
| **Maske** | `src/shared/invoice-draft.ts`, `src/renderer/src/pages/festbuero/**` |
| **Abschluss & Druck** | `src/main/services/{finalize,pdf,filing,printing,storno,invoice-export}.ts`, `src/main/db/repositories/invoices.ts`, `src/main/ipc/{invoices,printing}.ts` |
| **Liste & Auswertung** | `src/renderer/src/pages/{rechnungen,auswertung}/**`, `src/main/services/{evaluation,evaluation-export}.ts`, `src/main/ipc/evaluation.ts` |
| **Setup & Auslieferung** | `src/renderer/src/pages/{setup,einstellungen}/**`, `src/main/services/{backup,sample-data}.ts`, `src/main/ipc/app.ts` (Erweiterung), `electron-builder.yml`, `build/**`, `scripts/**`, `.github/workflows/**`, `README.md` |
