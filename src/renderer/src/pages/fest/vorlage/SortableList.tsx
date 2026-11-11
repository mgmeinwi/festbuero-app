/**
 * Sortierbare Liste (dnd-kit): Ziehen am Griff (auch per Tastatur: Leertaste, Pfeiltasten, Leertaste)
 * und zusätzlich „nach oben/unten“-Knöpfe.
 */
import type { ReactNode } from 'react'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent
} from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ItemControls {
  /** Griff zum Ziehen */
  handle: ReactNode
  /** Knöpfe „nach oben/unten“ */
  moveButtons: ReactNode
  index: number
}

const iconButton =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-40'

function SortableItem({
  id,
  label,
  index,
  count,
  onMove,
  children
}: {
  id: string
  label: string
  index: number
  count: number
  onMove(from: number, to: number): void
  children(controls: ItemControls): ReactNode
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id })
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      className={cn(iconButton, 'cursor-grab active:cursor-grabbing')}
      aria-label={`${label} verschieben (ziehen oder Leertaste)`}
      title="Ziehen zum Sortieren"
      {...attributes}
      {...listeners}
    >
      <GripVertical className="size-4" aria-hidden />
    </button>
  )
  const moveButtons = (
    <>
      <button
        type="button"
        className={iconButton}
        aria-label={`${label} nach oben`}
        title="Nach oben"
        disabled={index === 0}
        onClick={() => onMove(index, index - 1)}
      >
        <ArrowUp className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        className={iconButton}
        aria-label={`${label} nach unten`}
        title="Nach unten"
        disabled={index === count - 1}
        onClick={() => onMove(index, index + 1)}
      >
        <ArrowDown className="size-4" aria-hidden />
      </button>
    </>
  )
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('relative', isDragging && 'z-10 opacity-90 shadow-lg')}
    >
      {children({ handle, moveButtons, index })}
    </li>
  )
}

export function SortableList<T extends { id: string }>({
  items,
  onReorder,
  itemLabel,
  children,
  ariaLabel,
  className
}: {
  items: T[]
  onReorder(items: T[]): void
  /** Beschriftung eines Eintrags für Screenreader, z. B. „Hinweis 2“ */
  itemLabel(item: T, index: number): string
  children(item: T, controls: ItemControls): ReactNode
  ariaLabel: string
  className?: string
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const labelOf = (id: string | number | undefined) => {
    const index = items.findIndex((i) => i.id === id)
    return index >= 0 ? itemLabel(items[index]!, index) : 'Eintrag'
  }
  const positionOf = (id: string | number | undefined) => items.findIndex((i) => i.id === id) + 1
  const announcements: Announcements = {
    onDragStart: ({ active }) => `${labelOf(active.id)} aufgenommen.`,
    onDragOver: ({ active, over }) => (over ? `${labelOf(active.id)} über Position ${positionOf(over.id)}.` : undefined),
    onDragEnd: ({ active, over }) =>
      over ? `${labelOf(active.id)} an Position ${positionOf(over.id)} abgelegt.` : `${labelOf(active.id)} abgelegt.`,
    onDragCancel: ({ active }) => `Verschieben von ${labelOf(active.id)} abgebrochen.`
  }

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return
    onReorder(arrayMove(items, from, to))
  }
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    move(
      items.findIndex((i) => i.id === active.id),
      items.findIndex((i) => i.id === over.id)
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: 'Zum Verschieben Leertaste drücken, mit den Pfeiltasten bewegen und mit Leertaste ablegen. Escape bricht ab.'
        }
      }}
    >
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <ul aria-label={ariaLabel} className={cn('space-y-3', className)}>
          {items.map((item, index) => (
            <SortableItem
              key={item.id}
              id={item.id}
              label={itemLabel(item, index)}
              index={index}
              count={items.length}
              onMove={move}
            >
              {(controls) => children(item, controls)}
            </SortableItem>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}
