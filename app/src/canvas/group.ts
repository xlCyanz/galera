/**
 * La selección de varios elementos, sin DOM: la caja que los contiene y el
 * comando que los mueve a todos.
 *
 * Repartir un estirón entre los elementos es cosa del núcleo
 * (`galera_core::ops::group`, principio 5); aquí solo está lo que el lienzo
 * necesita para dibujar: qué caja enseñar y qué elementos hay dentro.
 */
import type { LayoutBox, MmRect } from "../types/layout";
import type { Op } from "../types/ops";

/**
 * La caja que contiene a todas, ya girada (se usa `bounds`), o `null` si no
 * hay ninguna.
 *
 * Es la caja conjunta que enseña el lienzo con varios elementos
 * seleccionados: la que se agarra para moverlos y estirarlos a todos.
 */
export function groupBox(boxes: readonly LayoutBox[]): MmRect | null {
  if (boxes.length === 0) {
    return null;
  }
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { bounds } of boxes) {
    left = Math.min(left, bounds.x);
    top = Math.min(top, bounds.y);
    right = Math.max(right, bounds.x + bounds.w);
    bottom = Math.max(bottom, bounds.y + bounds.h);
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Las cajas de esos elementos que estén en la página, en su mismo orden. */
export function boxesOf(
  boxes: Readonly<Record<string, LayoutBox>>,
  ids: readonly string[],
  page: number,
): LayoutBox[] {
  return ids
    .map((id) => boxes[id])
    .filter((box): box is LayoutBox => box !== undefined && box.page === page);
}

/**
 * El comando que mueve todos esos elementos `dx`, `dy` milímetros.
 *
 * Con varios es un `batch`: un único cambio del documento, una sola
 * compilación y un solo paso del historial.
 */
export function moveOp(ids: readonly string[], dx: number, dy: number): Op {
  const moves: Op[] = ids.map((id) => ({ op: "move", id, dx, dy }));
  return moves.length === 1 && moves[0] !== undefined ? moves[0] : { op: "batch", ops: moves };
}
