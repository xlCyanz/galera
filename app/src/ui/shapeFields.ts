/**
 * Qué enseña el inspector de formas y qué comandos manda, sin DOM.
 *
 * Trabaja con una **lista** de elementos: hoy la selección es de uno, pero
 * con la multiselección (F5-03) el mismo panel enseñará los valores
 * comunes y marcará como `MIXED` los que no coinciden. Editar un valor lo
 * cambia en todos los elementos a los que se aplica.
 */
import type { Dash, Element, Stroke } from "../types/model";
import type { Op } from "../types/ops";
import { roundMm } from "../canvas/dragGeometry";

/** Un valor que no es el mismo en todos los elementos. */
export const MIXED = Symbol("mixto");
export type Mixed = typeof MIXED;

/** El valor común de una lista, o `MIXED` si hay varios. `undefined` si está vacía. */
function common<T>(values: readonly T[], same: (a: T, b: T) => boolean = Object.is): T | Mixed | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const [first, ...rest] = values as [T, ...T[]];
  return rest.every((value) => same(first, value)) ? first : MIXED;
}

/** Las formas de la lista: rectángulos, elipses y líneas. */
type Shape = Extract<Element, { type: "rect" | "ellipse" | "line" }>;

export function isShape(element: Element): element is Shape {
  return element.type === "rect" || element.type === "ellipse" || element.type === "line";
}

export interface ShapeFields {
  /** Si alguna admite relleno (no las líneas). */
  hasFill: boolean;
  /** Si alguna es un rectángulo (el radio). */
  hasRadius: boolean;
  /** Si todas son líneas: el trazo no se puede quitar. */
  onlyLines: boolean;
  /** El relleno: un color, `null` (sin relleno) o mixto. */
  fill: string | null | Mixed | undefined;
  /** Si hay borde: `true`, `false` o mixto. */
  stroked: boolean | Mixed | undefined;
  strokeColor: string | Mixed | undefined;
  strokeWidth: number | Mixed | undefined;
  /** El estilo del trazo; `null` es continuo. */
  dash: Dash | null | Mixed | undefined;
  radius: number | Mixed | undefined;
}

/** Los campos del inspector de formas para `elements` (las que no son formas se ignoran). */
export function shapeFields(elements: readonly Element[]): ShapeFields {
  const shapes = elements.filter(isShape);
  const filled = shapes.filter((shape) => shape.type !== "line");
  const strokes = shapes.map((shape) => shape.stroke).filter((stroke): stroke is Stroke => stroke !== null);
  const rects = shapes.filter((shape) => shape.type === "rect");
  return {
    hasFill: filled.length > 0,
    hasRadius: rects.length > 0,
    onlyLines: shapes.length > 0 && filled.length === 0,
    fill: common(filled.map((shape) => shape.fill)),
    stroked: common(shapes.map((shape) => shape.stroke !== null)),
    strokeColor: common(strokes.map((stroke) => stroke.color.toLowerCase())),
    strokeWidth: common(strokes.map((stroke) => stroke.width)),
    dash: common(strokes.map((stroke) => stroke.dash ?? null)),
    radius: common(rects.map((rect) => rect.radius)),
  };
}

/** El trazo con el que nace un borde que se activa. */
export const DEFAULT_BORDER: Stroke = { color: "#1f2733", width: 0.5 };

/** Cambia el relleno de todas las que lo admiten. */
export function fillOps(elements: readonly Element[], fill: string | null): Op[] {
  return elements
    .filter(isShape)
    .filter((shape) => shape.type !== "line" && shape.fill !== fill)
    .map((shape) => ({ op: "set_property", id: shape.id, property: { name: "fill", value: fill } }));
}

/**
 * Cambia el trazo de todas: `null` lo quita (salvo en las líneas, que
 * siempre tienen), y un cambio parcial se aplica sobre el trazo de cada una
 * (o sobre `DEFAULT_BORDER` si no tenía).
 */
/** Lo que se cambia de un trazo; `dash: null` lo deja continuo. */
export interface StrokeChange {
  color?: string;
  width?: number;
  dash?: Dash | null;
}

export function strokeOps(elements: readonly Element[], change: StrokeChange | null): Op[] {
  const ops: Op[] = [];
  for (const shape of elements.filter(isShape)) {
    let next: Stroke | null;
    if (change === null) {
      if (shape.type === "line" || shape.stroke === null) {
        continue;
      }
      next = null;
    } else {
      const base = shape.stroke ?? DEFAULT_BORDER;
      const dash = change.dash === undefined ? base.dash : change.dash;
      next = {
        color: change.color ?? base.color,
        width: roundMm(Math.max(0, change.width ?? base.width)),
        ...(dash === null || dash === undefined ? {} : { dash }),
      };
    }
    if (JSON.stringify(next) !== JSON.stringify(shape.stroke)) {
      ops.push({ op: "set_property", id: shape.id, property: { name: "stroke", value: next } });
    }
  }
  return ops;
}

/** Cambia el radio de todos los rectángulos; nunca negativo. */
export function radiusOps(elements: readonly Element[], radius: number): Op[] {
  const value = roundMm(Math.max(0, radius));
  return elements
    .filter(isShape)
    .filter((shape) => shape.type === "rect" && shape.radius !== value)
    .map((shape) => ({ op: "set_property", id: shape.id, property: { name: "radius", value } }));
}
