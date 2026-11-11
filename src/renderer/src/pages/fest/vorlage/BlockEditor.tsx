/**
 * Editor des gewählten Vorlagenblocks (mittlere Spalte). Änderungen laufen über `update(mutator)` – die Seite
 * wendet sie auf eine Kopie des aktuellen Stands an (Vorschau sofort, Speichern entprellt).
 */
import { useId, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { ExternalLink, ImageUp, Loader2, Plus, Trash2 } from 'lucide-react'
import { FONT_IDS, FONT_META } from '@shared/invoice-render/fonts-meta'
import { TEMPLATE_LIMITS } from '@shared/invoice-render/normalize'
import { richHtmlToPlainText } from '@shared/invoice-render/sanitize'
import type { Festival, LogoPosition, PaymentMethod, RichTextBlock, TemplateConfig, TextAlign } from '@shared/types'
import { PlaceholderInput } from '@/components/rich-text/PlaceholderInput'
import { RichTextEditor } from '@/components/rich-text/RichTextEditor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { getBlock, newBlockId, type BlockKey, type RichBlockKey, type SlotKey } from './blocks'
import type { ConfirmRequest } from './ConfirmDialog'
import { AlignControl, Field, FormatRow, NumberField, Section, Segmented } from './fields'
import { SortableList } from './SortableList'

export interface LogoState {
  file: string | null
  dataUrl: string | null
  busy: boolean
  onUpload(): void
  onRemove(): void
}

export type Mutator = (draft: TemplateConfig) => void

export interface BlockEditorProps {
  block: BlockKey
  config: TemplateConfig
  /** Änderung anwenden (auf einer Kopie des aktuellen Stands) */
  update(mutate: Mutator): void
  festival: Festival
  paymentMethods: PaymentMethod[] | undefined
  logo: LogoState
  confirm(request: ConfirmRequest): void
}

function withRow(c: TemplateConfig, id: string, fn: (row: TemplateConfig['info']['rows'][number]) => void): void {
  const row = c.info.rows.find((r) => r.id === id)
  if (row) fn(row)
}

function hasContent(html: string): boolean {
  return richHtmlToPlainText(html).length > 0 || /data-placeholder/.test(html)
}

/* ------------------------------------------------------------------ */
/* Allgemein                                                           */
/* ------------------------------------------------------------------ */

const LOGO_POSITIONS: ReadonlyArray<{ value: LogoPosition; label: string }> = [
  { value: 'left', label: 'Links' },
  { value: 'center', label: 'Mittig' },
  { value: 'right', label: 'Rechts' }
]

function GeneralEditor({ config, update, logo }: { config: TemplateConfig; update(m: Mutator): void; logo: LogoState }) {
  const fontId = useId()
  const sizeId = useId()
  const widthId = useId()
  const logoSwitchId = useId()
  return (
    <div className="space-y-4">
      <Section title="Schrift" description="Gilt für die ganze Rechnung. Die Schriften sind eingebettet und sehen auf jedem Rechner gleich aus.">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <Field label="Schriftart" htmlFor={fontId} className="w-full max-w-72">
            <Select value={config.fontFamily} onValueChange={(v) => update((c) => (c.fontFamily = v as TemplateConfig['fontFamily']))}>
              <SelectTrigger id={fontId} className="h-9 w-full" aria-label="Schriftart">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_IDS.map((id) => (
                  <SelectItem key={id} value={id}>
                    {FONT_META[id].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Grundschriftgröße" htmlFor={sizeId}>
            <NumberField
              id={sizeId}
              value={config.baseFontSizePt}
              onChange={(v) => update((c) => (c.baseFontSizePt = v ?? 12))}
              min={TEMPLATE_LIMITS.fontSizeMinPt}
              max={TEMPLATE_LIMITS.fontSizeMaxPt}
              step={0.5}
              unit="pt"
              ariaLabel="Grundschriftgröße in pt"
            />
          </Field>
        </div>
      </Section>

      <Section title="Logo" description="PNG, JPG, SVG oder WebP. Das Bild wird in den App-Daten abgelegt.">
        <div className="flex flex-wrap items-start gap-4">
          <div
            className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-white p-1"
            data-testid="vorlage-logo-preview"
          >
            {logo.dataUrl ? (
              <img src={logo.dataUrl} alt="Aktuelles Logo" className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="px-1 text-center text-xs text-neutral-500">Kein Logo</span>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={logo.onUpload} disabled={logo.busy}>
                {logo.busy ? <Loader2 className="animate-spin" aria-hidden /> : <ImageUp aria-hidden />}
                {logo.file ? 'Anderes Logo wählen …' : 'Logo hochladen …'}
              </Button>
              {logo.file ? (
                <Button type="button" variant="ghost" size="sm" onClick={logo.onRemove} disabled={logo.busy}>
                  <Trash2 aria-hidden />
                  Entfernen
                </Button>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id={logoSwitchId}
                checked={config.logo.enabled}
                onCheckedChange={(v) => update((c) => (c.logo.enabled = v))}
              />
              <Label htmlFor={logoSwitchId}>Logo auf der Rechnung anzeigen</Label>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <div className="space-y-1.5">
            <span className="block text-sm font-medium">Position</span>
            <Segmented
              ariaLabel="Logo-Position"
              value={config.logo.position}
              onChange={(v) => update((c) => (c.logo.position = v))}
              options={LOGO_POSITIONS}
            />
          </div>
          <Field label="Breite" htmlFor={widthId}>
            <div className="flex items-center gap-3">
              <NumberField
                id={widthId}
                value={config.logo.widthMm}
                onChange={(v) => update((c) => (c.logo.widthMm = v ?? 35))}
                min={TEMPLATE_LIMITS.logoWidthMinMm}
                max={TEMPLATE_LIMITS.logoWidthMaxMm}
                unit="mm"
                ariaLabel="Logobreite in mm"
              />
              <input
                type="range"
                min={TEMPLATE_LIMITS.logoWidthMinMm}
                max={80}
                value={Math.min(80, config.logo.widthMm)}
                onChange={(e) => update((c) => (c.logo.widthMm = Number(e.target.value)))}
                className="w-32 accent-primary"
                aria-label="Logobreite (Schieberegler)"
              />
            </div>
          </Field>
        </div>
      </Section>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Einzelne Textblöcke                                                 */
/* ------------------------------------------------------------------ */

const RICH_BLOCK_HINTS: Partial<Record<RichBlockKey, ReactNode>> = {
  stornoSubject: 'Felder „Originalrechnung“ und „Grund der Stornierung“ stehen unter „Feld einfügen → Rechnung“.',
  returnLine: 'Eine Zeile, z. B. „Verein | Straße | PLZ Ort“.'
}

function RichBlockEditor({
  blockKey,
  config,
  update
}: {
  blockKey: RichBlockKey
  config: TemplateConfig
  update(m: Mutator): void
}) {
  const block = config[blockKey]
  const def = getBlock(blockKey)
  const defaultAlign: TextAlign = blockKey === 'sender' ? 'right' : 'left'
  return (
    <Section>
      <FormatRow
        fontSizePt={block.fontSizePt}
        align={block.align}
        defaultAlign={defaultAlign}
        basePt={config.baseFontSizePt}
        label={def.label}
        onChange={(p) =>
          update((c) => {
            const b = c[blockKey]
            if ('fontSizePt' in p) {
              if (p.fontSizePt === undefined) delete b.fontSizePt
              else b.fontSizePt = p.fontSizePt
            }
            if (p.align) b.align = p.align
          })
        }
      />
      <RichTextEditor
        value={block.html}
        onChange={(html) => update((c) => (c[blockKey].html = html))}
        ariaLabel={def.label}
        defaultAlign={block.align ?? defaultAlign}
      />
      {RICH_BLOCK_HINTS[blockKey] ? <p className="text-xs text-muted-foreground">{RICH_BLOCK_HINTS[blockKey]}</p> : null}
    </Section>
  )
}

function AddressEditor({ config, update }: { config: TemplateConfig; update(m: Mutator): void }) {
  const id = useId()
  return (
    <Section>
      <Field label="Schriftgröße" htmlFor={id}>
        <NumberField
          id={id}
          value={config.address.fontSizePt}
          onChange={(v) => update((c) => (c.address.fontSizePt = v ?? 12))}
          min={5}
          max={24}
          step={0.5}
          unit="pt"
          ariaLabel="Schriftgröße Anschriftfeld in pt"
        />
      </Field>
      <div className="rounded-md border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Inhalt (automatisch)</p>
        <p>Verein: Name · Verein · Straße · PLZ Ort (leere Zeilen entfallen).</p>
        <p>Einzelrechnung: „Einzelrechnung“ bzw. die eingetragenen Angaben.</p>
      </div>
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/* Infozeilen                                                          */
/* ------------------------------------------------------------------ */

function InfoEditor({ config, update, confirm }: { config: TemplateConfig; update(m: Mutator): void; confirm(r: ConfirmRequest): void }) {
  const sizeId = useId()
  const rows = config.info.rows
  return (
    <div className="space-y-4">
      <Section>
        <Field label="Schriftgröße" htmlFor={sizeId}>
          <NumberField
            id={sizeId}
            value={config.info.fontSizePt}
            optional
            placeholder={String(config.baseFontSizePt).replace('.', ',')}
            onChange={(v) =>
              update((c) => {
                if (v === undefined) delete c.info.fontSizePt
                else c.info.fontSizePt = v
              })
            }
            min={5}
            max={24}
            step={0.5}
            unit="pt"
            ariaLabel="Schriftgröße Infozeilen in pt"
          />
        </Field>
      </Section>
      <SortableList
        items={rows}
        ariaLabel="Infozeilen"
        itemLabel={(_r, i) => `Infozeile ${i + 1}`}
        onReorder={(next) => update((c) => (c.info.rows = next))}
      >
        {(row, { handle, moveButtons, index }) => (
          <div className="rounded-lg border bg-card p-2 @container">
            <div className="flex items-center gap-1">
              {handle}
              <span className="min-w-0 flex-1 truncate text-sm font-medium">Infozeile {index + 1}</span>
              {moveButtons}
              <button
                type="button"
                className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:ring-[3px] focus-visible:ring-ring/60 outline-none"
                aria-label={`Infozeile ${index + 1} entfernen`}
                title="Entfernen"
                onClick={() => {
                  const remove = () => update((c) => (c.info.rows = c.info.rows.filter((r) => r.id !== row.id)))
                  if (row.label.trim() === '' && row.value.trim() === '') remove()
                  else
                    confirm({
                      title: 'Infozeile entfernen?',
                      description: `„${row.label || row.value}“ wird aus der Vorlage entfernt.`,
                      confirmLabel: 'Entfernen',
                      onConfirm: remove
                    })
                }}
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>
            <div className="mt-2 grid gap-2 @md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <Input
                value={row.label}
                maxLength={TEMPLATE_LIMITS.labelMaxLength}
                aria-label={`Beschriftung Infozeile ${index + 1}`}
                placeholder="Beschriftung, z. B. Rechnungsdatum"
                className="h-9 font-semibold"
                onChange={(e) => update((c) => withRow(c, row.id, (r) => (r.label = e.target.value)))}
              />
              <PlaceholderInput
                value={row.value}
                maxLength={TEMPLATE_LIMITS.labelMaxLength}
                ariaLabel={`Wert Infozeile ${index + 1}`}
                placeholder="Wert, z. B. {Rechnungsdatum}"
                onChange={(v) => update((c) => withRow(c, row.id, (r) => (r.value = v)))}
              />
            </div>
          </div>
        )}
      </SortableList>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={rows.length >= TEMPLATE_LIMITS.infoRowsMax}
        onClick={() => update((c) => c.info.rows.push({ id: newBlockId('info'), label: '', value: '' }))}
      >
        <Plus aria-hidden />
        Zeile hinzufügen
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Freie Blöcke (Slots)                                                */
/* ------------------------------------------------------------------ */

const SLOT_ITEM_LABEL: Record<SlotKey, string> = { afterIntro: 'Textblock', notes: 'Hinweis', afterPayment: 'Textblock' }

function SlotEditor({
  slot,
  config,
  update,
  confirm,
  festival
}: {
  slot: SlotKey
  config: TemplateConfig
  update(m: Mutator): void
  confirm(r: ConfirmRequest): void
  festival: Festival
}) {
  const blocks = config.slots[slot]
  const itemLabel = SLOT_ITEM_LABEL[slot]
  const add = () =>
    update((c) => c.slots[slot].push({ id: newBlockId(slot === 'notes' ? 'note' : slot), html: '', align: 'left', ...(slot === 'notes' ? { fontSizePt: 11 } : {}) }))

  return (
    <div className="space-y-4">
      {slot === 'notes' ? (
        <Section
          title="Steuerhinweis (automatisch)"
          description={
            festival.taxExempt
              ? 'Steht immer als erster Hinweis. Der Text kommt aus den Fest-Einstellungen („Allgemein“).'
              : 'Dieses Fest ist nicht steuerbefreit – es wird kein Steuerhinweis gedruckt.'
          }
        >
          {festival.taxExempt ? (
            <p className="rounded-md bg-muted/40 px-3 py-2 text-sm">{festival.taxExemptText || '(kein Text hinterlegt)'}</p>
          ) : null}
          <FormatRow
            fontSizePt={config.taxNote?.fontSizePt}
            align={config.taxNote?.align}
            basePt={config.baseFontSizePt}
            label="Steuerhinweis"
            onChange={(p) =>
              update((c) => {
                const t = { ...(c.taxNote ?? {}) }
                if ('fontSizePt' in p) {
                  if (p.fontSizePt === undefined) delete t.fontSizePt
                  else t.fontSizePt = p.fontSizePt
                }
                if (p.align) t.align = p.align
                c.taxNote = t
              })
            }
          />
        </Section>
      ) : null}

      {blocks.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          Noch keine {itemLabel === 'Hinweis' ? 'eigenen Hinweise' : 'Textblöcke'} an dieser Stelle.
        </p>
      ) : (
        <SortableList
          items={blocks}
          ariaLabel={getBlock(slot).label}
          itemLabel={(_b, i) => `${itemLabel} ${i + 1}`}
          onReorder={(next) => update((c) => (c.slots[slot] = next))}
        >
          {(block: RichTextBlock, { handle, moveButtons, index }) => (
            <div className="space-y-3 rounded-lg border bg-card p-2 sm:p-3" data-testid={`vorlage-slot-block-${slot}`}>
              <div className="flex items-center gap-1">
                {handle}
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {itemLabel} {index + 1}
                </span>
                {moveButtons}
                <button
                  type="button"
                  className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-destructive/10 hover:text-destructive focus-visible:ring-[3px] focus-visible:ring-ring/60"
                  aria-label={`${itemLabel} ${index + 1} entfernen`}
                  title="Entfernen"
                  onClick={() => {
                    const remove = () => update((c) => (c.slots[slot] = c.slots[slot].filter((b) => b.id !== block.id)))
                    if (!hasContent(block.html)) remove()
                    else
                      confirm({
                        title: `${itemLabel} entfernen?`,
                        description: `„${richHtmlToPlainText(block.html).slice(0, 80) || itemLabel}“ wird aus der Vorlage entfernt.`,
                        confirmLabel: 'Entfernen',
                        onConfirm: remove
                      })
                  }}
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
              <FormatRow
                fontSizePt={block.fontSizePt}
                align={block.align}
                basePt={config.baseFontSizePt}
                label={`${itemLabel} ${index + 1}`}
                onChange={(p) =>
                  update((c) => {
                    const b = c.slots[slot].find((x) => x.id === block.id)
                    if (!b) return
                    if ('fontSizePt' in p) {
                      if (p.fontSizePt === undefined) delete b.fontSizePt
                      else b.fontSizePt = p.fontSizePt
                    }
                    if (p.align) b.align = p.align
                  })
                }
              />
              <RichTextEditor
                value={block.html}
                onChange={(html) =>
                  update((c) => {
                    const b = c.slots[slot].find((x) => x.id === block.id)
                    if (b) b.html = html
                  })
                }
                ariaLabel={`${itemLabel} ${index + 1}`}
                defaultAlign={block.align}
                placeholder="Text eingeben …"
              />
            </div>
          )}
        </SortableList>
      )}
      <Button type="button" variant="outline" size="sm" onClick={add} disabled={blocks.length >= TEMPLATE_LIMITS.slotBlocksMax}>
        <Plus aria-hidden />
        {itemLabel === 'Hinweis' ? 'Hinweis hinzufügen' : 'Textblock hinzufügen'}
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Tabelle                                                             */
/* ------------------------------------------------------------------ */

const TABLE_LABELS: ReadonlyArray<{ key: keyof TemplateConfig['table']['labels']; label: string }> = [
  { key: 'name', label: 'Spalte Bezeichnung' },
  { key: 'unitPrice', label: 'Spalte Einzelpreis' },
  { key: 'quantity', label: 'Spalte Menge' },
  { key: 'total', label: 'Spalte Summe' },
  { key: 'vat', label: 'Spalte MwSt-Satz' },
  { key: 'grandTotal', label: 'Zeile Gesamt' }
]

function TableEditor({ config, update, festival }: { config: TemplateConfig; update(m: Mutator): void; festival: Festival }) {
  const zeroId = useId()
  const vatId = useId()
  return (
    <div className="space-y-4">
      <Section title="Anzeige">
        <div className="flex items-start gap-3">
          <Switch
            id={zeroId}
            checked={config.table.showZeroQuantity}
            onCheckedChange={(v) => update((c) => (c.table.showZeroQuantity = v))}
            className="mt-0.5"
          />
          <div className="min-w-0">
            <Label htmlFor={zeroId}>Positionen mit Menge 0 anzeigen</Label>
            <p className="text-xs text-muted-foreground">Wie in der Beispielrechnung: Menge „0“ und Betrag „– €“.</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <Switch
            id={vatId}
            checked={config.table.showVatColumn}
            onCheckedChange={(v) => update((c) => (c.table.showVatColumn = v))}
            className="mt-0.5"
          />
          <div className="min-w-0">
            <Label htmlFor={vatId}>Spalte MwSt-Satz anzeigen</Label>
            <p className="text-xs text-muted-foreground">
              {festival.taxExempt
                ? 'Wirkt nur ohne Steuerbefreiung – dieses Fest ist steuerbefreit.'
                : 'Zeigt den Steuersatz (7 % / 19 %) je Position.'}
            </p>
          </div>
        </div>
      </Section>
      <Section title="Beschriftungen">
        <div className="grid gap-3 @container sm:grid-cols-2">
          {TABLE_LABELS.map(({ key, label }) => (
            <Field key={key} label={label} htmlFor={`table-label-${key}`}>
              <Input
                id={`table-label-${key}`}
                value={config.table.labels[key]}
                maxLength={TEMPLATE_LIMITS.labelMaxLength}
                className="h-9"
                onChange={(e) => update((c) => (c.table.labels[key] = e.target.value))}
              />
            </Field>
          ))}
        </div>
      </Section>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Zahlungstext                                                        */
/* ------------------------------------------------------------------ */

function PaymentEditor({
  config,
  update,
  paymentMethods
}: {
  config: TemplateConfig
  update(m: Mutator): void
  paymentMethods: PaymentMethod[] | undefined
}) {
  const navigate = useNavigate()
  return (
    <div className="space-y-4">
      <Section title="Formatierung">
        <FormatRow
          fontSizePt={config.payment.fontSizePt}
          align={config.payment.align}
          basePt={config.baseFontSizePt}
          label="Zahlungstext"
          onChange={(p) =>
            update((c) => {
              if ('fontSizePt' in p) {
                if (p.fontSizePt === undefined) delete c.payment.fontSizePt
                else c.payment.fontSizePt = p.fontSizePt
              }
              if (p.align) c.payment.align = p.align
            })
          }
        />
      </Section>
      <Section
        title="Texte der Zahlungsarten"
        description="Der Inhalt hängt von der gewählten Zahlungsart ab und wird unter „Zahlarten“ gepflegt."
        actions={
          <Button type="button" variant="outline" size="sm" onClick={() => navigate('/fest/zahlarten')}>
            <ExternalLink aria-hidden />
            Zahlarten öffnen
          </Button>
        }
      >
        {paymentMethods && paymentMethods.length > 0 ? (
          <ul className="space-y-2">
            {paymentMethods.map((pm) => (
              <li key={pm.id} className="rounded-md bg-muted/40 px-3 py-2 text-sm">
                <span className="font-medium">{pm.label}: </span>
                <span className="text-muted-foreground">{richHtmlToPlainText(pm.text) || '(kein Text)'}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Die Zahlungsarten konnten nicht geladen werden – die Vorschau nutzt Standardtexte.</p>
        )}
      </Section>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Fußzeile                                                            */
/* ------------------------------------------------------------------ */

function FooterEditor({ config, update, confirm }: { config: TemplateConfig; update(m: Mutator): void; confirm(r: ConfirmRequest): void }) {
  const sizeId = useId()
  const columns = config.footer.columns
  const setCount = (count: number) => {
    if (count === columns.length) return
    if (count > columns.length) {
      update((c) => {
        while (c.footer.columns.length < count) {
          c.footer.columns.push({ id: newBlockId('footer'), html: '', align: 'left' })
        }
      })
      return
    }
    const removed = columns.slice(count)
    const apply = () => update((c) => (c.footer.columns = c.footer.columns.slice(0, count)))
    if (removed.some((b) => hasContent(b.html))) {
      confirm({
        title: removed.length === 1 ? `Spalte ${count + 1} entfernen?` : `Spalten ${count + 1} bis ${columns.length} entfernen?`,
        description: 'Der Inhalt dieser Fußzeilen-Spalten wird gelöscht.',
        confirmLabel: 'Entfernen',
        onConfirm: apply
      })
    } else apply()
  }
  return (
    <div className="space-y-4">
      <Section>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <div className="space-y-1.5">
            <span className="block text-sm font-medium">Spalten</span>
            <Segmented
              ariaLabel="Anzahl Spalten der Fußzeile"
              value={String(columns.length)}
              onChange={(v) => setCount(Number(v))}
              options={['1', '2', '3', '4'].map((n) => ({ value: n, label: n }))}
            />
          </div>
          <Field label="Schriftgröße" htmlFor={sizeId}>
            <NumberField
              id={sizeId}
              value={config.footer.fontSizePt}
              optional
              placeholder="8"
              onChange={(v) =>
                update((c) => {
                  if (v === undefined) delete c.footer.fontSizePt
                  else c.footer.fontSizePt = v
                })
              }
              min={5}
              max={14}
              step={0.5}
              unit="pt"
              ariaLabel="Schriftgröße Fußzeile in pt"
            />
          </Field>
        </div>
      </Section>
      {columns.map((col, index) => (
        <Section
          key={col.id}
          title={`Spalte ${index + 1}`}
          actions={
            <AlignControl
              value={col.align ?? 'left'}
              onChange={(a) => update((c) => (c.footer.columns[index]!.align = a))}
              ariaLabel={`Ausrichtung Spalte ${index + 1}`}
            />
          }
        >
          <RichTextEditor
            value={col.html}
            onChange={(html) => update((c) => (c.footer.columns[index]!.html = html))}
            ariaLabel={`Fußzeile Spalte ${index + 1}`}
            defaultAlign={col.align}
            minimal={columns.length > 2}
          />
        </Section>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Auswahl                                                             */
/* ------------------------------------------------------------------ */

export function BlockEditor({ block, config, update, festival, paymentMethods, logo, confirm }: BlockEditorProps) {
  const def = getBlock(block)
  const Icon = def.icon
  let body: ReactNode
  switch (block) {
    case 'general':
      body = <GeneralEditor config={config} update={update} logo={logo} />
      break
    case 'returnLine':
    case 'sender':
    case 'subject':
    case 'stornoSubject':
    case 'intro':
      body = <RichBlockEditor key={block} blockKey={block} config={config} update={update} />
      break
    case 'address':
      body = <AddressEditor config={config} update={update} />
      break
    case 'info':
      body = <InfoEditor config={config} update={update} confirm={confirm} />
      break
    case 'afterIntro':
    case 'notes':
    case 'afterPayment':
      body = <SlotEditor key={block} slot={block} config={config} update={update} confirm={confirm} festival={festival} />
      break
    case 'table':
      body = <TableEditor config={config} update={update} festival={festival} />
      break
    case 'payment':
      body = <PaymentEditor config={config} update={update} paymentMethods={paymentMethods} />
      break
    case 'footer':
      body = <FooterEditor config={config} update={update} confirm={confirm} />
      break
  }
  return (
    <div className="space-y-4" data-testid="vorlage-block-editor" data-block={block}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{def.label}</h2>
          <p className="text-sm text-muted-foreground">{def.description}</p>
        </div>
      </div>
      <div className={cn('space-y-4')}>{body}</div>
    </div>
  )
}
