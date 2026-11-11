import { LoaderCircle } from 'lucide-react'
import type { Festival } from '@shared/types'
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
import { NewFestivalForm } from './NewFestivalForm'

interface NewFestivalDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (festival: Festival) => void
}

/** Dialog „Neues Fest anlegen …“ aus der Kopfleiste. Das neue Fest wird sofort aktiv. */
export function NewFestivalDialog({ open, onOpenChange, onCreated }: NewFestivalDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Neues Gründungsfest anlegen</DialogTitle>
          <DialogDescription>
            Produkte, Vereine und Vorlage richtest du danach unter „Fest-Einstellungen“ ein.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <NewFestivalForm
            onCreated={(festival) => {
              onOpenChange(false)
              onCreated?.(festival)
            }}
            renderActions={({ submitting, formId }) => (
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    Abbrechen
                  </Button>
                </DialogClose>
                <Button type="submit" form={formId} disabled={submitting}>
                  {submitting ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                  Fest anlegen
                </Button>
              </DialogFooter>
            )}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
