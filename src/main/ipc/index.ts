/**
 * Registriert alle IPC-Handler. Jedes Feature-Modul exportiert `register()`.
 * Neue Handler gehören in das Modul des jeweiligen Namespace – diese Datei muss dafür nicht
 * geändert werden.
 */
import { register as registerApp } from './app'
import { register as registerClubs } from './clubs'
import { register as registerEvaluation } from './evaluation'
import { register as registerFestivals } from './festivals'
import { register as registerInvoices } from './invoices'
import { register as registerPaymentMethods } from './paymentMethods'
import { register as registerPrinting } from './printing'
import { register as registerProducts } from './products'
import { register as registerTemplates } from './templates'

export function registerAllIpc(): void {
  registerApp()
  registerFestivals()
  registerProducts()
  registerPaymentMethods()
  registerClubs()
  registerTemplates()
  registerInvoices()
  registerPrinting()
  registerEvaluation()
}
