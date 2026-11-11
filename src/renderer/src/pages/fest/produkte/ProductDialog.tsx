import { useId, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import { formatAmount, parseEuroToCents } from '@shared/money'
import type { Product, ProductInput, ProductMode, VatRate } from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { queryKeys } from '@/hooks/query-keys'
import { api } from '@/lib/api'
import { cn, errorMessage } from '@/lib/utils'
import { FieldMessage, parseIntegerInput } from '../allgemein/form-kit'
import { MODE_DESCRIPTIONS, MODE_LABELS } from './product-format'

interface ProductDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  festivalId: number
  /** null = neues Produkt */
  product: Product | null
}

/** Dialog „Produkt anlegen / bearbeiten“. */
export function ProductDialog({ open, onOpenChange, festivalId, product }: ProductDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="product-dialog">
        {open ? (
          <ProductForm key={product?.id ?? 'new'} festivalId={festivalId} product={product} onDone={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

const VAT_OPTIONS: VatRate[] = [7, 19]
const MODE_OPTIONS: ProductMode[] = ['pro_person', 'feste_anzahl']

function ProductForm({ festivalId, product, onDone }: { festivalId: number; product: Product | null; onDone: () => void }) {
  const formId = useId()
  const queryClient = useQueryClient()
  const [name, setName] = useState(product?.name ?? '')
  const [price, setPrice] = useState(product ? formatAmount(product.priceCents) : '')
  const [vatRate, setVatRate] = useState<VatRate>(product?.vatRate ?? 19)
  const [mode, setMode] = useState<ProductMode>(product?.mode ?? 'pro_person')
  const [quantity, setQuantity] = useState(String(product?.defaultQuantity ?? 1))
  const [active, setActive] = useState(product?.active ?? true)
  const [showErrors, setShowErrors] = useState(false)

  const priceCents = parseEuroToCents(price)
  const quantityNum = parseIntegerInput(quantity)
  const errors = {
    name: name.trim() === '' ? 'Bitte eine Bezeichnung angeben.' : name.trim().length > 120 ? 'Höchstens 120 Zeichen.' : undefined,
    price:
      price.trim() === ''
        ? 'Bitte einen Preis angeben, z. B. „9,70“.'
        : priceCents === null
          ? 'Ungültiger Betrag. Bitte z. B. „9,70“ eingeben.'
          : priceCents < 0
            ? 'Der Preis darf nicht negativ sein.'
            : undefined,
    quantity: quantityNum === null ? 'Bitte eine ganze Zahl ab 0 angeben.' : undefined
  }
  const hasErrors = Object.values(errors).some(Boolean)
  const err = (key: keyof typeof errors) => (showErrors ? errors[key] : undefined)

  const mutation = useMutation({
    mutationFn: (input: ProductInput) =>
      product ? api.products.update(product.id, input) : api.products.create(festivalId, input),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.products(festivalId) })
      toast.success(product ? `„${saved.name}“ gespeichert.` : `Produkt „${saved.name}“ angelegt.`)
      onDone()
    }
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (hasErrors || priceCents === null || quantityNum === null) {
      setShowErrors(true)
      return
    }
    mutation.mutate({ name: name.trim(), priceCents, vatRate, mode, defaultQuantity: quantityNum, active })
  }

  const ids = {
    name: `${formId}-name`,
    price: `${formId}-price`,
    quantity: `${formId}-quantity`,
    active: `${formId}-active`
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{product ? 'Produkt bearbeiten' : 'Neues Produkt'}</DialogTitle>
        <DialogDescription>
          {product?.usedInInvoices
            ? 'Bereits erstellte Rechnungen behalten ihre gespeicherten Preise.'
            : 'Preise sind Bruttopreise inklusive Mehrwertsteuer.'}
        </DialogDescription>
      </DialogHeader>
      <form id={formId} onSubmit={handleSubmit} noValidate className="grid gap-5">
        <div className="grid gap-2">
          <Label htmlFor={ids.name}>Bezeichnung</Label>
          <Input
            id={ids.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Festzeichen"
            autoFocus
            autoComplete="off"
            aria-invalid={err('name') ? true : undefined}
          />
          {err('name') ? <FieldMessage error>{err('name')}</FieldMessage> : null}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="grid min-w-0 content-start gap-2">
            <Label htmlFor={ids.price}>Bruttopreis</Label>
            <div className="relative">
              <Input
                id={ids.price}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                onBlur={() => {
                  if (priceCents !== null && priceCents >= 0) setPrice(formatAmount(priceCents))
                }}
                inputMode="decimal"
                placeholder="0,00"
                className="pr-8 text-right tabular-nums"
                autoComplete="off"
                aria-invalid={err('price') ? true : undefined}
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground" aria-hidden>
                €
              </span>
            </div>
            {err('price') ? <FieldMessage error>{err('price')}</FieldMessage> : null}
          </div>
          <div className="grid min-w-0 content-start gap-2">
            <Label id={`${formId}-vat-label`}>MwSt-Satz</Label>
            <RadioGroup
              aria-labelledby={`${formId}-vat-label`}
              value={String(vatRate)}
              onValueChange={(v) => setVatRate(Number(v) as VatRate)}
              className="grid grid-cols-2 gap-2"
            >
              {VAT_OPTIONS.map((rate) => (
                <Label
                  key={rate}
                  htmlFor={`${formId}-vat-${rate}`}
                  className={cn(
                    'flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 font-normal transition-colors',
                    vatRate === rate ? 'border-primary bg-accent' : 'hover:bg-accent/60'
                  )}
                >
                  <RadioGroupItem id={`${formId}-vat-${rate}`} value={String(rate)} />
                  {rate} %
                </Label>
              ))}
            </RadioGroup>
          </div>
        </div>

        <div className="grid gap-2">
          <Label id={`${formId}-mode-label`}>Modus</Label>
          <RadioGroup
            aria-labelledby={`${formId}-mode-label`}
            value={mode}
            onValueChange={(v) => setMode(v as ProductMode)}
            className="grid gap-2 sm:grid-cols-2"
          >
            {MODE_OPTIONS.map((m) => (
              <Label
                key={m}
                htmlFor={`${formId}-mode-${m}`}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 font-normal leading-snug transition-colors',
                  mode === m ? 'border-primary bg-accent' : 'hover:bg-accent/60'
                )}
              >
                <RadioGroupItem id={`${formId}-mode-${m}`} value={m} className="mt-0.5" />
                <span className="grid gap-1">
                  <span className="font-medium">{MODE_LABELS[m]}</span>
                  <span className="text-xs text-muted-foreground">{MODE_DESCRIPTIONS[m]}</span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        </div>

        <div className="grid gap-2">
          <Label htmlFor={ids.quantity}>Standardanzahl</Label>
          <Input
            id={ids.quantity}
            className="w-28 tabular-nums"
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
            disabled={mode !== 'feste_anzahl'}
            aria-invalid={err('quantity') ? true : undefined}
            aria-describedby={`${ids.quantity}-msg`}
          />
          <FieldMessage id={`${ids.quantity}-msg`} error={Boolean(err('quantity'))}>
            {err('quantity') ??
              (mode === 'feste_anzahl'
                ? 'Diese Menge wird bei Vereinsrechnungen vorbelegt.'
                : 'Nur bei „feste Anzahl“ relevant.')}
          </FieldMessage>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-lg border px-3 py-3">
          <div className="min-w-0 space-y-1">
            <Label htmlFor={ids.active}>Aktiv</Label>
            <p className="text-xs text-muted-foreground">Nur aktive Produkte erscheinen in der Festbüro-Maske.</p>
          </div>
          <Switch id={ids.active} checked={active} onCheckedChange={setActive} />
        </div>

        {mutation.error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {errorMessage(mutation.error)}
          </p>
        ) : null}
      </form>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Abbrechen
          </Button>
        </DialogClose>
        <Button type="submit" form={formId} disabled={mutation.isPending}>
          {mutation.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          {product ? 'Speichern' : 'Produkt anlegen'}
        </Button>
      </DialogFooter>
    </>
  )
}
