/**
 * IPC `evaluation.*` und `invoices.exportListExcel`
 *
 * Zuständig: Bereich „Liste & Auswertung“. Der Kanal `invoices.exportListExcel` liegt im Namespace
 * `invoices`, gehört aber zu diesem Bereich (alle übrigen `invoices.*` registriert `ipc/invoices.ts`).
 */
import { exportEvaluationExcel } from '../services/evaluation-export'
import { getEvaluation } from '../services/evaluation'
import { exportInvoiceListExcel } from '../services/invoice-list-export'
import { handle } from './handle'

export function register(): void {
  handle('evaluation.get', (festivalId) => getEvaluation(festivalId))
  handle('evaluation.exportExcel', (festivalId) => exportEvaluationExcel(festivalId))
  handle('invoices.exportListExcel', (festivalId, ids) => exportInvoiceListExcel(festivalId, ids))
}
