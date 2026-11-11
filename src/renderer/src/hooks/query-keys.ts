/**
 * react-query-Schlüssel (architecture.md §3). Nach Mutationen die passenden Schlüssel invalidieren, z. B.
 *   queryClient.invalidateQueries({ queryKey: queryKeys.products(festivalId) })
 */
export const queryKeys = {
  festivals: ['festivals'] as const,
  products: (festivalId: number | null | undefined) => ['products', festivalId] as const,
  clubs: (festivalId: number | null | undefined) => ['clubs', festivalId] as const,
  paymentMethods: (festivalId: number | null | undefined) => ['paymentMethods', festivalId] as const,
  template: (festivalId: number | null | undefined) => ['template', festivalId] as const,
  invoices: (festivalId: number | null | undefined) => ['invoices', festivalId] as const,
  evaluation: (festivalId: number | null | undefined) => ['evaluation', festivalId] as const,
  settings: ['settings'] as const,
  printers: ['printers'] as const,
  printerStatus: ['printerStatus'] as const,
  appInfo: ['appInfo'] as const
} as const
