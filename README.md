# Festbüro

Desktop-App für das Festbüro eines Gründungsfests: Rechnungen an Vereine und Einzelpersonen in Sekunden
erstellen, als PDF ablegen und **ohne Druckdialog** drucken. Läuft komplett offline auf macOS und Windows –
keine Cloud, keine Anmeldung.

> Alle Namen, Adressen und Vereine in diesem Repository (Musterverein e.V., Beispiel-Fest) sind erfunden.

## Funktionen

- **Festbüro-Maske**: Verein suchen (fehlertolerant), Personenzahl eintragen, Positionen sind vorbelegt
  (pro Person / feste Anzahl, Schnellwahl 0 · 1× · 2×), Einzelrechnungen, Live-Vorschau als A4-Seite.
  „Abschließen & drucken“ (⌘/Strg + Enter) vergibt die Nummer, legt das PDF ab und druckt sofort.
- **Mehrere Gründungsfeste** in einer Installation, jeweils mit eigenen Produkten, Zahlungsarten,
  Vereinen, Rechnungsvorlage und Nummernkreis (Präfix, Startnummer, Stellenzahl).
- **Vereinsstamm per Excel-Import** mit Vorschau und Fehleranzeige, Anmelde-Vorlage zum Verschicken.
- **Rechnungsvorlage** nach DIN 5008 mit Editor: Logo, Absender, Hinweistexte, Fußzeile, Platzhalter.
- **Steuern**: Bruttopreise mit 7 %/19 % oder Steuerbefreiung (§ 19 UStG).
- **Rechnungsliste** mit Suche, Filtern, Storno (neue Nummer, nichts wird gelöscht), PDF- und ZIP-Export.
- **Auswertung** (Umsatz, Zahlarten, Produkte, Steuersätze, Vereine ohne Rechnung) mit Excel-Export.
- **Ersteinrichtungs-Assistent**, **Datensicherung** als ZIP, **Testseite** für den Drucker,
  heller und dunkler Modus, komplett per Tastatur bedienbar, auch im halben Bildschirm (ab 600 × 560).

## Installation

Die Installer stehen unter **Releases** bzw. als Artefakte des Workflows „Installer bauen“:

| System | Datei |
| --- | --- |
| macOS 12 oder neuer (Apple Silicon und Intel) | `Festbuero-<version>-mac-universal.dmg` |
| Windows 10/11 (64-Bit) | `Festbuero-<version>-win-x64-setup.exe` |

Die Installer sind derzeit **nicht signiert** (siehe [Code-Signierung](#code-signierung)). Deshalb warnen
macOS und Windows beim ersten Start. Das ist bei unsignierten Programmen normal.

### macOS

1. DMG öffnen und die App **Festbuero** (technischer Dateiname, angezeigt wird „Festbüro“) in den Ordner
   „Programme“ ziehen.
2. Festbüro aus „Programme“ starten. macOS meldet, dass der Entwickler nicht überprüft werden kann.
3. Öffnen erlauben:
   - **macOS 15 (Sequoia) und neuer:** Meldung schließen, dann **Systemeinstellungen → Datenschutz &
     Sicherheit** öffnen, ganz nach unten scrollen und bei „Festbuero wurde blockiert …“ auf
     **„Dennoch öffnen“** klicken, mit Passwort bzw. Touch ID bestätigen.
   - **macOS 14 und älter:** im Finder **Rechtsklick (Ctrl-Klick) auf Festbüro → „Öffnen“** und im
     Dialog erneut „Öffnen“ wählen.
4. Das ist nur beim ersten Start nötig.

Meldet macOS stattdessen, die App sei **„beschädigt“**, hat das Betriebssystem die Download-Markierung
gesetzt. Dann einmalig im Terminal ausführen und die App erneut starten:

```bash
xattr -dr com.apple.quarantine /Applications/Festbuero.app
```

### Windows

1. `Festbuero-<version>-win-x64-setup.exe` starten.
2. Erscheint **„Der Computer wurde durch Windows geschützt“** (SmartScreen): auf
   **„Weitere Informationen“** klicken, dann **„Trotzdem ausführen“**.
3. Installationsordner wählen (Standard: nur für den aktuellen Benutzer). Der Installer legt
   Verknüpfungen „Festbüro“ im Startmenü und auf dem Desktop an.

Der Windows-Installer enthält **SumatraPDF** für den stillen PDF-Druck (siehe [Lizenzhinweise](#lizenzhinweise)).

## Erste Schritte

Beim ersten Start führt der **Einrichtungsassistent** durch vier Schritte:

1. **Dokumentenordner** wählen – Vorschlag: `Dokumente/Festbüro`. Dort landen die Rechnungs-PDFs
   (`<Festname>/Rechnungen/…`, Stornos unter `<Festname>/Stornos/`) und die Datensicherungen.
2. **Drucker** wählen – der Festdrucker, auf dem ohne Dialog gedruckt wird (später jederzeit in der
   Kopfleiste änderbar).
3. **Erstes Gründungsfest** anlegen (Name, Festdatum, Rechnungsnummern) – oder ein
   **Beispiel-Fest** zum Ausprobieren anlegen (Produkte der Musterrechnung, Muster-Vorlage, erfundene Vereine).
4. **Fertig** – optional eine Testseite drucken.

Danach unter **Fest-Einstellungen** Produkte, Zahlungsarten, Vereine (Excel-Import) und die
Rechnungsvorlage (Logo, Absender, Bankverbindung) einrichten. Der Assistent lässt sich unter
**App-Einstellungen → Einrichtung** oder im Menü **Hilfe** erneut öffnen.

> **Wichtig: Vor dem Fest den stillen Druck mit dem echten Festdrucker testen.**
> App-Einstellungen → Drucker → **„Testseite drucken“**. Die Testseite ist eine Musterrechnung mit
> der Vorlage des aktiven Fests (Nummer „MUSTER“) und wird nicht als Rechnung gespeichert. Prüfen, dass
> sie ohne Dialog, vollständig und in der richtigen Größe gedruckt wird – auf jedem Rechner, der am Fest
> eingesetzt wird.

## Datensicherung und Wiederherstellung

**Sichern:** App-Einstellungen → **„Datensicherung erstellen“** (oder Menü Ablage → „Datensicherung
erstellen …“). Die App schreibt eine ZIP-Datei nach
`<Dokumentenordner>/Datensicherungen/Festbuero-Datensicherung-JJJJ-MM-TT_HH-mm.zip`. Sie enthält eine
konsistente Kopie der Datenbank (`festbuero.sqlite`), alle Logos (`logos/`) und eine Anleitung
(`LIESMICH.txt`). Vorhandene Sicherungen werden nie überschrieben. Die Rechnungs-PDFs liegen ohnehin im
Dokumentenordner – den Ordner am besten zusätzlich auf einen USB-Stick kopieren.

**Wiederherstellen (von Hand):**

1. Festbüro beenden.
2. Das App-Datenverzeichnis öffnen (App-Einstellungen → Info → Datenordner „Öffnen“):
   - macOS: `~/Library/Application Support/Festbüro`
   - Windows: `%APPDATA%\Festbüro`
3. Vorhandene Dateien `festbuero.sqlite`, `festbuero.sqlite-wal`, `festbuero.sqlite-shm` und den Ordner
   `logos` zur Sicherheit an einen anderen Ort verschieben.
4. `festbuero.sqlite` und den Ordner `logos` aus der ZIP-Datei in das Datenverzeichnis kopieren.
5. Festbüro starten. Eine Sicherung aus einer älteren Version wird beim Start automatisch auf den
   aktuellen Stand gebracht; eine Sicherung aus einer neueren Version lässt sich erst nach einem Update öffnen.

## Entwicklung

Voraussetzungen: Node.js 22 oder 24, npm. Stack: Electron, React, TypeScript, Vite (electron-vite),
Tailwind CSS, shadcn/ui, SQLite (better-sqlite3).

```bash
npm install
FESTBUERO_USER_DATA="$PWD/.devdata/dev" npm run dev    # Entwicklung mit isolierten Daten
```

| Zweck | Befehl |
| --- | --- |
| Entwicklung (Hot Reload) | `npm run dev` |
| Typprüfung | `npm run typecheck` |
| Unit-Tests (Vitest über Electrons Node) | `npm test` |
| E2E-Tests (Playwright, baut vorher) | `npm run test:e2e` |
| Produktionsbuild | `npm run build` |
| App-Icon aus `build/icon.svg` neu rendern | `npm run icon` |
| SumatraPDF laden und prüfen (Windows-Build) | `npm run fetch:sumatra` |
| Installer macOS (universal .dmg) | `npm run dist:mac` |
| Installer Windows (NSIS x64, lädt vorher SumatraPDF) | `npm run dist:win` |
| beide Installer | `npm run dist` |

In Entwicklung wird **nie echt gedruckt** (Druck wird simuliert und in `<userData>/print-dry-run.log`
protokolliert). Installer landen in `release/`. Zum lokalen Bauen ohne Zertifikat
`CSC_IDENTITY_AUTO_DISCOVERY=false` setzen – die macOS-App wird dann automatisch ad-hoc signiert
(`scripts/adhoc-sign-mac.cjs`), damit macOS sie nicht als „beschädigt“ meldet.

- `npm run dist:win` funktioniert auch auf macOS (Cross-Build ohne Wine): better-sqlite3 bringt fertige
  N-API-Binärdateien für macOS und Windows mit, native Module werden beim Paketieren nicht neu gebaut
  (`npmRebuild: false`), `node_modules` bleibt unverändert.
- Der technische Produktname ist `Festbuero` (ASCII, wegen eines Absturzes mit „ü“ im macOS-Bundle-Namen);
  angezeigt wird überall „Festbüro“ (siehe `docs/dev-notes.md`, Abschnitt „Paketierung“).

**Struktur**

```
src/main/       Main-Prozess: Fenster, Menü, Datenbank (Migrationen), IPC, Dienste (PDF, Druck, Export …)
src/preload/    sichere Brücke zum Renderer
src/renderer/   React-Oberfläche (Seiten unter src/renderer/src/pages/)
src/shared/     plattformneutrale Logik und Typen (Beträge, Steuer, Nummern, Vorlagen-Renderer)
tests/          E2E-Tests (Playwright) und Testdaten
build/          App-Icon und macOS-Entitlements für electron-builder
resources/      Muster-Logo (sample/), SumatraPDF für Windows (win/)
scripts/        Hilfsskripte (Icon rendern, SumatraPDF laden)
```

Weitere Unterlagen: [`docs/architecture.md`](docs/architecture.md) (Architektur, Verträge),
[`docs/dev-notes.md`](docs/dev-notes.md) (Entwickler-Notizen), Spezifikation
[`Festbüro-Software – Spezifikation.md`](Festbüro-Software%20–%20Spezifikation.md).

**Installer per GitHub Actions:** Der Workflow [`.github/workflows/build.yml`](.github/workflows/build.yml)
baut bei einem Tag `v*` (oder manuell über „Run workflow“) beide Installer auf macOS und Windows, prüft
vorher Typen und Unit-Tests und legt bei Tags einen **Release-Entwurf** mit beiden Dateien an.

```bash
git tag v0.1.0 && git push origin v0.1.0
```

## Code-Signierung

Ohne Signatur warnen macOS (Gatekeeper) und Windows (SmartScreen) beim ersten Start (siehe
[Installation](#installation)). Funktional ändert eine Signatur nichts – sie belegt die Herkunft des
Programms und erspart den Nutzern die Warnungen.

| | macOS | Windows |
| --- | --- | --- |
| Was wird benötigt | Mitgliedschaft im **Apple Developer Program** (Zertifikat „Developer ID Application“) und **Notarisierung** durch Apple | **Code-Signing-Zertifikat** einer Zertifizierungsstelle (OV oder EV) oder **Azure Trusted Signing** (Microsoft) |
| Ungefähre Kosten | ca. 99 € bzw. 99 USD pro Jahr | Zertifikat: grob 200–600 € pro Jahr je nach Anbieter und Typ; Azure Trusted Signing: ab ca. 10 USD pro Monat |
| Hinweise | Für Organisationen ist eine D-U-N-S-Nummer nötig, für Einzelpersonen nicht. | Zertifikats-Schlüssel müssen seit 2023 auf Hardware (Token/HSM) liegen. SmartScreen-Warnungen verschwinden erst, wenn das Zertifikat genug „Reputation“ gesammelt hat. Azure Trusted Signing setzt eine Identitätsprüfung voraus und ist nicht in allen Ländern bzw. für alle Organisationsformen verfügbar. |

Alle Preise sind **ungefähre Angaben – Stand bitte vor einer Entscheidung beim Anbieter prüfen.**

Die Konfiguration ist vorbereitet (`electron-builder.yml`: Hardened Runtime, Entitlements). Signiert wird
ausschließlich über Umgebungsvariablen bzw. GitHub-Secrets, nie über Dateien im Repository:

- **macOS:** `CSC_LINK` (Developer-ID-Zertifikat als .p12, Pfad oder base64), `CSC_KEY_PASSWORD`;
  Notarisierung über `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (oder API-Schlüssel:
  `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`).
- **Windows:** `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` (Zertifikat als Datei) – bei Hardware-Token bzw.
  Azure Trusted Signing stattdessen `win.azureSignOptions` in `electron-builder.yml` ergänzen und
  `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` setzen.
- Im Workflow dann `CSC_IDENTITY_AUTO_DISCOVERY: "false"` entfernen und die Secrets als Umgebungsvariablen
  durchreichen (Beispiele stehen als Kommentar in `build.yml`).

## Lizenzhinweise

- **SumatraPDF** (nur im Windows-Installer) wird als eigenständiges, unverändertes Programm für den
  stillen PDF-Druck mitgeliefert. Es steht unter der GNU GPL v3 bzw. AGPL v3 (MuPDF), einzelne Teile unter
  BSD-Lizenz. Version, Herkunft, Prüfsummen, Lizenztexte und Link zum Quellcode:
  [`resources/win/README.md`](resources/win/README.md). Die Lizenztexte werden im Installer unter
  `resources\win\` mitgeliefert.
- Die übrigen verwendeten Open-Source-Pakete stehen unter ihren jeweiligen Lizenzen (siehe `node_modules`
  bzw. `package-lock.json`).
