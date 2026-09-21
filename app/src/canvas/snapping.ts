/**
 * El ajuste a las guías, sin DOM: qué se le pide al núcleo y cómo se lee lo
 * que contesta.
 *
 * El cálculo no está aquí: vive en `galera_core::snap` (principio 5). Esto
 * solo traduce lo que hace el gesto —arrastrar, o tirar de un manejador— a
 * lo que el núcleo necesita saber, y lo que contesta a píxeles de pantalla.
 */
import type { MmRect } from "../types/layout";
import type { Grip, Grips, Guide, Settings, Snapped } from "../types/snap";
import type { ResizeHandle } from "./handleGeometry";
import { type CanvasTransform, toCanvas } from "./transform";

/**
 * A cuántos píxeles de pantalla engancha. El mismo número que `SNAP_PX` del
 * núcleo: en píxeles, para que enganchar cueste lo mismo a cualquier zoom.
 */
export const SNAP_PX = 6;

/** Los ajustes de este lienzo, con su zoom. */
export function snapSettings(pxPerMm: number): Settings {
  return { threshold: SNAP_PX, scale: pxPerMm, margin: null };
}

/**
 * Si el gesto lleva la tecla que desactiva el ajuste mientras dure.
 *
 * Es ⌘, como en el resto de editores: Shift ya fija el eje al mover y la
 * proporción al redimensionar, y Alt redimensiona desde el centro.
 */
export function snapOff(event: { metaKey: boolean }): boolean {
  return event.metaKey;
}

/** Lo que se agarra al arrastrar: la caja entera en los dos ejes. */
export const WHOLE: Grips = { x: "whole", y: "whole" };

/**
 * Lo que se agarra al tirar de un manejador: el borde o los bordes que
 * mueve, y nada en el eje que no toca.
 */
export function gripsFor(handle: ResizeHandle): Grips {
  const x: Grip = handle.includes("w") ? "start" : handle.includes("e") ? "end" : "none";
  const y: Grip = handle.includes("n") ? "start" : handle.includes("s") ? "end" : "none";
  return { x, y };
}

/** Si dos cajas son exactamente la misma. */
export function sameRect(one: MmRect, another: MmRect): boolean {
  return one.x === another.x && one.y === another.y && one.w === another.w && one.h === another.h;
}

/** Si un ajuste no mueve nada: enseñarlo no cambiaría el elemento de sitio. */
export function isStill(snapped: Snapped): boolean {
  return snapped.dx === 0 && snapped.dy === 0;
}

/** Los dos extremos de una guía, en píxeles del área. */
export function guideInPx(
  transform: CanvasTransform,
  guide: Guide,
): { x1: number; y1: number; x2: number; y2: number } {
  const from = toCanvas(transform, guide.line.x1, guide.line.y1);
  const to = toCanvas(transform, guide.line.x2, guide.line.y2);
  return { x1: from.x, y1: from.y, x2: to.x, y2: to.y };
}

/** Lo que mide una guía de espaciado, en mm. */
export function guideLength(guide: Guide): number {
  const { x1, y1, x2, y2 } = guide.line;
  return Math.hypot(x2 - x1, y2 - y1);
}

/** Una distancia en milímetros, como se enseña al lado de una guía. */
export function formatDistance(mm: number): string {
  return `${mm.toLocaleString("es", { maximumFractionDigits: 1 })} mm`;
}
