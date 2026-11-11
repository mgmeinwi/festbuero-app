# Festbüro-App – Arbeitsregeln

Desktop-App (Electron + React + TypeScript) für das Festbüro eines Gründungsfests: Rechnungen an Vereine/Einzelpersonen erstellen, als PDF ablegen, still drucken. Komplett offline.

- Fachliche Spezifikation: `Festbüro-Software – Spezifikation.md` (Projektwurzel) – maßgeblich.
- Architektur, Verträge, Dateizuständigkeiten: `docs/architecture.md` – vor jeder Arbeit lesen.
- Gemeinsame Typen: `src/shared/types.ts`, IPC-Vertrag: `src/shared/ipc.ts`, DB-Schema: `src/main/db/migrations.ts`.

## Befehle

| Zweck | Befehl |
| --- | --- |
| Entwicklung (Hot Reload) | `npm run dev` |
| Typprüfung | `npm run typecheck` |
| Unit-Tests (Vitest, läuft über Electrons Node wegen better-sqlite3-ABI) | `npm test` bzw. `npm test -- <pfad>` |
| E2E (Playwright für Electron, baut vorher) | `npm run test:e2e` |
| Produktionsbuild | `npm run build` |
| Installer | `npm run dist:mac` / `npm run dist:win` |

## Harte Regeln

1. **Niemals echte Druckaufträge senden.** Ist die App nicht paketiert (`!app.isPackaged`), wird immer nur simuliert (Dry-Run), außer ein Mensch setzt `FESTBUERO_REAL_PRINT=1`. Diese Variable nie selbst setzen.
2. **Isolierte Daten beim Starten der App:** In Entwicklung und Tests immer `FESTBUERO_USER_DATA=<temporärer Ordner>` setzen (z. B. unter `.devdata/` oder dem Scratchpad) und als Dokumentenordner einen temporären Ordner verwenden. Nie in `~/Documents` oder das echte App-Datenverzeichnis schreiben.
3. **Das Repository ist öffentlich: keine echten Daten.** Keine Personendaten und keine echten Vereinsdaten (Wappen, Bankverbindung, Steuernummer, Registernummer, Namen von Vorstand, Kunden oder Dienstleistern). Die lokale Beispielrechnung `~/Documents/Sonstiges/Radlerfest 2025/Rechnungen/081.pdf` darf als Layout-Referenz gelesen, aber nicht kopiert oder abgeschrieben werden. Vorlagen, Beispiel-Fest und Testdaten nutzen erfundene Musterdaten (Musterverein e.V., `resources/sample/beispiel-logo.svg`). Nur die Produkte, Preise und Mengen der Beispielrechnung (Prüfsumme 670,20 €) dürfen übernommen werden.
4. **Beträge immer in Cent (Integer).** Steuer- und Rundungslogik ausschließlich über `src/shared/tax.ts` und `src/shared/money.ts`.
5. **UI-Texte auf Deutsch**, Code-Bezeichner auf Englisch. Euro-Format `1.234,56 €`, Nullbeträge in der Rechnung als `– €`.
6. **Abgeschlossene Rechnungen sind unveränderlich** (DB-Trigger erzwingen das). Korrekturen nur per Storno. Erlaubte Updates: `status` (abgeschlossen → storniert), `pdf_path`, `pdf_created_at`, `printed`, `printed_at`, `print_error`.
7. **`src/shared/` ist plattformneutral**: keine Node-, Electron- oder DOM-Importe (der Vorlagen-Renderer erzeugt HTML-Strings; DOM-Code darf nur als eingebettetes Skript im erzeugten HTML laufen).
8. **Keine neuen npm-Abhängigkeiten** ohne Freigabe – mehrere Agents arbeiten parallel im selben `node_modules`. Bedarf im Abschlussbericht melden.
9. **Nicht selbst committen oder pushen** – der Orchestrator committet nach jedem fertigen Feature und jeder größeren Änderung (ein Commit pro Bereich, nur dessen Dateien) und pusht anschließend. Im Abschlussbericht deshalb alle geänderten und neuen Dateien vollständig auflisten.
10. **Nur eigene Dateien bearbeiten** (siehe Zuständigkeiten in `docs/architecture.md`). Gemeinsame Vertragsdateien nur additiv und minimal ändern.
11. Fehler, die bei Nutzern ankommen, als `Error` mit klarer deutscher Meldung werfen.
12. **Responsiv ab 600 × 560 Fenstergröße, auch im Splitscreen** – kein horizontaler Fenster-Scroll, nichts abgeschnitten, alles bedienbar; jede Seite bei 600×560, 740×900, 1280×800 und 1440×900 per Screenshot prüfen (Details: `docs/architecture.md` §10).
13. **Den Nutzer nicht stören:** Die App in Tests nur über die Helfer in `tests/e2e/helpers.ts` starten (Fenster ohne Fokusdiebstahl) und immer sauber mit `closeApp()` beenden, nie per kill. Gebaute `.app`/`.exe`-Pakete nur starten, wenn es ausdrücklich zur Aufgabe gehört. Abstürze beim Beenden erzeugen beim Nutzer macOS-Fehlerdialoge. Nach Testläufen prüfen, dass keine neuen Berichte entstanden sind (`ls ~/Library/Logs/DiagnosticReports | grep -ci festb` darf nicht steigen).
