/**
 * Ayudas para la vista previa provisional de las páginas. El lienzo de
 * verdad llega con F1-08.
 */
/**
 * Convierte un SVG en una dirección `data:` para usarlo como `src` de una
 * `<img>`.
 *
 * Una imagen no ejecuta nada de lo que traiga el SVG, a diferencia de
 * insertarlo en el DOM.
 */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Una línea que resume la última compilación: cuántas páginas, cuánto tardó
 * y si se reutilizó.
 */
export function compilationSummary(pageCount: number, ms: number | null, reused: boolean): string {
  if (ms === null) {
    return "Sin compilar";
  }
  const time = ms.toLocaleString("es", { maximumFractionDigits: 1 });
  const count = pageCount === 1 ? "1 página" : `${pageCount} páginas`;
  return `${count} · compilado en ${time} ms${reused ? ", reutilizada" : ""}`;
}
