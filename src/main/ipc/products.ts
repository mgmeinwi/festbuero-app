/**
 * IPC `products.*` – Zuständig: Bereich „Fest-Einstellungen“.
 */
import { createProduct, deleteProduct, listProducts, reorderProducts, updateProduct } from '../services/products'
import { handle } from './handle'

export function register(): void {
  handle('products.list', (festivalId, opts) => listProducts(festivalId, opts ?? {}))
  handle('products.create', (festivalId, input) => createProduct(festivalId, input))
  handle('products.update', (id, patch) => updateProduct(id, patch))
  handle('products.delete', (id) => deleteProduct(id))
  handle('products.reorder', (festivalId, orderedIds) => reorderProducts(festivalId, orderedIds))
}
