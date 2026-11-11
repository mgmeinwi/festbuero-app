/**
 * Domänentypen der Festbüro-App.
 *
 * VERTRAG: Diese Datei wird von Main-Prozess, Preload und Renderer gemeinsam genutzt.
 * Keine Node-/Electron-/DOM-Importe. Änderungen nur additiv (neue optionale Felder,
 * neue Typen) – bestehende Felder nicht umbenennen oder entfernen.
 *
 * Konventionen:
 * - Beträge immer in Cent als Ganzzahl (`Cents`), nie als Kommazahl.
 * - Datumswerte als ISO-String `YYYY-MM-DD` (`IsoDate`), Zeitpunkte als ISO 8601 (`IsoDateTime`).
 * - Rich-Text-Inhalte sind HTML-Strings (TipTap `getHTML()`), Platzhalter stehen als `{Name}` im Text.
 */

export type Cents = number
export type IsoDate = string
export type IsoDateTime = string

export type VatRate = 7 | 19
export const VAT_RATES: readonly VatRate[] = [7, 19] as const

export type ProductMode = 'pro_person' | 'feste_anzahl'
export type PaymentKind = 'bar' | 'ueberweisung'
export type InvoiceType = 'rechnung' | 'storno'
/** Status eines Belegs. Stornobelege selbst haben Status 'abgeschlossen' und Typ 'storno'. */
export type InvoiceStatus = 'abgeschlossen' | 'storniert'
export type CustomerKind = 'verein' | 'einzel'
export type ClubSource = 'import' | 'manual'

/* ------------------------------------------------------------------ */
/* App-Einstellungen (pro Rechner)                                     */
/* ------------------------------------------------------------------ */

export type ThemePreference = 'system' | 'light' | 'dark'

export interface AppSettings {
  /** Wurzelordner für Rechnungs-PDFs, beim ersten Start gewählt. */
  documentsDir: string | null
  /** Name des Druckers (PrinterInfo.name), gespeichert pro Rechner. */
  defaultPrinter: string | null
  lastFestivalId: number | null
  setupCompleted: boolean
  theme: ThemePreference
}

/* ------------------------------------------------------------------ */
/* Gründungsfest                                                       */
/* ------------------------------------------------------------------ */

export interface Festival {
  id: number
  name: string
  /** Festdatum = Standard-Leistungsdatum */
  festivalDate: IsoDate
  /** z. B. "2025-" */
  numberPrefix: string
  /** nur änderbar, solange keine Rechnung abgeschlossen ist */
  numberStart: number
  /** nächste zu vergebende laufende Nummer */
  numberNext: number
  /** Stellenzahl mit führenden Nullen, z. B. 3 → "081" */
  numberDigits: number
  /** Kopienzahl pro Druck, Standard 2 */
  copies: number
  taxExempt: boolean
  taxExemptText: string
  /** Muster für PDF-Dateinamen, muss {Rechnungsnummer} enthalten */
  filenamePattern: string
  archived: boolean
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  /** abgeleitet: true, sobald mindestens ein Beleg existiert */
  hasInvoices: boolean
}

export interface FestivalCreateInput {
  name: string
  festivalDate: IsoDate
  numberPrefix: string
  numberStart: number
  numberDigits: number
  copies?: number
  taxExempt?: boolean
  taxExemptText?: string
  filenamePattern?: string
}

export type FestivalUpdateInput = Partial<
  Pick<
    Festival,
    | 'name'
    | 'festivalDate'
    | 'numberPrefix'
    | 'numberStart'
    | 'numberDigits'
    | 'copies'
    | 'taxExempt'
    | 'taxExemptText'
    | 'filenamePattern'
    | 'archived'
  >
>

export interface FestivalCopyInput {
  name: string
  festivalDate: IsoDate
  numberPrefix: string
  numberStart: number
}

/* ------------------------------------------------------------------ */
/* Produkte                                                            */
/* ------------------------------------------------------------------ */

export interface Product {
  id: number
  festivalId: number
  name: string
  /** Bruttopreis in Cent */
  priceCents: Cents
  vatRate: VatRate
  mode: ProductMode
  /** Menge bei Modus 'feste_anzahl' (z. B. 1 für Festschrift) */
  defaultQuantity: number
  sortOrder: number
  active: boolean
  /** abgeleitet: in mindestens einer Rechnung verwendet → nur deaktivierbar */
  usedInInvoices: boolean
}

export interface ProductInput {
  name: string
  priceCents: Cents
  vatRate: VatRate
  mode: ProductMode
  defaultQuantity: number
  active?: boolean
}

/* ------------------------------------------------------------------ */
/* Zahlungsarten                                                       */
/* ------------------------------------------------------------------ */

export interface PaymentMethod {
  id: number
  festivalId: number
  kind: PaymentKind
  /** Anzeigename, z. B. "Bar" / "Überweisung" (Platzhalter {Zahlart}) */
  label: string
  /** Rich-Text (HTML) mit Platzhaltern, erscheint im Block „Zahlungstext“ */
  text: string
  /** Zahlungsfrist in Tagen, Standard 7 */
  dueDays: number
  /** vorausgewählte Zahlart (Standard: bar) */
  isDefault: boolean
}

export type PaymentMethodUpdateInput = Partial<Pick<PaymentMethod, 'label' | 'text' | 'dueDays' | 'isDefault'>>

/* ------------------------------------------------------------------ */
/* Vereinsstamm                                                        */
/* ------------------------------------------------------------------ */

export interface Club {
  id: number
  festivalId: number
  /** Spalte „Name“ = Ansprechpartner */
  contactName: string
  /** Spalte „Verein“ */
  clubName: string
  street: string
  /** immer Text, führende Nullen bleiben erhalten */
  zip: string
  city: string
  /** Spalte „ang. Personen“ */
  registeredPersons: number
  source: ClubSource
  /** abgeleitet: es existiert eine (nicht stornierte) Rechnung für diesen Verein */
  hasInvoice: boolean
}

export interface ClubInput {
  contactName: string
  clubName: string
  street: string
  zip: string
  city: string
  registeredPersons: number
}

export interface ClubImportRow {
  /** Zeilennummer in der Excel-Datei (1-basiert, inkl. Kopfzeile) */
  rowNumber: number
  contactName: string
  clubName: string
  street: string
  zip: string
  city: string
  registeredPersons: number | null
  /** leer = Zeile gültig; sonst deutsche Fehlermeldungen */
  errors: string[]
  /** Hinweise, die den Import nicht verhindern (z. B. Vereinsname mehrfach in der Datei) */
  warnings?: string[]
}

export interface ClubImportPreview {
  filePath: string
  sheetName: string
  /** Datenzeilen ohne Kopfzeile und ohne komplett leere Zeilen */
  totalRows: number
  validRows: number
  rows: ClubImportRow[]
  /** Pflichtspalten, die nicht gefunden wurden (Import dann nicht möglich) */
  missingColumns: string[]
  /** Anzahl der aktuell importierten Vereine, die ersetzt würden */
  existingImportedCount: number
  /** Namen manuell angelegter Vereine, die wegen gleichem Vereinsnamen ersetzt würden */
  replacedManualClubs: string[]
  /** optionale Spalten (Name, Straße, PLZ, Ort), die nicht gefunden wurden – nur Hinweis */
  missingOptionalColumns?: string[]
  /** Zeilennummer der erkannten Kopfzeile (1-basiert); null, wenn keine gefunden wurde */
  headerRow?: number | null
}

export interface ClubImportResult {
  imported: number
  skipped: number
  removedImported: number
  removedManual: number
}

/* ------------------------------------------------------------------ */
/* Rechnungsvorlage                                                    */
/* ------------------------------------------------------------------ */

/** Gebündelte Schriften – müssen auf macOS und Windows identisch rendern. */
export type FontId = 'arimo' | 'tinos' | 'inter' | 'roboto' | 'open-sans' | 'lato' | 'source-sans-3'
export type TextAlign = 'left' | 'center' | 'right' | 'justify'
export type LogoPosition = 'left' | 'center' | 'right'

export interface RichTextBlock {
  id: string
  /** HTML aus dem Rich-Text-Editor, darf Platzhalter {…} enthalten */
  html: string
  fontSizePt?: number
  align?: TextAlign
}

export interface InfoRow {
  id: string
  /** z. B. "Leistungsdatum" (fett im Beispiel) */
  label: string
  /** Wert mit Platzhaltern, z. B. "{Leistungsdatum}" */
  value: string
}

export interface TemplateConfig {
  version: 1
  fontFamily: FontId
  /** Grundschriftgröße in pt (Beispielrechnung ≈ 11 pt) */
  baseFontSizePt: number
  logo: { enabled: boolean; position: LogoPosition; widthMm: number }
  /** Rücksendezeile über dem Anschriftfeld, kleine Schrift */
  returnLine: RichTextBlock
  /** Anschriftfeld: Inhalt wird automatisch aus dem Kunden erzeugt */
  address: { fontSizePt: number }
  /** Absenderblock rechts oben, rechtsbündig */
  sender: RichTextBlock
  /** Infoblock rechts unter dem Absender (Leistungsdatum, Rechnungsdatum, Rechnungsnummer) */
  info: { rows: InfoRow[]; fontSizePt?: number }
  /** Betreff, Standard „Rechnung Nr. {Rechnungsnummer}“ */
  subject: RichTextBlock
  /** Betreff für Stornobelege */
  stornoSubject: RichTextBlock
  /** Einleitungstext unter dem Betreff */
  intro: RichTextBlock
  table: {
    /** „Positionen mit Menge 0 anzeigen“, Standard an */
    showZeroQuantity: boolean
    /** nur wirksam ohne Steuerbefreiung */
    showVatColumn: boolean
    labels: {
      name: string
      unitPrice: string
      quantity: string
      total: string
      vat: string
      grandTotal: string
    }
  }
  /**
   * Freie Textblöcke an definierten Stellen (hinzufügen, entfernen, sortieren).
   * `notes` = Hinweistexte unter der Tabelle (nach dem automatischen §19-Hinweis).
   */
  slots: {
    afterIntro: RichTextBlock[]
    notes: RichTextBlock[]
    afterPayment: RichTextBlock[]
  }
  /** Formatierung des Zahlungstexts; Inhalt kommt aus der gewählten Zahlungsart */
  payment: { fontSizePt?: number; align?: TextAlign }
  /** Formatierung des automatischen Steuerhinweises (Text aus den Fest-Einstellungen); optional */
  taxNote?: { fontSizePt?: number; align?: TextAlign }
  /** Fußzeile am Seitenende, 1 bis 4 Spalten */
  footer: { columns: RichTextBlock[]; fontSizePt?: number }
}

export interface Template {
  id: number
  festivalId: number
  config: TemplateConfig
  /** Dateiname im App-Datenverzeichnis `logos/` (inhaltsadressiert, wird nie überschrieben) */
  logoFile: string | null
  updatedAt: IsoDateTime
}

/* ------------------------------------------------------------------ */
/* Rechnungen                                                          */
/* ------------------------------------------------------------------ */

/** Kopie der Kundendaten zum Zeitpunkt der Rechnung. */
export interface CustomerSnapshot {
  kind: CustomerKind
  /** Referenz auf den Vereinsstamm (nur informativ, kann später gelöscht sein) */
  clubId: number | null
  contactName: string
  clubName: string
  street: string
  zip: string
  city: string
  /** angemeldete Personen (nur Vereine) */
  registeredPersons: number | null
}

export interface VatBreakdown {
  rate: VatRate
  grossCents: Cents
  netCents: Cents
  vatCents: Cents
}

export interface InvoiceTotals {
  grossCents: Cents
  netCents: Cents
  vatCents: Cents
  /** nur Steuersätze mit Positionen ≠ 0, aufsteigend sortiert */
  byRate: VatBreakdown[]
}

/** Eine Position, wie sie aus der Festbüro-Maske kommt. Zeilensummen rechnet der Main-Prozess neu. */
export interface InvoiceDraftLine {
  /** null = freie Zusatzposition */
  productId: number | null
  name: string
  priceCents: Cents
  vatRate: VatRate
  quantity: number
}

export interface InvoiceDraft {
  festivalId: number
  customer: CustomerSnapshot
  /** kommende Personen; null bei Einzelrechnung */
  persons: number | null
  paymentKind: PaymentKind
  /** Standard: heute */
  invoiceDate: IsoDate
  /** Standard: Festdatum */
  serviceDate: IsoDate
  /** alle Positionen inkl. Menge 0 (die Vorlage entscheidet über die Anzeige) */
  lines: InvoiceDraftLine[]
}

export interface InvoiceLine {
  id: number
  invoiceId: number
  position: number
  productId: number | null
  name: string
  priceCents: Cents
  vatRate: VatRate
  /** bei Storno negativ */
  quantity: number
  /** priceCents × quantity, bei Storno negativ */
  lineTotalCents: Cents
}

export interface Invoice {
  id: number
  festivalId: number
  /** z. B. "2025-081", eindeutig über alle Feste */
  number: string
  /** laufende Zahl (numerischer Teil) */
  seq: number
  type: InvoiceType
  status: InvoiceStatus
  /** bei Storno: stornierte Rechnung */
  originalInvoiceId: number | null
  originalNumber: string | null
  stornoReason: string | null
  /** bei stornierter Rechnung: der zugehörige Stornobeleg */
  stornoInvoiceId: number | null
  stornoNumber: string | null
  customer: CustomerSnapshot
  persons: number | null
  paymentKind: PaymentKind
  paymentLabel: string
  /** Kopie des Zahlungstexts (HTML mit Platzhaltern) */
  paymentText: string
  dueDays: number
  invoiceDate: IsoDate
  serviceDate: IsoDate
  dueDate: IsoDate
  totals: InvoiceTotals
  taxExempt: boolean
  taxExemptText: string
  festivalName: string
  /** Kopie der Vorlage zum Zeitpunkt des Abschlusses */
  template: TemplateConfig
  logoFile: string | null
  pdfPath: string | null
  pdfCreatedAt: IsoDateTime | null
  printed: boolean
  printedAt: IsoDateTime | null
  printError: string | null
  createdAt: IsoDateTime
  lines: InvoiceLine[]
}

export interface InvoiceListItem {
  id: number
  number: string
  type: InvoiceType
  status: InvoiceStatus
  invoiceDate: IsoDate
  dueDate: IsoDate
  /** Verein bzw. Name bzw. „Einzelrechnung“ */
  customerLabel: string
  customerKind: CustomerKind
  clubId: number | null
  persons: number | null
  paymentKind: PaymentKind
  paymentLabel: string
  totalGrossCents: Cents
  printed: boolean
  printedAt: IsoDateTime | null
  pdfPath: string | null
  originalNumber: string | null
  stornoNumber: string | null
  createdAt: IsoDateTime
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

/** Alles, was der Vorlagen-Renderer für eine Rechnung braucht (Entwurf oder abgeschlossen). */
export interface InvoiceRenderData {
  type: InvoiceType
  /** null im Entwurf, wenn keine Vorschau-Nummer bekannt ist */
  number: string | null
  originalNumber: string | null
  festivalName: string
  invoiceDate: IsoDate
  serviceDate: IsoDate
  dueDate: IsoDate
  /** für {Heute…}; bei abgeschlossenen Rechnungen = Rechnungsdatum (deterministisch) */
  today: IsoDate
  customer: CustomerSnapshot
  persons: number | null
  paymentKind: PaymentKind
  paymentLabel: string
  paymentText: string
  lines: Array<Pick<InvoiceLine, 'name' | 'priceCents' | 'vatRate' | 'quantity' | 'lineTotalCents'>>
  totals: InvoiceTotals
  taxExempt: boolean
  taxExemptText: string
  /** nur Storno: Grund der Stornierung (erscheint unter der Einleitung, Platzhalter {Stornogrund}) */
  stornoReason?: string | null
}

/* ------------------------------------------------------------------ */
/* Druck                                                               */
/* ------------------------------------------------------------------ */

export interface PrinterInfo {
  /** Systemname (CUPS-Queue bzw. Windows-Druckername) – wird für den Druck verwendet */
  name: string
  displayName: string
  isDefault: boolean
}

export interface PrinterStatus {
  printer: string | null
  available: boolean
  /** deutsche Begründung, wenn nicht verfügbar (z. B. „Drucker „X“ ist deaktiviert/offline“) */
  message?: string
}

export interface PrintResult {
  ok: boolean
  printer: string | null
  copies: number
  /** deutsche Fehlermeldung */
  error?: string
  /** true, wenn nur simuliert (Entwicklung/Tests) */
  dryRun?: boolean
}

export interface FinalizeResult {
  invoice: Invoice
  pdf: { ok: boolean; path: string | null; error?: string }
  print: PrintResult
}

/* ------------------------------------------------------------------ */
/* Auswertung                                                          */
/* ------------------------------------------------------------------ */

export interface EvaluationData {
  festivalId: number
  /** Anzahl Rechnungen (Typ rechnung, inkl. stornierter) */
  invoiceCount: number
  stornoCount: number
  /** netto nach Gegenrechnung der Stornos */
  totalGrossCents: Cents
  cashCents: Cents
  transferCents: Cents
  /** Summe der Personen, Stornos gegengerechnet */
  persons: number
  /** `productId`: Produkt des Fests; null = freie Zusatzposition (steht am Ende) */
  products: Array<{ name: string; quantity: number; grossCents: Cents; productId?: number | null }>
  taxRates: VatBreakdown[]
  /** Steuersätze anzeigen: Fest ohne Steuerbefreiung oder es gibt Belege mit Steuerausweis */
  showTaxRates?: boolean
  perDay: Array<{ date: IsoDate; invoiceCount: number; grossCents: Cents }>
  clubsWithoutInvoice: Club[]
}

/* ------------------------------------------------------------------ */
/* System                                                              */
/* ------------------------------------------------------------------ */

export interface AppInfo {
  version: string
  platform: 'darwin' | 'win32' | 'linux'
  userDataDir: string
  dbPath: string
  isPackaged: boolean
  /** true = Druckaufträge werden nur simuliert */
  printDryRun: boolean
}
