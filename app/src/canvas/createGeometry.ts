/**
 * Las cuentas de crear una forma arrastrando, sin DOM: qué caja o qué línea
 * sale de un arrastre, el tamaño si solo se hace clic, el id nuevo y el
 * elemento con su estilo por defecto.
 *
 * Todo en milímetros de la página.
 */
import type { Document, Element } from "../types/model";
import { roundMm } from "./dragGeometry";

/** Las formas que se crean arrastrando. */
export type ShapeKind = "rect" | "ellipse" | "line";

export interface Point {
  x: number;
  y: number;
}

/** Lo que se dibuja: una caja o, para una línea, sus dos extremos. */
export type ShapeGeometry =
  | { kind: "rect" | "ellipse"; x: number; y: number; w: number; h: number }
  | { kind: "line"; x: number; y: number; x2: number; y2: number };

/** Píxeles que hay que mover el puntero para que sea un arrastre y no un clic. */
export const DRAG_THRESHOLD_PX = 3;

/** Tamaño de lo que se crea con un clic, en mm. */
export const DEFAULT_SIZE: Record<ShapeKind, { w: number; h: number }> = {
  rect: { w: 40, h: 30 },
  ellipse: { w: 30, h: 30 },
  line: { w: 40, h: 0 },
};

/** El estilo con el que nace cada forma. */
export const DEFAULT_FILL = "#cbd5e1";
export const DEFAULT_STROKE = { color: "#1f2733", width: 0.5 };

/** Lo más pequeño que puede salir de un arrastre, en mm. */
const MIN_SIZE_MM = 1;

/**
 * La forma que sale de arrastrar de `start` a `end`.
 *
 * - `constrain` (Shift): cuadrado o círculo; en una línea, ángulos de 45°.
 * - Una caja nunca mide menos de 1 mm por lado.
 */
export function shapeFromDrag(kind: ShapeKind, start: Point, end: Point, constrain: boolean): ShapeGeometry {
  let dx = end.x - start.x;
  let dy = end.y - start.y;

  if (kind === "line") {
    if (constrain) {
      const length = Math.hypot(dx, dy);
      const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      dx = length * Math.cos(angle);
      dy = length * Math.sin(angle);
    }
    return {
      kind,
      x: roundMm(start.x),
      y: roundMm(start.y),
      x2: roundMm(start.x + dx),
      y2: roundMm(start.y + dy),
    };
  }

  if (constrain) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = side * (dx < 0 ? -1 : 1);
    dy = side * (dy < 0 ? -1 : 1);
  }
  const w = Math.max(MIN_SIZE_MM, Math.abs(dx));
  const h = Math.max(MIN_SIZE_MM, Math.abs(dy));
  return {
    kind,
    // Hacia arriba o hacia la izquierda, la esquina es el punto final.
    x: roundMm(dx < 0 ? start.x - w : start.x),
    y: roundMm(dy < 0 ? start.y - h : start.y),
    w: roundMm(w),
    h: roundMm(h),
  };
}

/** Lo que se crea con un clic sin arrastrar: el tamaño por defecto desde el punto. */
export function defaultShape(kind: ShapeKind, at: Point): ShapeGeometry {
  const size = DEFAULT_SIZE[kind];
  return shapeFromDrag(kind, at, { x: at.x + size.w, y: at.y + size.h }, false);
}

/**
 * Un id que no usa nadie en el documento (ni elementos ni páginas):
 * `rect-1`, `rect-2`…, el primero libre.
 */
export function newElementId(document: Document, kind: string): string {
  const taken = new Set<string>();
  for (const page of document.pages) {
    taken.add(page.id);
    for (const element of page.elements) {
      taken.add(element.id);
    }
  }
  for (let n = 1; ; n += 1) {
    const id = `${kind}-${n}`;
    if (!taken.has(id)) {
      return id;
    }
  }
}

/** El elemento que se crea, con su estilo por defecto. */
export function shapeElement(id: string, shape: ShapeGeometry): Element {
  switch (shape.kind) {
    case "rect":
      return {
        type: "rect",
        id,
        x: shape.x,
        y: shape.y,
        w: shape.w,
        h: shape.h,
        rotation: 0,
        fill: DEFAULT_FILL,
        stroke: null,
        radius: 0,
      };
    case "ellipse":
      return { type: "ellipse", id, x: shape.x, y: shape.y, w: shape.w, h: shape.h, rotation: 0, fill: DEFAULT_FILL, stroke: null };
    case "line":
      return { type: "line", id, x: shape.x, y: shape.y, x2: shape.x2, y2: shape.y2, rotation: 0, stroke: { ...DEFAULT_STROKE } };
  }
}
