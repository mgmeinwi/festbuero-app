/**
 * IPC-Vertrag zwischen Renderer und Main-Prozess.
 *
 * Mechanik (siehe docs/architecture.md):
 * - Renderer ruft `api.<namespace>.<methode>(...args)` auf.
 * - Ein generischer Proxy im Renderer übersetzt das in `ipcRenderer.invoke('<namespace>.<methode>', ...args)`.
 * - Der Main-Prozess registriert pro Methode einen Handler über `handle('<namespace>.<methode>', fn)`.
 * - Fehler werden im Main-Prozess als `Error` mit deutscher, nutzerverständlicher Meldung geworfen;
 *   der Renderer erhält sie als abgelehntes Promise (Präfix von Electron wird entfernt).
 *
 * Änderungen: nur additiv. Neue Methoden in den eigenen Namespace aufnehmen.
 */
import type {
  AppInfo,
  AppSettings,
  Club,
  ClubImportPreview,
  ClubImportResult,
  ClubInput,
  EvaluationData,
  Festival,
  FestivalCopyInput,
  FestivalCreateInput,
  FestivalUpdateInput,
  FinalizeResult,
  Invoice,
  InvoiceDraft,
  InvoiceListItem,
  PaymentMethod,
  PaymentMethodUpdateInput,
  PrinterInfo,
  PrinterStatus,
  PrintResult,
  Product,
  ProductInput,
  Template,
  TemplateConfig
} from './types'

export interface FestbueroApi {
  app: {
    getInfo(): Promise<AppInfo>
    getSettings(): Promise<AppSettings>
    updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
    /** Ordnerauswahl-Dialog; null bei Abbruch */
    pickDirectory(opts?: { title?: string; defaultPath?: string }): Promise<string | null>
    /** Datei mit Standardprogramm öffnen */
    openPath(path: string): Promise<void>
    showItemInFolder(path: string): Promise<void>
    /** ZIP mit Datenbank + Logos in `<Dokumentenordner>/Datensicherungen/` */
    createBackup(): Promise<{ path: string }>
    /** legt ein Beispiel-Fest mit Produkten, Vorlage und erfundenen Vereinen an */
    createSampleFestival(): Promise<Festival>
  }

  festivals: {
    list(opts?: { includeArchived?: boolean }): Promise<Festival[]>
    get(id: number): Promise<Festival>
    /** legt zusätzlich Standard-Zahlungsarten und die Standard-Vorlage an */
    create(input: FestivalCreateInput): Promise<Festival>
    update(id: number, patch: FestivalUpdateInput): Promise<Festival>
    /** übernimmt Produkte, Vorlage, Zahlungsarten und Einstellungen – ohne Vereine und Rechnungen */
    copy(sourceId: number, input: FestivalCopyInput): Promise<Festival>
  }

  products: {
    list(festivalId: number, opts?: { activeOnly?: boolean }): Promise<Product[]>
    create(festivalId: number, input: ProductInput): Promise<Product>
    update(id: number, patch: Partial<ProductInput>): Promise<Product>
    /** wirft, wenn das Produkt in Rechnungen verwendet wurde (dann nur deaktivieren) */
    delete(id: number): Promise<void>
    reorder(festivalId: number, orderedIds: number[]): Promise<Product[]>
  }

  paymentMethods: {
    list(festivalId: number): Promise<PaymentMethod[]>
    update(id: number, patch: PaymentMethodUpdateInput): Promise<PaymentMethod>
  }

  clubs: {
    list(festivalId: number): Promise<Club[]>
    create(festivalId: number, input: ClubInput): Promise<Club>
    update(id: number, patch: Partial<ClubInput>): Promise<Club>
    delete(id: number): Promise<void>
    /** Dateiauswahl (.xlsx); null bei Abbruch */
    pickImportFile(): Promise<string | null>
    previewImport(festivalId: number, filePath: string): Promise<ClubImportPreview>
    /** ersetzt den importierten Vereinsstamm (nach Bestätigung im UI) */
    commitImport(festivalId: number, filePath: string): Promise<ClubImportResult>
    /** Speichern-Dialog; schreibt eine Anmelde-Vorlage (.xlsx); null bei Abbruch */
    exportTemplate(festivalId: number): Promise<string | null>
  }

  templates: {
    get(festivalId: number): Promise<Template>
    update(festivalId: number, config: TemplateConfig): Promise<Template>
    /** Dateiauswahl für Bilder; null bei Abbruch */
    pickLogo(): Promise<string | null>
    /** kopiert das Bild inhaltsadressiert nach `<userData>/logos/`; null entfernt das Logo */
    setLogo(festivalId: number, sourcePath: string | null): Promise<Template>
    /** Logo als data:-URL für Vorschau/PDF; null wenn nicht vorhanden */
    getLogoDataUrl(logoFile: string): Promise<string | null>
    /** setzt die Vorlage auf die Standard-Beispielvorlage zurück */
    resetToDefault(festivalId: number): Promise<Template>
  }

  invoices: {
    /** Nummer, die die nächste Rechnung erhalten würde (nur Anzeige, keine Reservierung) */
    nextNumberPreview(festivalId: number): Promise<string>
    /** Nummer vergeben (Transaktion) → PDF erzeugen → ablegen → drucken → Status setzen */
    finalize(draft: InvoiceDraft): Promise<FinalizeResult>
    list(festivalId: number): Promise<InvoiceListItem[]>
    /** holt fehlendes PDF automatisch nach */
    get(id: number): Promise<Invoice>
    ensurePdf(id: number): Promise<{ ok: boolean; path: string | null; error?: string }>
    print(id: number, opts?: { printer?: string }): Promise<PrintResult>
    printMany(ids: number[], opts?: { printer?: string }): Promise<Array<{ id: number; result: PrintResult }>>
    openPdf(id: number): Promise<void>
    /** „Speichern unter“-Dialog; null bei Abbruch */
    exportPdf(id: number): Promise<string | null>
    /** ZIP mit allen PDFs; Speichern-Dialog; null bei Abbruch */
    exportZip(ids: number[]): Promise<string | null>
    /** Stornobeleg mit neuer Nummer erzeugen, ablegen, drucken; Original wird 'storniert' */
    storno(id: number, reason: string): Promise<FinalizeResult>
    /** Excel-Export der Rechnungsliste; null bei Abbruch */
    exportListExcel(festivalId: number, ids?: number[]): Promise<string | null>
  }

  printing: {
    listPrinters(): Promise<PrinterInfo[]>
    /** prüft, ob der gespeicherte Standarddrucker verfügbar ist */
    getStatus(): Promise<PrinterStatus>
    /** Testseite mit Musterrechnung (wird NICHT als Rechnung gespeichert) */
    printTestPage(festivalId: number, opts?: { printer?: string }): Promise<PrintResult>
  }

  evaluation: {
    get(festivalId: number): Promise<EvaluationData>
    /** Excel-Export mit allen Tabellenblättern; null bei Abbruch */
    exportExcel(festivalId: number): Promise<string | null>
  }
}

export type ApiNamespace = keyof FestbueroApi
export type ApiChannel = {
  [N in ApiNamespace]: `${N & string}.${keyof FestbueroApi[N] & string}`
}[ApiNamespace]

/** Events vom Main-Prozess an den Renderer (über `window.festbuero.on`). */
export interface MainEvents {
  /** Druckerliste/-status hat sich geändert */
  'printing.statusChanged': PrinterStatus
  /** Menü/Shortcut-Aktionen aus dem Main-Prozess */
  'app.navigate': { path: string }
}
export type MainEventName = keyof MainEvents
