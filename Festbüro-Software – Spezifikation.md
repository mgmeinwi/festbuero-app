# Festbüro-Software – Spezifikation

## Ziel und Technologie

Gebaut wird eine installierbare Desktop-App für macOS und Windows. Mit ihr erstellt das Festbüro eines Gründungsfests Rechnungen an Vereine und Einzelpersonen, legt sie als PDF ab und druckt sie ohne Dialog automatisch. Die App läuft vollständig lokal, ohne Netzwerk und ohne Server.

**Rahmenbedingungen**

- Komplett offline, keine Cloud, keine Anmeldung.
- Mehrere Gründungsfeste in einer Installation, Daten pro Fest sauber getrennt.
- Rechnungs-PDFs landen in einem Dokumentenordner, den der Nutzer beim ersten Start wählt. Interne Daten (Datenbank, Logos) liegen im App-Datenverzeichnis des Betriebssystems.
- Oberfläche auf Deutsch, modernes Design, schnell mit Tastatur bedienbar.

**Technologie-Stack (Vorgabe für Claude Code)**

| Bereich | Entscheidung | Begründung |
| --- | --- | --- |
| App-Rahmen | Electron + TypeScript | Einheitliches Verhalten auf macOS und Windows, ausgereifte Drucker-APIs |
| Oberfläche | React + Vite, Tailwind CSS, shadcn/ui | Modernes, konsistentes Design |
| Datenbank | SQLite über better-sqlite3 | Lokal, transaktionssicher, eindeutige Rechnungsnummern per Constraint |
| PDF | Rechnung als HTML/CSS (A4, mm-Maße), PDF über `webContents.printToPDF` | Vorschau und PDF nutzen dieselbe Vorlage, also identisches Ergebnis |
| Druck Windows | Gebündeltes SumatraPDF im Silent-Modus mit Druckername und Kopienzahl | Zuverlässigster Weg, PDFs ohne Dialog zu drucken |
| Druck macOS | CUPS-Befehl `lp -d <Drucker> -n <Kopien> <datei.pdf>` | Systemeigen, kein Dialog |
| Druckerliste | `webContents.getPrintersAsync()` | Liefert installierte Drucker auf beiden Systemen |
| Excel | exceljs (Import und Export) | Liest .xlsx und schreibt formatierte Auswertungen |
| ZIP | archiver | Bulk-Export von PDFs |
| Installer | electron-builder: .dmg (macOS), NSIS-.exe (Windows) | Normale Installation wie jedes Programm |

Gedruckt wird immer das archivierte PDF und nicht eine neu gerenderte Ansicht. So ist garantiert, dass Papier und Ablage übereinstimmen.

## Datenmodell und Datenhaltung

Alle Daten liegen in einer SQLite-Datei im App-Datenverzeichnis. Jede fachliche Tabelle hängt an genau einem Gründungsfest. Beträge werden in Cent als Ganzzahl gespeichert, nie als Kommazahl.

| Tabelle | Wichtige Felder | Hinweise |
| --- | --- | --- |
| `app_settings` | Dokumentenordner, Standarddrucker, zuletzt geöffnetes Fest | Gilt pro Rechner |
| `festival` | Name, Festdatum (Leistungsdatum), Präfix, Startnummer, nächste Nummer, Stellenzahl, Kopienzahl (Standard 2), Steuerbefreiung ja/nein, Dateinamensmuster, archiviert | Ein Datensatz pro Gründungsfest |
| `product` | Bezeichnung, Bruttopreis (Cent), MwSt-Satz (7 oder 19), Modus (`pro_person` oder `feste_anzahl`), Standardanzahl, Sortierung, aktiv | Gehört zu einem Fest |
| `club` | Name (Ansprechpartner), Verein, Straße, PLZ, Ort, angemeldete Personen | Aus Excel-Import, pro Fest |
| `template` | Blöcke und Einstellungen als JSON, Logo-Datei | Eine Vorlage pro Fest |
| `payment_method` | Art (`bar`, `ueberweisung`), Text, Zahlungsfrist in Tagen (Standard 7) | Texte pro Fest anpassbar |
| `invoice` | Nummer (eindeutig), Typ (Rechnung/Storno), Bezug auf Original, Kunde als Kopie, Personenzahl, Zahlart, Datum, Summen, Status, PDF-Pfad, Druckstatus | Unveränderlich nach Abschluss |
| `invoice_line` | Bezeichnung, Bruttopreis, MwSt-Satz, Menge, Zeilensumme | Kopie der Produktdaten zum Zeitpunkt der Rechnung |

**Regeln**

- Eine abgeschlossene Rechnung speichert eine vollständige Kopie von Kunde, Positionen, Preisen, Steuersätzen und Vorlage. Spätere Änderungen an Produkten, Vereinsstamm oder Vorlage verändern alte Rechnungen nie.
- `invoice.number` hat einen UNIQUE-Constraint über alle Feste. Eine Nummer kann damit technisch nicht doppelt existieren.
- Abgeschlossene Rechnungen werden nie gelöscht oder bearbeitet. Korrekturen laufen ausschließlich über Storno.
- Datenbank-Migrationen sind versioniert, damit Updates der App keine Daten verlieren.
- Unter Einstellungen gibt es eine Funktion „Datensicherung erstellen“, die Datenbank und Logos in eine ZIP im Dokumentenordner kopiert.

## Gründungsfeste, Produkte und Vereinsstamm

Jedes Gründungsfest ist ein abgeschlossener Arbeitsbereich mit eigenen Einstellungen, Produkten, Vereinen, Vorlage und Rechnungen. Oben in der App wählt man das aktive Fest.

**Einstellungen pro Gründungsfest**

- Name des Fests und Festdatum (Standard für das Leistungsdatum).
- Rechnungsnummer: Präfix (z. B. `2025-`), Startnummer, Stellenzahl mit führenden Nullen (z. B. 3 ergibt `081`). Die Startnummer ist nur änderbar, solange noch keine Rechnung abgeschlossen wurde.
- Kopienzahl pro Druck (Standard 2).
- Steuerbefreiung (Haken) mit anpassbarem Hinweistext, Standard: „Als Kleinunternehmer im Sinne von § 19 UStG wird keine Umsatzsteuer berechnet.“
- Zahlungsarten mit Texten (siehe unten).
- Dateinamensmuster für PDFs, Standard `{Rechnungsnummer}`.
- Fest kopieren: übernimmt Produkte, Vorlage und Einstellungen in ein neues Fest, ohne Vereine und Rechnungen.

**Zahlungsarten**

| Zahlart | Standard | Vorbelegter Text (pro Fest änderbar) |
| --- | --- | --- |
| Bar | Ja | `Betrag bar erhalten ____________________` (Unterschriftslinie) |
| Überweisung | Nein | `Bitte überweisen Sie den Betrag von {Gesamtbetrag} bis zum {Fälligkeitsdatum} unter Angabe der Rechnungsnummer {Rechnungsnummer} auf das unten genannte Konto.` |

Das Fälligkeitsdatum ergibt sich aus Rechnungsdatum plus Zahlungsfrist, Standard 7 Tage.

**Produkte**

- Felder: Bezeichnung, Bruttopreis, MwSt-Satz (7 % oder 19 %), Modus, Standardanzahl, Reihenfolge per Drag-and-drop, aktiv/inaktiv.
- Modus `pro Person`: Menge wird standardmäßig auf die Zahl der kommenden Personen gesetzt.
- Modus `feste Anzahl`: Menge wird auf die hinterlegte Standardanzahl gesetzt, z. B. 1 für die Festschrift.
- Bei aktivierter Steuerbefreiung bleibt der MwSt-Satz gespeichert, wird aber nirgends ausgewiesen.
- Produkte, die in Rechnungen verwendet wurden, lassen sich nur deaktivieren, nicht löschen.

**Vereinsstamm per Excel-Import**

Erwartete Spalten laut Beispieldatei: `Name`, `Verein`, `Straße`, `PLZ`, `Ort`, `ang. Personen`.

- Die Kopfzeile wird anhand der Spaltennamen erkannt, nicht anhand der Position. Kleine Abweichungen (Groß-/Kleinschreibung, Leerzeichen) werden toleriert.
- PLZ wird als Text gelesen, damit führende Nullen erhalten bleiben.
- Vor dem Import zeigt eine Vorschau die Anzahl der Zeilen und fehlerhafte Zeilen, z. B. fehlender Vereinsname oder keine Zahl bei Personen.
- Ein erneuter Import ersetzt den gesamten importierten Vereinsstamm dieses Fests, nach Bestätigung. Bereits erstellte Rechnungen bleiben unverändert, da sie eigene Kopien der Daten tragen. Manuell angelegte Vereine bleiben auch unberührt (außer Vereinsame ist doppelt)
- Vereine sind zusätzlich manuell anlegbar und bearbeitbar.
- Es soll eine Vorlagen-Datei exportiert werden können, in der z.B. der Vorstand dann die ganzen Anmeldungen sammeln kann und diese Datei wieder zurück schickt

## Festbüro-Maske

Die Festbüro-Maske ist der Hauptbildschirm. Eine Rechnung ist in drei Schritten erstellt. Links stehen die Eingaben, rechts zeigt eine Live-Vorschau die fertige Rechnung als A4-Seite. Der Endbetrag ist immer groß und gut sichtbar.

**Aufbau**

- Kopfleiste auf allen Ansichten: aktives Gründungsfest, Druckerauswahl (Dropdown, sofort änderbar, gespeichert pro Rechner), Zugang zu Einstellungen.
- Linke Spalte: Schritte 1 bis 3, darunter fest angedockt Endbetrag, Zahlart und der Button „Abschließen & drucken“.
- Rechte Spalte: Vorschau, aktualisiert sich bei jeder Eingabe. Sie ist ein- und ausklappbar und auf kleinen Bildschirmen als Fenster zu öffnen.

**Schritt 1: Kunde wählen**

1. Ein Suchfeld mit Freitextsuche über Verein, Name, Ort und PLZ, fehlertolerant (z. B. Fuse.js). Der Fokus liegt beim Öffnen direkt im Feld.
2. Die Trefferliste zeigt Verein, Ansprechpartner, Ort und angemeldete Personen. Auswahl per Pfeiltasten und Enter.
3. Alternativ der Button **Einzelrechnung**. Im Anschriftfeld steht dann standardmäßig nur „Einzelrechnung“. Optional lassen sich Name, Straße, PLZ und Ort eingeben, die dann im Anschriftfeld erscheinen.

**Schritt 2: Personenzahl (nur bei Vereinen)**

- Eingabe der tatsächlich kommenden Personen. Die angemeldete Zahl wird daneben als Hinweis angezeigt, z. B. „angemeldet: 45“.
- Bei einer Einzelrechnung entfällt dieser Schritt komplett.

**Schritt 3: Positionen**

- Alle aktiven Produkte des Fests in der festgelegten Reihenfolge. Pro Zeile: Bezeichnung, Einzelpreis, Mengenfeld, Zeilensumme.
- Vorbelegung bei Vereinen: Modus `pro Person` setzt die Menge auf die kommenden Personen, Modus `feste Anzahl` auf die Standardanzahl.
- Neben jedem Mengenfeld stehen bei Vereinen drei Schnellwahl-Buttons: **0**, **1×** (Menge = kommende Personen), **2×** (Menge = 2 × kommende Personen).
- Ändert sich die Personenzahl, werden alle Zeilen neu vorbelegt, die nicht von Hand geändert wurden. Von Hand geänderte Zeilen sind markiert und bleiben stehen.
- Bei einer Einzelrechnung sind alle Mengen leer (0), und es gibt keine Schnellwahl-Buttons.
- Tab springt von Mengenfeld zu Mengenfeld, damit die Eingabe ohne Maus schnell geht.

**Abschluss**

- Zahlart wählen: Bar ist vorausgewählt, Überweisung ist möglich.
- Endbetrag groß angezeigt. Ohne Steuerbefreiung zusätzlich Netto und MwSt je Satz.
- „Abschließen & drucken“ (Kurzbefehl Strg/Cmd + Enter) vergibt die Nummer, erzeugt das PDF, legt es ab und druckt es ohne weiteren Dialog.
- Danach erscheint eine Erfolgsmeldung mit Rechnungsnummer und Endbetrag sowie den Buttons „Erneut drucken“, „PDF öffnen“ und „Neue Rechnung“. „Neue Rechnung“ springt zurück in das Suchfeld.
- Eine Rechnung mit Endbetrag 0 € lässt sich nicht abschließen.

## Rechnungsvorlage und Editor

Die Vorlage wird blockweise aufgebaut und folgt dem Layout der Beispielrechnung (DIN 5008, A4). Jeder Block hat eine feste Position im Seitenraster und einen frei formatierbaren Inhalt. Grafiken werden nicht frei verschoben, sondern über vordefinierte Positionen platziert.

**Blöcke (von oben nach unten)**

| Block | Position | Inhalt im Beispiel |
| --- | --- | --- |
| Logo | wählbar: links oben, mittig oben, rechts oben; Größe in mm | Vereinswappen rechts oben |
| Rücksendezeile | über dem Anschriftfeld, kleine Schrift | Verein, Straße, PLZ Ort in einer Zeile |
| Anschriftfeld | links, DIN-5008-Fensterposition | Name, Verein, Straße, PLZ Ort bzw. „Einzelrechnung“ |
| Absenderblock | rechts oben, rechtsbündig | Vereinsname, Adresse, E-Mail, Ansprechpartner |
| Infoblock | rechts unter dem Absender | Leistungsdatum, Rechnungsdatum, Rechnungsnummer |
| Betreff | über der Tabelle | „Rechnung Nr. {Rechnungsnummer}“ |
| Einleitungstext | unter dem Betreff | „Leistungen im Rahmen des 100jährigen Gründungsfestes.“ |
| Positionstabelle | automatisch erzeugt | Bezeichnung, Einzelpreis, Menge, Summe, Gesamt |
| Steuer- bzw. Hinweistexte | unter der Tabelle | § 19-Hinweis, durchlaufende Posten, Festessen im Namen von … |
| Zahlungstext | darunter | „Betrag bar erhalten \_\_\_\_“ oder Überweisungstext |
| Fußzeile | Seitenende, 1 bis 4 Spalten | Registergericht, St.-Nr., Vorstand, Bankverbindung |

**Editor**

- Jeder Textblock hat einen einfachen Rich-Text-Editor (z. B. TipTap): fett, kursiv, unterstrichen, Schriftgröße, Ausrichtung, Zeilenumbrüche.
- Schriftart global für die ganze Vorlage wählbar, mit einer Auswahl gebündelter Schriften, die auf beiden Systemen identisch rendern.
- Freie Textblöcke lassen sich an definierten Stellen hinzufügen, entfernen und in der Reihenfolge verschieben, z. B. mehrere Hinweistexte unter der Tabelle.
- Platzhalter werden per Button „Feld einfügen“ als nicht trennbarer Baustein eingefügt.
- Der Editor zeigt rechts dieselbe Live-Vorschau wie die Festbüro-Maske, mit Beispieldaten.

**Positionstabelle**

- Spalten: Bezeichnung, Einzelpreis, Menge, Summe. Ohne Steuerbefreiung optional eine Spalte MwSt-Satz.
- Schalter „Positionen mit Menge 0 anzeigen“, Standard an wie im Beispiel. Nullbeträge erscheinen als „– €“.
- Summenbereich mit Steuerbefreiung: nur „Gesamt“, keine Steuer.
- Summenbereich ohne Steuerbefreiung: Gesamt brutto, enthaltene MwSt getrennt nach 7 % und 19 %, Nettobetrag. Die Steuer wird aus den Bruttopreisen herausgerechnet und pro Steuersatz auf Rechnungsebene gerundet.
- Passen die Positionen nicht auf eine Seite, bricht die Tabelle sauber um, mit wiederholter Kopfzeile und Fußzeile auf jeder Seite.

**Platzhalter**

| Platzhalter | Beispiel |
| --- | --- |
| `{Rechnungsnummer}` | 2025-081 |
| `{Rechnungsdatum``_``L``a``n``g``}` | 1. Juni 2025 |
| `{Rechnungsdatum_``D``E``}` | 06.01.2025 |
| `{Rechnungsdatum_``m``m``m``m``M``M``dd``D``D``.``.``.``}`` ``-`` ``Z``e``i``gt nach`` ``d``e``n`` ``s``tanda``rtisi``erten I``SO C`` odes  ``e``i``n`` e  ``m``anuel`` le Form  ``d`` es  ``Datums`` ``a``n``.` | Je nachdem wie man die Form wählt |
| `{Leistungsdatum_``.``.``.``}`` ``H``ie``r`` ``das gl`` eiche  ``w`` ie  `` beim  ``R``e``c``h``nungsd``atum` | 1. Juni 2025 / 2025-06-01 |
| `{Heute``_``.``.``.``}` Hier ebenfalls die gleichen Varianten wie beim Rechnungsdatum | aktuelles Datum |
| `{Fälligkeitsdatum``_``.``.``.``}`` `Hier ebenfalls die gleichen Varianten wie beim Rechnungsdatum | Rechnungsdatum + Zahlungsfrist |
| `{Gesamtbetrag}` | 670,20 € |
| `{Verein}`, `{Name}`, `{Straße}`, `{PLZ}`, `{Ort}` | Kundendaten |
| `{Personen}` | kommende Personen |
| `{Zahlart}` | Bar / Überweisung |
| `{Festname}` | Name des Gründungsfests |
| `{Originalrechnung}` | nur bei Storno: Nummer der stornierten Rechnung |

## Abschluss, Ablage, Druck und Storno

Beim Abschließen werden Nummer, PDF und Druck in fester Reihenfolge abgearbeitet. Ein Druckfehler darf nie dazu führen, dass eine Nummer verloren geht oder doppelt vergeben wird.

**Ablauf beim Abschließen**

1. In einer einzigen Datenbank-Transaktion: nächste Nummer des Fests lesen, Zähler erhöhen, Rechnung mit allen Kopien der Daten speichern. Die Nummer setzt sich aus Präfix und aufgefüllter Zahl zusammen, z. B. `2025-` + `081`.
2. PDF aus der Vorlage erzeugen und im Dokumentenordner speichern.
3. Das gespeicherte PDF mit der eingestellten Kopienzahl an den gewählten Drucker senden, ohne Dialog.
4. Status der Rechnung setzen: PDF vorhanden, gedruckt ja/nein, Druckzeitpunkt.

**Fehlerfälle**

- Schlägt der Druck fehl (Drucker aus, nicht gefunden, kein Papier), bleibt die Rechnung gültig und abgeschlossen. Ein deutlicher Hinweis erscheint mit „Erneut drucken“ und der Möglichkeit, einen anderen Drucker zu wählen.
- Schlägt die PDF-Erzeugung fehl, wird sie beim nächsten Öffnen der Rechnung automatisch nachgeholt. Die Nummer bleibt bestehen.
- Ist der gespeicherte Drucker beim Start nicht verfügbar, zeigt die Kopfleiste eine Warnung.
- In den Einstellungen gibt es eine Testseite, um den Druck mit einer Musterrechnung vorab zu prüfen.

**Ablage**

- Ordnerstruktur: `<Dokumentenordner>/<Festname>/Rechnungen/<Dateiname>.pdf`, Stornos unter `<Festname>/Stornos/`.
- Der Dateiname folgt dem Muster aus den Einstellungen, Standard `{Rechnungsnummer}`. Das Muster muss die Rechnungsnummer enthalten, damit Dateinamen eindeutig bleiben. Unzulässige Zeichen für Windows oder macOS werden ersetzt.
- Abgelegte PDFs werden nie überschrieben.

**Storno**

- In der Rechnungsliste hat jede abgeschlossene Rechnung die Aktion „Stornieren“, mit Pflichtfeld für den Grund.
- Die Stornorechnung erhält eine neue Nummer aus derselben fortlaufenden Reihe. Alle Positionen und Summen sind negativ. Der Betreff lautet „Stornorechnung Nr. {Rechnungsnummer} zu Rechnung Nr. {Originalrechnung}“.
- Die Originalrechnung wird als „storniert“ markiert und bleibt sichtbar. Eine Rechnung kann nur einmal storniert werden.
- „Stornieren und neu erstellen“ öffnet zusätzlich die Festbüro-Maske mit den Daten der alten Rechnung zur Korrektur.
- Stornos werden wie Rechnungen abgelegt und gedruckt.

## Auswertung und Export

Pro Gründungsfest gibt es eine Rechnungsliste und eine Auswertung. Beide lassen sich nach Excel exportieren. Stornos werden in allen Summen gegengerechnet.

**Rechnungsliste**

- Spalten: Nummer, Datum, Kunde, Personen, Zahlart, Betrag, Status (abgeschlossen, storniert, Storno), gedruckt ja/nein.
- Suche, Filter nach Zeitraum, Zahlart und Status, Sortierung.
- Einzelaktionen: Vorschau, PDF öffnen, erneut drucken, PDF exportieren (Speichern unter), stornieren.
- Mehrfachauswahl oder „Alle“: Export als ZIP mit allen PDFs und Bulk-Druck.

**Auswertung (Bildschirm)**

- Kennzahlen: Anzahl Rechnungen, Anzahl Stornos, Gesamtumsatz, davon bar und per Überweisung, Anzahl Personen.
- Umsatz und Menge pro Produkt.
- Umsatz nach Steuersatz mit Netto und MwSt, sofern keine Steuerbefreiung gilt.
- Umsatz pro Tag, für Feste über mehrere Tage.
- Vereine aus dem Stamm, die noch keine Rechnung haben.

**Excel-Export der Auswertung**

| Tabellenblatt | Inhalt |
| --- | --- |
| Übersicht | Kennzahlen, Festname, Exportzeitpunkt |
| Rechnungen | Eine Zeile pro Rechnung bzw. Storno mit allen Kopf- und Summenfeldern |
| Positionen | Eine Zeile pro Rechnungsposition, filterbar |
| Produkte | Menge und Umsatz pro Produkt |
| Steuer | Netto, MwSt und Brutto pro Steuersatz |
| Zahlarten | Summen pro Zahlart, offene Überweisungen mit Fälligkeitsdatum |
| Vereine | Angemeldete vs. tatsächlich abgerechnete Personen pro Verein |

Beträge werden im Excel als echte Zahlen mit Währungsformat geschrieben, damit man weiterrechnen kann.

## UX, Installation und Umsetzung

Die App soll sich im Festbetrieb unter Zeitdruck schnell und fehlerarm bedienen lassen. Die Umsetzung erfolgt in Phasen, von denen jede für sich lauffähig und testbar ist.

**UX-Grundsätze**

- Großzügige Klickflächen, gut lesbare Schrift, heller und dunkler Modus.
- Fensterknöpfe (macOS-Ampel bzw. Windows-Schließen/Minimieren/Maximieren) sind sauber in die App-Kopfleiste integriert, kein separater weißer System-Titelbalken.
- Die wichtigsten Funktionen sind auch über die macOS-Menüleiste erreichbar (Ablage, Bearbeiten, Fest, Darstellung, Drucker, Fenster, Hilfe), unter Windows über einen Menü-Button in der Kopfleiste. Alle Einträge haben passende Kurzbefehle.
- Responsive Oberfläche: Auch bei verkleinertem Fenster am Laptop und im Splitscreen (halber Bildschirm, bis mindestens 600 × 560) funktioniert alles problemlos, ohne horizontales Scrollen und ohne abgeschnittene Bedienelemente.
- Komplett per Tastatur bedienbar: Suche, Auswahl, Mengen, Abschluss.
- Jede Aktion gibt sichtbares Feedback (Toast-Meldungen). Destruktive Aktionen wie Import-Überschreiben und Storno fragen nach.
- Ersteinrichtungs-Assistent beim ersten Start: Dokumentenordner wählen, Drucker wählen, erstes Gründungsfest anlegen.
- Navigation: Festbüro · Rechnungen · Auswertung · Fest-Einstellungen (Produkte, Vereine, Vorlage, Nummern, Zahlarten) · App-Einstellungen.

**Installation und Auslieferung**

- macOS: .dmg für Apple Silicon und Intel (Universal Build). Windows: NSIS-Installer (.exe) für x64.
- SumatraPDF wird im Windows-Build mitgeliefert. Die Lizenz (GPLv3) erlaubt die Weitergabe als eigenständiges Programm.
- Ohne Code-Signierung zeigen macOS (Gatekeeper) und Windows (SmartScreen) beim ersten Start Warnungen. Für eine saubere Installation braucht es ein Apple-Developer-Konto und ein Windows-Code-Signing-Zertifikat.
- Der stille Druck muss vor dem Fest auf beiden Systemen mit dem echten Festdrucker getestet werden.

**Umsetzungsphasen für Claude Code**

1. Projektgerüst: Electron + React + TypeScript + Vite, electron-builder, SQLite mit Migrationen, Grundlayout mit Navigation und Kopfleiste.
2. Gründungsfeste, Einstellungen, Produkte, Zahlarten.
3. Excel-Import des Vereinsstamms mit Vorschau und Fehleranzeige.
4. Vorlagen-Renderer (HTML/CSS, A4) mit fest codierter Beispielvorlage nach dem Muster der Beispielrechnung, plus Live-Vorschau.
5. Festbüro-Maske mit Suche, Personenzahl, Positionen, Schnellwahl, Einzelrechnung.
6. Abschluss: Nummernvergabe in Transaktion, PDF-Erzeugung, Ablage.
7. Stiller Druck auf macOS und Windows, Druckerauswahl, Testseite, Fehlerbehandlung.
8. Vorlagen-Editor mit Blöcken, Rich Text, Platzhaltern, Logo-Positionen, Fußzeilenspalten.
9. Rechnungsliste, Storno, Einzel- und ZIP-Export.
10. Auswertung und Excel-Export.
11. Ersteinrichtung, Datensicherung, Feinschliff, Installer für beide Plattformen.
12. Alles soll ins Git-Repository commitet und gepusht werden. Falls es noch nicht eingerichtet ist, soll es mit eingerichtet werden

**Tests**

- Unit-Tests (Vitest) für Steuerberechnung, Rundung, Nummernvergabe, Platzhalter-Ersetzung und Excel-Import.
- Prüfung: Die Beispielrechnung (670,20 €) muss sich mit den Daten aus dem Muster exakt reproduzieren lassen.
- End-to-End-Tests (Playwright für Electron) für den Ablauf Suche → Positionen → Abschluss.

**Offene Punkte**

- [ ] Arbeiten am Fest mehrere Rechner gleichzeitig? Ohne Netzwerk kennt kein Rechner die Nummern des anderen. Vorschlag: pro Rechner eine Platzkennung im Präfix, z. B. `2025-A-` und `2025-B-`, oder nur ein Rechner pro Fest. - Nur ein Rechner gleichzeitig
- [ ] Soll die Personenzahl in Schritt 2 leer starten oder mit der angemeldeten Zahl vorbelegt sein? - Ja soll vorbelegt sein
- [ ] Braucht die Festbüro-Maske eine freie Zusatzposition für Dinge, die nicht als Produkt angelegt sind? - Kann man integrieren, ist aber wirklich nur für den absulten Ausnahmefall
- [ ] Ist das Rechnungsdatum immer der aktuelle Tag und das Leistungsdatum immer das Festdatum, oder soll beides pro Rechnung änderbar sein? - man soll es pro Rechnung auch manuell überschreiben können - ist aber Ausnahmefall und soll demenentsprechend auch so in der UX berücksichtigt werden (dass es nicht zu voll wird)
- [ ] Ist Code-Signierung für macOS und Windows gewünscht (Kosten für Konten und Zertifikat)? - Keine Ahnung
