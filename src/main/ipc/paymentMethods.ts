/**
 * IPC `paymentMethods.*` – Zuständig: Bereich „Fest-Einstellungen“.
 */
import { listPaymentMethods, updatePaymentMethod } from '../services/payment-methods'
import { handle } from './handle'

export function register(): void {
  handle('paymentMethods.list', (festivalId) => listPaymentMethods(festivalId))
  handle('paymentMethods.update', (id, patch) => updatePaymentMethod(id, patch))
}
