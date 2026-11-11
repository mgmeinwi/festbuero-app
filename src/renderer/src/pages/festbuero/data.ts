/**
 * Daten der Festbüro-Maske (react-query, Schlüssel aus `@/hooks/query-keys`).
 *
 * Produkte und Vereine werden in derselben Form wie auf den Einstellungsseiten geladen (alle
 * Produkte, gefiltert wird in der Maske), damit sich die Caches nicht widersprechen.
 */
import { useQuery } from '@tanstack/react-query'
import { getDefaultTemplateConfig } from '@shared/invoice-render/default-template'
import { formatInvoiceNumber } from '@shared/numbering'
import type { Club, Festival, PaymentMethod, Product, Template, TemplateConfig } from '@shared/types'
import { queryKeys } from '@/hooks/query-keys'
import { api, isNotAvailableError } from '@/lib/api'

/** Ersatz, solange `paymentMethods.list` noch nicht verfügbar ist (Texte laut Spezifikation). */
const FALLBACK_PAYMENT_METHODS: PaymentMethod[] = [
  {
    id: -1,
    festivalId: 0,
    kind: 'bar',
    label: 'Bar',
    text: '<p>Betrag bar erhalten ____________________</p>',
    dueDays: 7,
    isDefault: true
  },
  {
    id: -2,
    festivalId: 0,
    kind: 'ueberweisung',
    label: 'Überweisung',
    text:
      '<p>Bitte überweisen Sie den Betrag von {Gesamtbetrag} bis zum {Fälligkeitsdatum} unter Angabe der ' +
      'Rechnungsnummer {Rechnungsnummer} auf das unten genannte Konto.</p>',
    dueDays: 7,
    isDefault: false
  }
]

export function useProducts(festivalId: number) {
  return useQuery<Product[]>({
    queryKey: queryKeys.products(festivalId),
    queryFn: () => api.products.list(festivalId)
  })
}

export function useClubs(festivalId: number) {
  return useQuery<Club[]>({
    queryKey: queryKeys.clubs(festivalId),
    queryFn: () => api.clubs.list(festivalId)
  })
}

export function usePaymentMethods(festivalId: number) {
  return useQuery<PaymentMethod[]>({
    queryKey: queryKeys.paymentMethods(festivalId),
    queryFn: async () => {
      try {
        return await api.paymentMethods.list(festivalId)
      } catch (err) {
        if (isNotAvailableError(err)) return FALLBACK_PAYMENT_METHODS
        throw err
      }
    }
  })
}

export interface PreviewTemplate {
  config: TemplateConfig
  logoFile: string | null
}

const selectPreviewTemplate = (t: Template): PreviewTemplate => ({ config: t.config, logoFile: t.logoFile })

export function useTemplate(festivalId: number) {
  return useQuery<Template, Error, PreviewTemplate>({
    queryKey: queryKeys.template(festivalId),
    queryFn: async () => {
      try {
        return await api.templates.get(festivalId)
      } catch (err) {
        if (isNotAvailableError(err)) {
          return { id: 0, festivalId, config: getDefaultTemplateConfig(), logoFile: null, updatedAt: '' }
        }
        throw err
      }
    },
    select: selectPreviewTemplate
  })
}

export function useLogoDataUrl(festivalId: number, logoFile: string | null | undefined) {
  return useQuery<string | null>({
    queryKey: [...queryKeys.template(festivalId), 'logo', logoFile ?? null],
    queryFn: async () => {
      if (!logoFile) return null
      try {
        return await api.templates.getLogoDataUrl(logoFile)
      } catch {
        return null
      }
    },
    enabled: !!logoFile,
    staleTime: Infinity
  })
}

/** Nummer, die die nächste Rechnung erhalten würde (nur Anzeige). */
export function useNextNumberPreview(festival: Festival) {
  return useQuery<string>({
    queryKey: [...queryKeys.invoices(festival.id), 'nextNumberPreview'],
    queryFn: async () => {
      try {
        return await api.invoices.nextNumberPreview(festival.id)
      } catch (err) {
        if (isNotAvailableError(err)) {
          return formatInvoiceNumber(festival.numberPrefix, festival.numberNext, festival.numberDigits)
        }
        throw err
      }
    },
    staleTime: 0
  })
}
