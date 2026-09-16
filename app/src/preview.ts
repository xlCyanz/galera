/**
 * Ayudas para la vista previa provisional de las páginas. El lienzo de
 * verdad llega con F1-08.
 */
import type { RenderedPage } from "./commands";

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
 * Una línea que resume las páginas pedidas: cuánto tardó la compilación y si
 * se reutilizó.
 *
 * Todas las páginas de una misma petición salen de la misma compilación, así
 * que basta con mirar la primera que se compiló de verdad.
 */
export function compilationSummary(pages: readonly RenderedPage[]): string {
  const first = pages.find((page) => !page.reused) ?? pages[0];
  if (first === undefined) {
    return "Sin páginas";
  }
  const ms = first.ms.toLocaleString("es", { maximumFractionDigits: 1 });
  const reused = first.reused ? ", reutilizada" : "";
  const count = pages.length === 1 ? "1 página" : `${pages.length} páginas`;
  return `${count} · compilado en ${ms} ms${reused}`;
}
