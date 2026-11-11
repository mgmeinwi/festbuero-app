/**
 * Vite-Import `?inline` liefert den Dateiinhalt als data:-URL (Renderer, Main und Vitest).
 * Für den Renderer deklariert `vite/client` das bereits; Main/Shared (tsconfig.node.json) brauchen diese Angabe.
 */
declare module '*.woff2?inline' {
  const dataUrl: string
  export default dataUrl
}
