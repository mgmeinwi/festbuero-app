/**
 * Route: /fest/produkte – Produkte anlegen, bearbeiten, sortieren (Drag-and-drop mit Maus oder
 * Tastatur, zusätzlich Hoch/Runter), deaktivieren und löschen (nur unbenutzte).
 * Zuständig: Bereich „Fest-Einstellungen“.
 *
 * Query-Key `['products', festivalId]` enthält die VOLLSTÄNDIGE Liste inkl. inaktiver Produkte.
 */
import { useMemo, useRef, useState } from 'react'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type Modifier,
  type ScreenReaderInstructions,
  type UniqueIdentifier
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, Package, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Product } from '@shared/types'
import { PageContainer, PageHeader } from '@/components/layout/PageHeader'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { queryKeys } from '@/hooks/query-keys'
import { useActiveFestival } from '@/hooks/use-active-festival'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/utils'
import { FEST_PAGE_CLASS, ScrollToTopOnMount } from '../allgemein/form-kit'
import { ProductDialog } from './ProductDialog'
import { moveItem } from './product-format'
import { ProductRow, ROW_GRID } from './ProductRow'

/** Nur vertikal verschieben. */
const restrictToVertical: Modifier = ({ transform }) => ({ ...transform, x: 0 })

const SCREEN_READER_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    'Zum Sortieren die Leertaste drücken, mit den Pfeiltasten verschieben und mit der Leertaste ablegen. Escape bricht ab.'
}

export default function FestProduktePage() {
  const { festival } = useActiveFestival()
  if (!festival) return null
  return <ProductsView key={festival.id} festivalId={festival.id} />
}

function ProductsView({ festivalId }: { festivalId: number }) {
  const queryClient = useQueryClient()
  const key = queryKeys.products(festivalId)
  const query = useQuery<Product[]>({ queryKey: key, queryFn: () => api.products.list(festivalId) })
  const products = useMemo(() => query.data ?? [], [query.data])

  const [dialog, setDialog] = useState<{ open: boolean; product: Product | null }>({ open: false, product: null })
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null)
  const reorderSeq = useRef(0)
  const lastOverRef = useRef<UniqueIdentifier | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  /* ---------------- Mutationen ---------------- */

  const reorder = useMutation({
    mutationFn: (orderedIds: number[]) => api.products.reorder(festivalId, orderedIds),
    onMutate: async (orderedIds) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<Product[]>(key)
      if (previous) {
        const byId = new Map(previous.map((p) => [p.id, p]))
        const next = orderedIds.map((id, index) => ({ ...byId.get(id)!, sortOrder: index }))
        queryClient.setQueryData<Product[]>(key, next)
      }
      return { previous, seq: ++reorderSeq.current }
    },
    onError: (err, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
      toast.error(errorMessage(err))
    },
    onSuccess: (list, _ids, context) => {
      // nur die Antwort der letzten Verschiebung übernehmen (schnelles Mehrfachklicken)
      if (context?.seq === reorderSeq.current) queryClient.setQueryData(key, list)
    }
  })

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<Product> }) =>
      api.products.update(id, { ...(patch.active !== undefined ? { active: patch.active } : {}) }),
    onSuccess: (saved) => {
      queryClient.setQueryData<Product[]>(key, (list) => list?.map((p) => (p.id === saved.id ? saved : p)))
      void queryClient.invalidateQueries({ queryKey: key })
    }
  })

  const remove = useMutation({
    mutationFn: (id: number) => api.products.delete(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key })
    }
  })

  /* ---------------- Aktionen ---------------- */

  function applyOrder(next: Product[]) {
    reorder.mutate(next.map((p) => p.id))
  }

  function move(product: Product, direction: -1 | 1) {
    const index = products.findIndex((p) => p.id === product.id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= products.length) return
    applyOrder(moveItem(products, index, target))
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = products.findIndex((p) => p.id === active.id)
    const to = products.findIndex((p) => p.id === over.id)
    if (from < 0 || to < 0) return
    applyOrder(moveItem(products, from, to))
  }

  function toggleActive(product: Product) {
    const active = !product.active
    update.mutate(
      { id: product.id, patch: { active } },
      {
        onSuccess: () =>
          toast.success(active ? `„${product.name}“ aktiviert.` : `„${product.name}“ deaktiviert.`, {
            action: {
              label: 'Rückgängig',
              onClick: () => update.mutate({ id: product.id, patch: { active: !active } })
            }
          }),
        onError: (err) => toast.error(errorMessage(err))
      }
    )
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    try {
      await remove.mutateAsync(deleteTarget.id)
      toast.success(`„${deleteTarget.name}“ gelöscht.`)
      setDeleteTarget(null)
    } catch (err) {
      toast.error(errorMessage(err))
      setDeleteTarget(null)
    }
  }

  /* ---------------- Barrierefreiheit ---------------- */

  const nameOf = (id: UniqueIdentifier) => products.find((p) => p.id === id)?.name ?? 'Produkt'
  const positionOf = (id: UniqueIdentifier) => products.findIndex((p) => p.id === id) + 1
  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      lastOverRef.current = active.id
      return `„${nameOf(active.id)}“ aufgenommen. Position ${positionOf(active.id)} von ${products.length}.`
    },
    onDragOver: ({ active, over }) => {
      // keine Ansage beim Start (over = aufgenommenes Element), sonst wird „aufgenommen“ sofort überschrieben
      if (!over || over.id === lastOverRef.current) return undefined
      lastOverRef.current = over.id
      return `„${nameOf(active.id)}“ ist jetzt auf Position ${positionOf(over.id)} von ${products.length}.`
    },
    onDragEnd: ({ active, over }) =>
      over
        ? `„${nameOf(active.id)}“ auf Position ${positionOf(over.id)} von ${products.length} abgelegt.`
        : `„${nameOf(active.id)}“ abgelegt.`,
    onDragCancel: ({ active }) => `Sortieren abgebrochen. „${nameOf(active.id)}“ bleibt auf Position ${positionOf(active.id)}.`
  }

  const inactiveCount = products.filter((p) => !p.active).length
  const summary =
    products.length === 0
      ? 'Produkte, Preise und Steuersätze dieses Fests.'
      : `${products.length} ${products.length === 1 ? 'Produkt' : 'Produkte'}${
          inactiveCount > 0 ? `, davon ${inactiveCount} inaktiv` : ''
        }. Die Reihenfolge gilt auch in der Festbüro-Maske und auf der Rechnung.`

  return (
    <PageContainer className={`${FEST_PAGE_CLASS} max-w-5xl`}>
      <ScrollToTopOnMount />
      <PageHeader
        title="Produkte"
        description={summary}
        actions={
          <Button onClick={() => setDialog({ open: true, product: null })}>
            <Plus aria-hidden />
            Neues Produkt
          </Button>
        }
      />

      {query.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : query.error ? (
        <p role="alert" className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive">
          Produkte konnten nicht geladen werden: {errorMessage(query.error)}
        </p>
      ) : products.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed p-10 text-center" data-testid="products-empty">
          <span className="flex size-12 items-center justify-center rounded-full bg-accent text-primary">
            <Package className="size-6" aria-hidden />
          </span>
          <div className="space-y-1">
            <p className="font-medium">Noch keine Produkte</p>
            <p className="text-sm text-muted-foreground">Lege z. B. Festzeichen, Festessen oder die Festschrift an.</p>
          </div>
          <Button onClick={() => setDialog({ open: true, product: null })}>
            <Plus aria-hidden />
            Erstes Produkt anlegen
          </Button>
        </div>
      ) : (
        <div className="@container overflow-hidden rounded-xl border bg-card shadow-xs">
          <div
            className={`${ROW_GRID} hidden border-b bg-muted/50 px-2 py-2 text-xs font-medium text-muted-foreground sm:px-3 @3xl:grid`}
            aria-hidden
          >
            <span />
            <span>Bezeichnung</span>
            <span>MwSt</span>
            <span>Modus</span>
            <span className="text-right">Bruttopreis</span>
            <span className="text-right">Aktionen</span>
          </div>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVertical]}
            onDragEnd={handleDragEnd}
            accessibility={{ announcements, screenReaderInstructions: SCREEN_READER_INSTRUCTIONS }}
          >
            <SortableContext items={products.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              <ul className="divide-y" aria-label="Produkte (sortierbar)" data-testid="product-list">
                {products.map((product, index) => (
                  <ProductRow
                    key={product.id}
                    product={product}
                    index={index}
                    count={products.length}
                    onEdit={(p) => setDialog({ open: true, product: p })}
                    onMove={move}
                    onToggleActive={toggleActive}
                    onDelete={setDeleteTarget}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </div>
      )}

      <ProductDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        festivalId={festivalId}
        product={dialog.product}
      />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && !remove.isPending && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>„{deleteTarget?.name}“ löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Das Produkt wird endgültig entfernt. Es wurde noch in keiner Rechnung verwendet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={(event) => {
                event.preventDefault()
                void confirmDelete()
              }}
            >
              {remove.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  )
}
