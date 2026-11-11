import { memo, useId, useState } from 'react'
import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import {
  activeQuickPick,
  prefillQuantity,
  QUICK_PICKS,
  quickPickQuantity,
  type DraftLine,
  type PrefillContext,
  type QuickPick
} from '@shared/invoice-draft'
import { formatAmount, formatEuro, formatEuroOrDash, parseEuroToCents } from '@shared/money'
import { calculateLineTotal } from '@shared/tax'
import { VAT_RATES, type VatRate } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { QuantityInput } from './QuantityInput'
import { StepSection } from './StepSection'

export interface PositionsHandlers {
  setQuantity: (key: string, quantity: number) => void
  quickPick: (key: string, pick: QuickPick) => void
  resetLine: (key: string) => void
  updateExtra: (key: string, patch: Partial<Pick<DraftLine, 'name' | 'priceCents' | 'vatRate' | 'quantity'>>) => void
  removeExtra: (key: string) => void
  addExtra: () => void
  /** Enter im Mengenfeld → nächstes Mengenfeld */
  enterFrom: (key: string) => void
  /** Ref-Callback für Mengenfelder (Fokussteuerung) */
  registerQuantity: (key: string, el: HTMLInputElement | null) => void
  registerExtraName: (key: string, el: HTMLInputElement | null) => void
}

interface PositionsStepProps {
  step: number
  lines: DraftLine[]
  ctx: PrefillContext
  taxExempt: boolean
  loading: boolean
  error: string | null
  handlers: PositionsHandlers
}

const QUICK_LABEL: Record<QuickPick, string> = { 0: '0', 1: '1×', 2: '2×' }

/** Schritt 3: Positionen mit Mengen, Schnellwahl (Vereine) und optionalen Zusatzpositionen. */
export function PositionsStep({ step, lines, ctx, taxExempt, loading, error, handlers }: PositionsStepProps) {
  const isVerein = ctx.customerKind === 'verein'
  const productLines = lines.filter((l) => l.productId !== null)
  const extraLines = lines.filter((l) => l.productId === null)
  const manualCount = isVerein ? productLines.filter((l) => l.manual).length : 0

  return (
    <StepSection
      id="positionen"
      step={step}
      title="Positionen"
      done={false}
      aside={
        manualCount > 0 ? (
          <span className="truncate text-xs text-muted-foreground" data-testid="manual-count">
            {manualCount === 1 ? '1 Zeile von Hand geändert' : `${manualCount} Zeilen von Hand geändert`}
          </span>
        ) : null
      }
    >
      {loading ? (
        <div className="space-y-2 rounded-lg border p-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          Produkte konnten nicht geladen werden: {error}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card" role="group" aria-label="Positionen">
          {productLines.length === 0 && extraLines.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              Für dieses Fest sind noch keine aktiven Produkte angelegt (Fest → Produkte).
            </p>
          ) : null}
          <ul className="divide-y">
            {productLines.map((line) => (
              <ProductRow
                key={line.key}
                line={line}
                persons={ctx.persons}
                prefill={prefillQuantity(line, ctx)}
                showQuick={isVerein}
                showManual={isVerein}
                handlers={handlers}
              />
            ))}
            {extraLines.map((line) => (
              <ExtraRow key={line.key} line={line} taxExempt={taxExempt} handlers={handlers} />
            ))}
          </ul>
        </div>
      )}
      {!loading && !error ? (
        <div>
          <Button
            variant="link"
            size="sm"
            className="h-8 px-1 text-muted-foreground hover:text-primary"
            onClick={handlers.addExtra}
            data-testid="add-extra"
          >
            <Plus aria-hidden />
            Zusatzposition
          </Button>
        </div>
      ) : null}
    </StepSection>
  )
}

interface ProductRowProps {
  line: DraftLine
  persons: number | null
  prefill: number
  showQuick: boolean
  showManual: boolean
  handlers: PositionsHandlers
}

const ProductRow = memo(function ProductRow({
  line,
  persons,
  prefill,
  showQuick,
  showManual,
  handlers
}: ProductRowProps) {
  const total = calculateLineTotal(line.priceCents, line.quantity)
  const marked = showManual && line.manual
  const active = activeQuickPick(line.quantity, persons)
  return (
    <li
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 @lg/mask:gap-3',
        marked && 'bg-primary/[0.06] shadow-[inset_3px_0_0_var(--color-primary)]'
      )}
      data-testid="position-row"
      data-key={line.key}
      data-manual={marked ? 'true' : 'false'}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium" title={line.name}>
          {line.name}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="tabular-nums">{formatEuro(line.priceCents)}</span>
          {marked ? (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => handlers.resetLine(line.key)}
              className="-my-1 inline-flex h-6 min-w-0 items-center gap-1 rounded px-1.5 font-medium text-primary hover:bg-primary/10"
              title={`Von Hand geändert – auf Vorbelegung (${prefill}) zurücksetzen`}
              aria-label={`${line.name}: auf Vorbelegung ${prefill} zurücksetzen`}
              data-testid="reset-line"
            >
              <RotateCcw className="size-3 shrink-0" aria-hidden />
              <span className="truncate">geändert</span>
            </button>
          ) : null}
        </div>
      </div>
      <QuantityInput
        value={line.quantity}
        onValueChange={(q) => handlers.setQuantity(line.key, q)}
        onEnter={() => handlers.enterFrom(line.key)}
        inputRef={(el) => handlers.registerQuantity(line.key, el)}
        aria-label={`Menge ${line.name}`}
        className="w-16 shrink-0 @lg/mask:w-20"
        data-testid="quantity-input"
      />
      {showQuick ? (
        <div
          className="flex shrink-0 rounded-md border bg-background shadow-xs dark:bg-input/30"
          role="group"
          aria-label={`Schnellwahl ${line.name}`}
        >
          {QUICK_PICKS.map((pick) => (
            <button
              key={pick}
              type="button"
              tabIndex={-1}
              aria-pressed={active === pick}
              onClick={() => handlers.quickPick(line.key, pick)}
              title={pick === 0 ? 'Menge 0' : `${QUICK_LABEL[pick]} Personen = ${quickPickQuantity(pick, persons)}`}
              className={cn(
                'h-10 w-9 text-sm font-medium tabular-nums transition-colors first:rounded-l-md last:rounded-r-md not-first:border-l @lg/mask:w-10',
                active === pick
                  ? 'bg-accent font-semibold text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              )}
              data-testid={`quick-${pick}`}
            >
              {QUICK_LABEL[pick]}
            </button>
          ))}
        </div>
      ) : null}
      <div
        className={cn(
          'w-20 shrink-0 text-right tabular-nums @lg/mask:w-24',
          line.quantity === 0 && 'text-muted-foreground'
        )}
        data-testid="line-total"
      >
        {formatEuroOrDash(total)}
      </div>
    </li>
  )
})

function ExtraRow({ line, taxExempt, handlers }: { line: DraftLine; taxExempt: boolean; handlers: PositionsHandlers }) {
  const id = useId()
  const total = calculateLineTotal(line.priceCents, line.quantity)
  return (
    <li className="flex flex-wrap items-center gap-2 bg-muted/40 px-3 py-2" data-testid="extra-row" data-key={line.key}>
      <Input
        ref={(el) => handlers.registerExtraName(line.key, el)}
        id={`${id}-name`}
        aria-label="Bezeichnung der Zusatzposition"
        placeholder="Bezeichnung der Zusatzposition"
        value={line.name}
        onChange={(e) => handlers.updateExtra(line.key, { name: e.target.value })}
        className="min-w-0 flex-[1_1_12rem]"
        aria-invalid={line.name.trim() === '' && line.quantity !== 0 ? true : undefined}
        data-testid="extra-name"
      />
      <div className="ml-auto flex items-center gap-2">
        <EuroInput
          valueCents={line.priceCents}
          onChange={(cents) => handlers.updateExtra(line.key, { priceCents: cents })}
          ariaLabel="Einzelpreis der Zusatzposition"
        />
        {!taxExempt ? (
          <select
            aria-label="Steuersatz der Zusatzposition"
            value={line.vatRate}
            onChange={(e) => handlers.updateExtra(line.key, { vatRate: Number(e.target.value) as VatRate })}
            className="h-10 rounded-md border border-input bg-background px-2 text-sm shadow-xs dark:bg-input/30"
          >
            {VAT_RATES.map((r) => (
              <option key={r} value={r}>
                {r} %
              </option>
            ))}
          </select>
        ) : null}
        <QuantityInput
          value={line.quantity}
          onValueChange={(q) => handlers.updateExtra(line.key, { quantity: q })}
          onEnter={() => handlers.enterFrom(line.key)}
          inputRef={(el) => handlers.registerQuantity(line.key, el)}
          aria-label="Menge der Zusatzposition"
          className="w-16 shrink-0 @lg/mask:w-20"
          data-testid="quantity-input"
        />
        <div
          className={cn(
            'w-20 shrink-0 text-right tabular-nums @lg/mask:w-24',
            line.quantity === 0 && 'text-muted-foreground'
          )}
        >
          {formatEuroOrDash(total)}
        </div>
        <Button
          variant="ghost"
          size="icon"
          tabIndex={-1}
          onClick={() => handlers.removeExtra(line.key)}
          aria-label="Zusatzposition entfernen"
          title="Zusatzposition entfernen"
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
    </li>
  )
}

/** Betragsfeld (z. B. „12,50“), übernimmt gültige Eingaben sofort, formatiert beim Verlassen. */
function EuroInput({
  valueCents,
  onChange,
  ariaLabel
}: {
  valueCents: number
  onChange: (cents: number) => void
  ariaLabel: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? (valueCents === 0 ? '' : formatAmount(valueCents))
  const parsed = draft === null ? valueCents : draft.trim() === '' ? 0 : parseEuroToCents(draft)
  const invalid = parsed === null || parsed < 0
  return (
    <div className="relative">
      <Input
        aria-label={ariaLabel}
        inputMode="decimal"
        placeholder="0,00"
        value={text}
        onChange={(e) => {
          setDraft(e.target.value)
          const cents = e.target.value.trim() === '' ? 0 : parseEuroToCents(e.target.value)
          if (cents !== null && cents >= 0) onChange(cents)
        }}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => setDraft(null)}
        aria-invalid={invalid ? true : undefined}
        className="w-28 pr-7 text-right tabular-nums"
        data-testid="extra-price"
      />
      <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted-foreground">
        €
      </span>
    </div>
  )
}
