import { useState } from 'react'
import { Info, ReceiptText } from 'lucide-react'
import type { Club } from '@shared/types'
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

interface DeleteClubDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  club: Club | null
  /** löscht; wirft mit deutscher Meldung (Dialog bleibt dann offen) */
  onConfirm: (club: Club) => Promise<void>
}

/** Bestätigung „Verein löschen?“ – mit Hinweis, falls bereits eine Rechnung existiert. */
export function DeleteClubDialog({ open, onOpenChange, club, onConfirm }: DeleteClubDialogProps) {
  const [busy, setBusy] = useState(false)

  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AlertDialogContent className="transition-none" data-testid="club-delete-dialog">
        <AlertDialogHeader className="text-left">
          <AlertDialogTitle>Verein löschen?</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            „{club?.clubName}“ wird aus dem Vereinsstamm dieses Fests entfernt.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {club?.hasInvoice ? (
          <p className="flex gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm">
            <ReceiptText className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            <span>
              Für diesen Verein gibt es bereits eine Rechnung. Sie bleibt unverändert erhalten, weil sie eine eigene
              Kopie der Vereinsdaten enthält.
            </span>
          </p>
        ) : null}
        {club?.source === 'import' ? (
          <p className="flex gap-2 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>Steht der Verein noch in der Excel-Datei, wird er beim nächsten Import wieder angelegt.</span>
          </p>
        ) : null}
        <AlertDialogFooter className="flex-row justify-end">
          <AlertDialogCancel disabled={busy}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy || !club}
            onClick={async (event) => {
              event.preventDefault()
              if (!club) return
              setBusy(true)
              try {
                await onConfirm(club)
              } finally {
                setBusy(false)
              }
            }}
          >
            Löschen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
