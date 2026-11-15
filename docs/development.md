# Entwicklung

Unterlagen für Entwicklerinnen und Entwickler. Die Anleitung für Anwender steht in der [README](../README.md).

Weitere Unterlagen: [`architecture.md`](architecture.md) (Architektur, Verträge),
[`dev-notes.md`](dev-notes.md) (Entwickler-Notizen), Spezifikation
[`Festbüro-Software – Spezifikation.md`](../Festbüro-Software%20–%20Spezifikation.md).

## Einrichtung und Befehle

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
| README-Screenshots neu erzeugen (macOS, baut vorher) | `npm run docs:screenshots` |
| Produktionsbuild | `npm run build` |
| App-Icon aus `build/icon.svg` neu rendern | `npm run icon` |
| SumatraPDF laden und prüfen (Windows-Build) | `npm run fetch:sumatra` |
| Installer macOS (universal .dmg) | `npm run dist:mac` |
| Installer Windows (NSIS x64, lädt vorher SumatraPDF) | `npm run dist:win` |
| beide Installer | `npm run dist` |

**Screenshots:** `npm run docs:screenshots` baut die App nach `out/docs`, startet sie mit temporären Daten,
legt das Beispiel-Fest mit Demo-Rechnungen an und schreibt die Bilder der README nach
`docs/screenshots/` (Generator: `tests/docs/readme-screenshots.spec.ts`, läuft nicht bei `npm run test:e2e`
mit). Im Doku-Modus (`FESTBUERO_DOCS_SCREENSHOTS=1`) zeigt die App nur erfundene Demo-Drucker und keine
Entwicklungshinweise; gedruckt wird auch dabei nie. Die Bilder werden mit `sips` (macOS) auf 1600 px verkleinert.

In Entwicklung wird **nie echt gedruckt** (Druck wird simuliert und in `<userData>/print-dry-run.log`
protokolliert). Installer landen in `release/`. Zum lokalen Bauen ohne Zertifikat
`CSC_IDENTITY_AUTO_DISCOVERY=false` setzen – die macOS-App wird dann automatisch ad-hoc signiert
(`scripts/adhoc-sign-mac.cjs`), damit macOS sie nicht als „beschädigt“ meldet.

- `npm run dist:win` funktioniert auch auf macOS (Cross-Build ohne Wine): better-sqlite3 bringt fertige
  N-API-Binärdateien für macOS und Windows mit, native Module werden beim Paketieren nicht neu gebaut
  (`npmRebuild: false`), `node_modules` bleibt unverändert.
- Der technische Produktname ist `Festbuero` (ASCII, wegen eines Absturzes mit „ü“ im macOS-Bundle-Namen);
  angezeigt wird überall „Festbüro“ (siehe `dev-notes.md`, Abschnitt „Paketierung“).

## Struktur

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

## Neue Version veröffentlichen

1. Version in `package.json` erhöhen (`npm version X.Y.Z --no-git-tag-version`), committen und pushen.
2. Tag setzen und pushen:

   ```bash
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```

3. Der Workflow [`.github/workflows/build.yml`](../.github/workflows/build.yml) prüft Typen und Unit-Tests,
   baut beide Installer auf macOS und Windows und legt einen **Release-Entwurf** mit beiden Dateien an.
   (Manuell geht es auch über „Run workflow“ – dann nur als Artefakte, ohne Release.)
4. Den Entwurf auf GitHub prüfen und mit **„Publish release“** veröffentlichen.

Erst nach dem Veröffentlichen finden die installierten Apps das Update (Entwürfe und Vorabversionen sieht
der Updater nicht). Zum Release gehören neben den Installern `latest.yml` und
`Festbuero-…-win-x64-setup.exe.blockmap` – beide braucht der Windows-Updater, sie nicht löschen.

## Updater

Dateien: `src/main/services/updater.ts` (Ablauf), `src/main/services/update-check.ts` (reine Hilfsfunktionen,
unit-getestet), `src/main/ipc/updates.ts`, Oberfläche in `src/renderer/src/pages/einstellungen/UpdatesSection.tsx`
und `src/renderer/src/components/layout/UpdateNotifier.tsx`. Quelle sind die GitHub-Releases
(`publish` in `electron-builder.yml` und `UPDATE_REPO` in `update-check.ts` müssen übereinstimmen).

- **Windows:** [`electron-updater`](https://www.electron.build/auto-update) liest `latest.yml` aus dem neuesten
  Release, lädt den Installer (differenziell über die `.blockmap`, SHA-512 geprüft) und installiert auf
  Knopfdruck still mit Neustart (`quitAndInstall(true, true)`) bzw. beim nächsten Beenden. Funktioniert
  unsigniert; ist der Installer später signiert, prüft electron-updater zusätzlich den Herausgeber.
- **macOS:** Squirrel.Mac (echtes Auto-Update) verlangt eine Developer-ID-Signatur. Bis dahin
  halbautomatisch: GitHub-API (`/releases/latest`) abfragen, die DMG nach `<userData>/updates/` laden, mit
  dem SHA-256 aus dem Release-Feld `digest` vergleichen, öffnen und die App beenden. Selbst geladene Dateien
  tragen keine Quarantäne-Markierung, Gatekeeper fragt deshalb nicht erneut. Alte Downloads löscht die App
  beim nächsten Start. Mit Signatur: `zip`-Ziel für macOS ergänzen (erzeugt `latest-mac.yml`) und den
  macOS-Zweig in `updater.ts` auf `electron-updater` umstellen.
- **Nie in Entwicklung oder Tests:** unpaketiert oder mit `FESTBUERO_E2E=1` ist der Updater abgeschaltet
  (Status „unsupported“), es gibt keine Netzwerkzugriffe.
- Die automatische Suche läuft 8 s nach dem Start einmal (`AppSettings.autoUpdateCheck`, Standard an) und
  bleibt bei Fehlern still; nur die Suche auf Knopfdruck zeigt Fehler an.

## Code-Signierung

Ohne Signatur warnen macOS (Gatekeeper) und Windows (SmartScreen) beim ersten Start (siehe
[Installation](../README.md#installation)). Funktional ändert eine Signatur nichts – sie belegt die Herkunft
des Programms und erspart den Nutzern die Warnungen.

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
