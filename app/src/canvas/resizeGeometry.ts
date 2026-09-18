/**
 * Cálculos del redimensionado, sin DOM.
 *
 * Se trabaja en los ejes del elemento: el movimiento del puntero, que llega
 * en mm de la página, se gira al revés que el elemento. Así un elemento
 * girado se estira a lo largo de sus propios lados.
 *
 * Luego se recoloca la caja para que **lo que tiene que quedarse quieto se
 * quede quieto en la página**: el lado o la esquina opuestos al manejador
 * (o el centro, con Alt). Un elemento gira alrededor de su centro; si cambia
 * de tamaño, su centro se mueve, y hay que compensarlo para que el ancla no
 * se desplace.
 */
import type { ResizeHandle } from "./handleGeometry";

/** Tamaño mínimo de un lado, en mm: nunca cero ni negativo. */
export const MIN_SIZE_MM = 1;

/** Una caja sin girar, en mm, y su giro. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

export interface ResizeOptions {
  /** Shift: mantener la proporción. */
  keepRatio: boolean;
  /** Alt: redimensionar desde el centro. */
  fromCenter: boolean;
}

/** Qué lados mueve cada manejador: -1 el izquierdo o el de arriba, 1 el otro. */
const PULLS: Record<ResizeHandle, { x: -1 | 0 | 1; y: -1 | 0 | 1 }> = {
  nw: { x: -1, y: -1 },
  n: { x: 0, y: -1 },
  ne: { x: 1, y: -1 },
  e: { x: 1, y: 0 },
  se: { x: 1, y: 1 },
  s: { x: 0, y: 1 },
  sw: { x: -1, y: 1 },
  w: { x: -1, y: 0 },
};

/** Si el manejador cambia el alto (todos menos los laterales). */
export function changesHeight(handle: ResizeHandle): boolean {
  return PULLS[handle].y !== 0;
}

/** Gira un vector `angle` grados en sentido horario (eje y hacia abajo). */
function rotate(x: number, y: number, angle: number): { x: number; y: number } {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

/**
 * La caja nueva al arrastrar `handle` desde `start` un desplazamiento
 * `(dx, dy)` en mm de la página.
 */
export function resizeBox(
  start: Box,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  options: ResizeOptions,
): Box {
  const pull = PULLS[handle];
  const local = rotate(dx, dy, -start.rotation);
  const factor = options.fromCenter ? 2 : 1;

  // Ancho y alto nuevos, en los ejes del elemento.
  let w = start.w + pull.x * local.x * factor;
  let h = start.h + pull.y * local.y * factor;

  if (options.keepRatio && start.w > 0 && start.h > 0) {
    const ratio = start.w / start.h;
    if (pull.x !== 0 && pull.y !== 0) {
      // Esquina: manda el lado que más ha cambiado.
      const scale = Math.abs(w / start.w - 1) >= Math.abs(h / start.h - 1) ? w / start.w : h / start.h;
      w = start.w * scale;
      h = start.h * scale;
    } else if (pull.x !== 0) {
      h = w / ratio;
    } else {
      w = h * ratio;
    }
  }

  w = Math.max(MIN_SIZE_MM, w);
  h = Math.max(MIN_SIZE_MM, h);

  // Dónde queda el centro nuevo respecto al viejo, en los ejes del
  // elemento: con Alt no se mueve; si no, se aleja del ancla lo que ha
  // crecido cada lado, la mitad.
  const shift = options.fromCenter
    ? { x: 0, y: 0 }
    : {
        x: (pull.x === 0 ? 0 : pull.x) * ((w - start.w) / 2),
        y: (pull.y === 0 ? 0 : pull.y) * ((h - start.h) / 2),
      };
  const moved = rotate(shift.x, shift.y, start.rotation);
  const centerX = start.x + start.w / 2 + moved.x;
  const centerY = start.y + start.h / 2 + moved.y;

  return { x: centerX - w / 2, y: centerY - h / 2, w, h, rotation: start.rotation };
}

/** Las medidas para enseñar durante el arrastre: «80 × 40 mm». */
export function formatSize(w: number, h: number): string {
  const mm = (value: number) => value.toLocaleString("es", { maximumFractionDigits: 1 });
  return `${mm(w)} × ${mm(h)} mm`;
}
