import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * Dateipfad in einer Zeile, der bei Platzmangel VORNE gekürzt wird („…/Dokumente/Festbüro“),
 * damit der aussagekräftige Ordnername sichtbar bleibt. Voller Pfad im Tooltip.
 */
export function PathText({ path, className, ...props }: { path: string } & Omit<ComponentProps<'span'>, 'children'>) {
  return (
    <span dir="rtl" title={path} className={cn('block min-w-0 truncate text-left', className)} {...props}>
      <bdi dir="ltr">{path}</bdi>
    </span>
  )
}
