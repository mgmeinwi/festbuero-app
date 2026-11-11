/**
 * Versionierte Datenbank-Migrationen.
 *
 * VERTRAG:
 * - Die aktuelle Version steht in `PRAGMA user_version`.
 * - Migrationen werden in aufsteigender Reihenfolge, jede in einer eigenen Transaktion, ausgeführt.
 * - Eine einmal ausgelieferte Migration wird NIE verändert. Schemaänderungen = neue Migration anhängen.
 * - Beträge in Cent (INTEGER), Datum als TEXT 'YYYY-MM-DD', Zeitpunkte als TEXT ISO 8601 (UTC).
 * - Booleans als INTEGER 0/1. JSON als TEXT.
 */

export interface Migration {
  version: number
  name: string
  sql: string
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial',
    sql: /* sql */ `
      CREATE TABLE app_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL            -- JSON-kodierter Wert
      );

      CREATE TABLE festival (
        id                INTEGER PRIMARY KEY,
        name              TEXT    NOT NULL,
        festival_date     TEXT    NOT NULL,
        number_prefix     TEXT    NOT NULL DEFAULT '',
        number_start      INTEGER NOT NULL DEFAULT 1 CHECK (number_start >= 0),
        number_next       INTEGER NOT NULL DEFAULT 1 CHECK (number_next >= 0),
        number_digits     INTEGER NOT NULL DEFAULT 3 CHECK (number_digits BETWEEN 1 AND 10),
        copies            INTEGER NOT NULL DEFAULT 2 CHECK (copies BETWEEN 1 AND 20),
        tax_exempt        INTEGER NOT NULL DEFAULT 1 CHECK (tax_exempt IN (0, 1)),
        tax_exempt_text   TEXT    NOT NULL DEFAULT 'Als Kleinunternehmer im Sinne von § 19 UStG wird keine Umsatzsteuer berechnet.',
        filename_pattern  TEXT    NOT NULL DEFAULT '{Rechnungsnummer}',
        archived          INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        created_at        TEXT    NOT NULL,
        updated_at        TEXT    NOT NULL
      );

      CREATE TABLE product (
        id                INTEGER PRIMARY KEY,
        festival_id       INTEGER NOT NULL REFERENCES festival(id) ON DELETE CASCADE,
        name              TEXT    NOT NULL,
        price_cents       INTEGER NOT NULL CHECK (price_cents >= 0),
        vat_rate          INTEGER NOT NULL CHECK (vat_rate IN (7, 19)),
        mode              TEXT    NOT NULL CHECK (mode IN ('pro_person', 'feste_anzahl')),
        default_quantity  INTEGER NOT NULL DEFAULT 1 CHECK (default_quantity >= 0),
        sort_order        INTEGER NOT NULL DEFAULT 0,
        active            INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
      );
      CREATE INDEX idx_product_festival ON product(festival_id, sort_order);

      CREATE TABLE club (
        id                  INTEGER PRIMARY KEY,
        festival_id         INTEGER NOT NULL REFERENCES festival(id) ON DELETE CASCADE,
        contact_name        TEXT    NOT NULL DEFAULT '',
        club_name           TEXT    NOT NULL,
        street              TEXT    NOT NULL DEFAULT '',
        zip                 TEXT    NOT NULL DEFAULT '',
        city                TEXT    NOT NULL DEFAULT '',
        registered_persons  INTEGER NOT NULL DEFAULT 0 CHECK (registered_persons >= 0),
        source              TEXT    NOT NULL DEFAULT 'manual' CHECK (source IN ('import', 'manual')),
        created_at          TEXT    NOT NULL,
        updated_at          TEXT    NOT NULL
      );
      CREATE INDEX idx_club_festival ON club(festival_id);

      CREATE TABLE template (
        id           INTEGER PRIMARY KEY,
        festival_id  INTEGER NOT NULL UNIQUE REFERENCES festival(id) ON DELETE CASCADE,
        config_json  TEXT    NOT NULL,     -- TemplateConfig
        logo_file    TEXT,                 -- Dateiname in <userData>/logos/
        updated_at   TEXT    NOT NULL
      );

      CREATE TABLE payment_method (
        id           INTEGER PRIMARY KEY,
        festival_id  INTEGER NOT NULL REFERENCES festival(id) ON DELETE CASCADE,
        kind         TEXT    NOT NULL CHECK (kind IN ('bar', 'ueberweisung')),
        label        TEXT    NOT NULL,
        text         TEXT    NOT NULL,     -- HTML mit Platzhaltern
        due_days     INTEGER NOT NULL DEFAULT 7 CHECK (due_days >= 0),
        is_default   INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
        UNIQUE (festival_id, kind)
      );

      CREATE TABLE invoice (
        id                   INTEGER PRIMARY KEY,
        festival_id          INTEGER NOT NULL REFERENCES festival(id),   -- bewusst KEIN Cascade
        number               TEXT    NOT NULL UNIQUE,                     -- eindeutig über alle Feste
        seq                  INTEGER NOT NULL,
        type                 TEXT    NOT NULL CHECK (type IN ('rechnung', 'storno')),
        status               TEXT    NOT NULL DEFAULT 'abgeschlossen' CHECK (status IN ('abgeschlossen', 'storniert')),
        original_invoice_id  INTEGER REFERENCES invoice(id),
        storno_reason        TEXT,
        customer_kind        TEXT    NOT NULL CHECK (customer_kind IN ('verein', 'einzel')),
        club_id              INTEGER,                                     -- nur Referenz, kein FK
        customer_json        TEXT    NOT NULL,                            -- CustomerSnapshot
        persons              INTEGER,
        payment_kind         TEXT    NOT NULL CHECK (payment_kind IN ('bar', 'ueberweisung')),
        payment_label        TEXT    NOT NULL,
        payment_text         TEXT    NOT NULL,
        due_days             INTEGER NOT NULL,
        invoice_date         TEXT    NOT NULL,
        service_date         TEXT    NOT NULL,
        due_date             TEXT    NOT NULL,
        total_gross_cents    INTEGER NOT NULL,
        total_net_cents      INTEGER NOT NULL,
        total_vat_cents      INTEGER NOT NULL,
        totals_json          TEXT    NOT NULL,                            -- InvoiceTotals
        tax_exempt           INTEGER NOT NULL CHECK (tax_exempt IN (0, 1)),
        tax_exempt_text      TEXT    NOT NULL,
        festival_name        TEXT    NOT NULL,
        template_json        TEXT    NOT NULL,                            -- TemplateConfig (Kopie)
        logo_file            TEXT,
        pdf_path             TEXT,
        pdf_created_at       TEXT,
        printed              INTEGER NOT NULL DEFAULT 0 CHECK (printed IN (0, 1)),
        printed_at           TEXT,
        print_error          TEXT,
        created_at           TEXT    NOT NULL,
        CHECK ((type = 'storno') = (original_invoice_id IS NOT NULL)),
        CHECK (type = 'rechnung' OR status = 'abgeschlossen')
      );
      CREATE INDEX idx_invoice_festival ON invoice(festival_id, seq);
      -- Eine Rechnung kann nur einmal storniert werden.
      CREATE UNIQUE INDEX idx_invoice_one_storno ON invoice(original_invoice_id) WHERE original_invoice_id IS NOT NULL;

      CREATE TABLE invoice_line (
        id                INTEGER PRIMARY KEY,
        invoice_id        INTEGER NOT NULL REFERENCES invoice(id),
        position          INTEGER NOT NULL,
        product_id        INTEGER,                 -- nur Referenz („in Rechnung verwendet“), kein FK
        name              TEXT    NOT NULL,
        price_cents       INTEGER NOT NULL,
        vat_rate          INTEGER NOT NULL CHECK (vat_rate IN (7, 19)),
        quantity          INTEGER NOT NULL,
        line_total_cents  INTEGER NOT NULL,
        UNIQUE (invoice_id, position)
      );
      CREATE INDEX idx_invoice_line_product ON invoice_line(product_id);

      -- ---------------------------------------------------------------
      -- Unveränderlichkeit abgeschlossener Belege (GoBD-Gedanke):
      -- Nur Ablage-/Druckstatus und der Übergang 'abgeschlossen' -> 'storniert' sind erlaubt.
      -- ---------------------------------------------------------------
      CREATE TRIGGER trg_invoice_no_delete BEFORE DELETE ON invoice
      BEGIN
        SELECT RAISE(ABORT, 'Abgeschlossene Rechnungen dürfen nicht gelöscht werden.');
      END;

      CREATE TRIGGER trg_invoice_line_no_delete BEFORE DELETE ON invoice_line
      BEGIN
        SELECT RAISE(ABORT, 'Rechnungspositionen dürfen nicht gelöscht werden.');
      END;

      CREATE TRIGGER trg_invoice_line_no_update BEFORE UPDATE ON invoice_line
      BEGIN
        SELECT RAISE(ABORT, 'Rechnungspositionen dürfen nicht geändert werden.');
      END;

      CREATE TRIGGER trg_invoice_immutable BEFORE UPDATE ON invoice
      WHEN NEW.festival_id IS NOT OLD.festival_id
        OR NEW.number IS NOT OLD.number
        OR NEW.seq IS NOT OLD.seq
        OR NEW.type IS NOT OLD.type
        OR NEW.original_invoice_id IS NOT OLD.original_invoice_id
        OR NEW.storno_reason IS NOT OLD.storno_reason
        OR NEW.customer_kind IS NOT OLD.customer_kind
        OR NEW.club_id IS NOT OLD.club_id
        OR NEW.customer_json IS NOT OLD.customer_json
        OR NEW.persons IS NOT OLD.persons
        OR NEW.payment_kind IS NOT OLD.payment_kind
        OR NEW.payment_label IS NOT OLD.payment_label
        OR NEW.payment_text IS NOT OLD.payment_text
        OR NEW.due_days IS NOT OLD.due_days
        OR NEW.invoice_date IS NOT OLD.invoice_date
        OR NEW.service_date IS NOT OLD.service_date
        OR NEW.due_date IS NOT OLD.due_date
        OR NEW.total_gross_cents IS NOT OLD.total_gross_cents
        OR NEW.total_net_cents IS NOT OLD.total_net_cents
        OR NEW.total_vat_cents IS NOT OLD.total_vat_cents
        OR NEW.totals_json IS NOT OLD.totals_json
        OR NEW.tax_exempt IS NOT OLD.tax_exempt
        OR NEW.tax_exempt_text IS NOT OLD.tax_exempt_text
        OR NEW.festival_name IS NOT OLD.festival_name
        OR NEW.template_json IS NOT OLD.template_json
        OR NEW.logo_file IS NOT OLD.logo_file
        OR NEW.created_at IS NOT OLD.created_at
        OR (NEW.status IS NOT OLD.status AND NOT (OLD.status = 'abgeschlossen' AND NEW.status = 'storniert'))
      BEGIN
        SELECT RAISE(ABORT, 'Abgeschlossene Rechnungen sind unveränderlich. Korrekturen nur per Storno.');
      END;

      -- Startnummer nur änderbar, solange das Fest keine Belege hat.
      CREATE TRIGGER trg_festival_number_start_locked BEFORE UPDATE OF number_start ON festival
      WHEN NEW.number_start IS NOT OLD.number_start
        AND EXISTS (SELECT 1 FROM invoice WHERE festival_id = OLD.id)
      BEGIN
        SELECT RAISE(ABORT, 'Die Startnummer kann nach der ersten Rechnung nicht mehr geändert werden.');
      END;

      -- Feste mit Belegen dürfen nicht gelöscht werden (nur archivieren).
      CREATE TRIGGER trg_festival_no_delete_with_invoices BEFORE DELETE ON festival
      WHEN EXISTS (SELECT 1 FROM invoice WHERE festival_id = OLD.id)
      BEGIN
        SELECT RAISE(ABORT, 'Feste mit Rechnungen können nicht gelöscht werden. Bitte archivieren.');
      END;
    `
  }
]
