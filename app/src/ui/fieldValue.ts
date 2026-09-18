/**
 * Las cuentas de un campo numérico del inspector, sin DOM: leer lo que se
 * escribe, enseñar el valor y arrastrarlo en vertical.
 */

/** Píxeles de arrastre vertical por cada paso del valor. */
export const SCRUB_PX_PER_STEP = 2;

const formatter = new Intl.NumberFormat("es", { maximumFractionDigits: 2, useGrouping: false });

/** El valor como se enseña en el campo: coma decimal y dos decimales como mucho. */
export function formatNumber(value: number): string {
  return formatter.format(Math.round(value * 100) / 100 + 0);
}

/**
 * Lo que se ha escrito, como número. Acepta coma o punto decimal, espacios
 * alrededor y la unidad detrás («12,5 mm», «30°»). `null` si no es un número.
 */
export function parseNumber(text: string): number | null {
  const cleaned = text
    .trim()
    .replace(/\s*(mm|°)$/i, "")
    .replace(",", ".");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) {
    return null;
  }
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Cuánto sube o baja una flecha o un paso de arrastre: 1, 10 con Shift, 0,1 con Alt. */
export function stepFor(modifiers: { shiftKey: boolean; altKey: boolean }): number {
  if (modifiers.shiftKey) {
    return 10;
  }
  return modifiers.altKey ? 0.1 : 1;
}

/**
 * El valor al arrastrar en vertical desde `start`: hacia arriba sube, un paso
 * cada `SCRUB_PX_PER_STEP` píxeles.
 *
 * @param dy Cuánto ha bajado el puntero, en píxeles (negativo si ha subido).
 */
export function scrubValue(start: number, dy: number, step: number): number {
  const steps = Math.trunc(-dy / SCRUB_PX_PER_STEP);
  // Redondeado al paso, para no arrastrar ruido de coma flotante.
  return Math.round((start + steps * step) * 1000) / 1000 + 0;
}
