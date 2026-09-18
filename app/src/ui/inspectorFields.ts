/**
 * Qué enseña el inspector de un elemento y qué comando manda al editar cada
 * campo, sin DOM.
 *
 * Los valores salen del documento, que es la fuente de verdad, salvo el alto
 * que decide Typst (`h: null` en un texto o una imagen): ese es el que midió
 * el layout, y no se edita. Una línea se describe con la caja de sus
 * extremos; se puede mover y girar, pero su tamaño sale de los extremos y no
 * se edita aquí.
 *
 * Los comandos son los mismos que manda el lienzo al arrastrar: `move` para
 * X e Y, `resize` para ancho y alto y `rotate` para el giro.
 */
import { elementBounds } from "../canvas/elements";
import { roundMm } from "../canvas/dragGeometry";
import { MIN_SIZE_MM } from "../canvas/resizeGeometry";
import { normalizeDegrees, roundDegrees } from "../canvas/rotateGeometry";
import type { LayoutBox } from "../types/layout";
import type { Element } from "../types/model";
import type { Op } from "../types/ops";

export type FieldName = "x" | "y" | "w" | "h" | "rotation";

export interface Field {
  /** El valor, en mm o en grados. `null` si todavía no se sabe (alto automático sin compilar). */
  value: number | null;
  /** Si se puede editar. */
  editable: boolean;
  /** Si el valor lo decide Typst al componer. */
  auto: boolean;
}

export type Fields = Record<FieldName, Field>;

/**
 * Los cinco campos de un elemento.
 *
 * @param measured La caja que midió Typst, si ya ha llegado.
 */
export function inspectorFields(element: Element, measured: LayoutBox | null): Fields {
  const bounds = elementBounds(element);
  const line = element.type === "line";
  const auto = !line && bounds.h === null;
  const editable = (value: number | null): Field => ({ value, editable: true, auto: false });
  return {
    x: editable(bounds.x),
    y: editable(bounds.y),
    w: { value: bounds.w, editable: !line, auto: false },
    h: auto
      ? { value: measured?.h ?? null, editable: false, auto: true }
      : { value: bounds.h, editable: !line, auto: false },
    rotation: editable(bounds.rotation),
  };
}

/**
 * El comando que deja el campo `field` de `element` en `value`, o `null` si
 * no hay nada que cambiar (o el campo no se edita).
 */
export function fieldOp(element: Element, field: FieldName, value: number): Op | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  const bounds = elementBounds(element);
  const id = element.id;

  switch (field) {
    case "x":
    case "y": {
      const delta = roundMm(value - bounds[field]);
      if (delta === 0) {
        return null;
      }
      return field === "x" ? { op: "move", id, dx: delta, dy: 0 } : { op: "move", id, dx: 0, dy: delta };
    }
    case "w":
    case "h": {
      if (element.type === "line" || (field === "h" && element.h === null)) {
        return null;
      }
      const size = roundMm(Math.max(MIN_SIZE_MM, value));
      const w = field === "w" ? size : element.w;
      const h = field === "h" ? size : element.h;
      if (w === element.w && h === element.h) {
        return null;
      }
      return { op: "resize", id, x: element.x, y: element.y, w, h };
    }
    case "rotation": {
      const raw = roundDegrees(normalizeDegrees(value));
      // Redondear -179,9996 da -180, que ya es 180.
      const rotation = raw === -180 ? 180 : raw;
      if (rotation === normalizeDegrees(bounds.rotation)) {
        return null;
      }
      return { op: "rotate", id, rotation };
    }
  }
}
