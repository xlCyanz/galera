/**
 * Textos que enseña la interfaz a partir del estado.
 */

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
