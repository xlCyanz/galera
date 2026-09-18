/**
 * Las cuentas de girar un elemento con su manejador, sin DOM.
 *
 * Los ángulos van en grados y en sentido horario, como los guarda el modelo
 * y como los emite el codegen en `rotate(…, origin: center + horizon)`: el
 * elemento gira sobre su centro y su caja sin girar no se mueve. La pantalla
 * tiene la `y` hacia abajo, así que un ángulo positivo gira a la derecha
 * tanto en CSS como en Typst.
 */

/** Con Shift, el giro va de 15 en 15 grados. */
export const SNAP_DEGREES = 15;

export interface Point {
  x: number;
  y: number;
}

/**
 * Hacia dónde queda `point` visto desde `center`: 0° arriba, 90° a la
 * derecha, en sentido horario.
 */
export function pointerAngle(center: Point, point: Point): number {
  return (Math.atan2(point.x - center.x, center.y - point.y) * 180) / Math.PI;
}

/** El mismo ángulo en (-180, 180], como lo devuelve el layout. */
export function normalizeDegrees(value: number): number {
  const angle = ((value % 360) + 360) % 360;
  return angle > 180 ? angle - 360 : angle;
}

/** Redondea a la milésima de grado: sin ruido de coma flotante en el documento. */
export function roundDegrees(value: number): number {
  return Math.round(value * 1000) / 1000 + 0;
}

/**
 * El giro nuevo al llevar el puntero de `origin` a `pointer` alrededor de
 * `center`, partiendo de `start`.
 *
 * El elemento gira lo mismo que gira el puntero alrededor del centro: no
 * salta al pulsar el manejador aunque no se pulse justo en su centro. Con
 * `snap` el resultado es un múltiplo de 15°.
 */
export function rotationFor(start: number, center: Point, origin: Point, pointer: Point, snap: boolean): number {
  const turned = start + pointerAngle(center, pointer) - pointerAngle(center, origin);
  const rotation = snap ? Math.round(turned / SNAP_DEGREES) * SNAP_DEGREES : turned;
  const rounded = roundDegrees(normalizeDegrees(rotation));
  // Redondear -179,9996 da -180, que ya es 180.
  return rounded === -180 ? 180 : rounded;
}

/** Si dos giros son el mismo: soltar entonces no es un cambio. */
export function sameRotation(a: number, b: number): boolean {
  return Math.abs(normalizeDegrees(a - b)) < 1e-6;
}

const formatter = new Intl.NumberFormat("es", { maximumFractionDigits: 1 });

/** El ángulo como se enseña al girar: «37,5°». */
export function formatAngle(value: number): string {
  // Sin «-0°» cuando el redondeo deja un negativo diminuto.
  return `${formatter.format(Math.round(value * 10) / 10 + 0)}°`;
}
