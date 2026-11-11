# SumatraPDF (nur Windows-Build)

Die Festbüro-App druckt PDFs unter Windows ohne Druckdialog mit **SumatraPDF**
(`SumatraPDF.exe -print-to "<Drucker>" -print-settings "<Kopien>x" -silent "<datei.pdf>"`).
SumatraPDF wird als **eigenständiges, unverändertes Programm** mit dem Windows-Installer ausgeliefert
und von der App nur als externer Prozess aufgerufen.

| | |
| --- | --- |
| Programm | SumatraPDF, portable 64-Bit-Version |
| Version | 3.6.1 |
| Herkunft | offizielle Projektseite: <https://www.sumatrapdfreader.org/download-free-pdf-viewer> |
| Download | <https://www.sumatrapdfreader.org/dl/rel/3.6.1/SumatraPDF-3.6.1-64.zip> |
| SHA-256 (ZIP) | `98b33a518d42986856d225064b0cd2d3643ecf78cbf84ab873d26cc51877a544` |
| SHA-256 (EXE) | `719f689b34f47be8ca105ce8484948474dafde0e106bab599e4a89326070c3d0` |
| Quellcode | <https://github.com/sumatrapdfreader/sumatrapdf/tree/3.6.1rel> |
| Lizenz | GNU GPL Version 3 bzw. AGPL Version 3 (MuPDF); einzelne Teile BSD-Lizenz (siehe `AUTHORS` im Quellcode) |

## Dateien in diesem Ordner

| Datei | Inhalt | eingecheckt |
| --- | --- | --- |
| `SumatraPDF.exe` | das Programm (wird per Skript geladen) | nein (`.gitignore`) |
| `COPYING-SumatraPDF.txt` | GNU General Public License v3 (aus dem Quellcode, Tag `3.6.1rel`) | ja |
| `COPYING-MuPDF-AGPL.txt` | GNU Affero General Public License v3 der enthaltenen MuPDF-Bibliothek | ja |
| `COPYING-SumatraPDF-BSD.txt` | BSD-Lizenz für die entsprechend gekennzeichneten Teile | ja |
| `README.md` | diese Datei | ja |

Alle Dateien werden im Windows-Installer nach `<Installationsordner>\resources\win\` kopiert, damit der
Lizenztext zusammen mit dem Programm ausgeliefert wird.

## Laden und prüfen

```bash
npm run fetch:sumatra     # läuft automatisch vor npm run dist:win
```

`scripts/fetch-sumatra.mjs` lädt die fest eingetragene Version von der offiziellen Seite, prüft die
SHA-256-Prüfsummen von ZIP und EXE und legt die Datei als `resources/win/SumatraPDF.exe` ab. Ohne
Internet: `FESTBUERO_SUMATRA_ZIP=/pfad/SumatraPDF-3.6.1-64.zip npm run fetch:sumatra`.

## Version aktualisieren

1. Neue Version auf der offiziellen Seite prüfen (Portable 64-Bit-ZIP).
2. In `scripts/fetch-sumatra.mjs` `SUMATRA_VERSION`, `ZIP_SHA256` und `EXE_SHA256` anpassen
   (Prüfsummen einmalig mit `shasum -a 256` ermitteln).
3. Lizenztexte aus dem passenden Tag des Quellcodes übernehmen und diese Tabelle aktualisieren.
4. Den stillen Druck unter Windows mit dem echten Festdrucker testen.

## Hinweis zur Lizenz

SumatraPDF ist freie Software. Die Weitergabe als eigenständiges Programm ist nach GPLv3 erlaubt,
sofern der Lizenztext beiliegt und der Quellcode der verwendeten Version zugänglich ist (Link oben).
Die Festbüro-App selbst ist kein abgeleitetes Werk von SumatraPDF; sie ruft das unveränderte Programm
nur über die Kommandozeile auf.
