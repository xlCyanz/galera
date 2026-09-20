/**
 * Las cuentas de crear una forma o un texto arrastrando, sin DOM: qué caja,
 * qué línea o qué ancho sale de un arrastre, el tamaño si solo se hace clic,
 * el id nuevo y el elemento con su estilo por defecto.
 *
 * Todo en milímetros de la página.
 */
import type { Document, Element, TextStyle } from "../types/model";
import { roundMm } from "./dragGeometry";

/** Lo que se crea arrastrando. */
export type ShapeKind = "rect" | "ellipse" | "line" | "text" | "code";

export interface Point {
  x: number;
  y: number;
}

/** Lo que se dibuja: una caja o, para una línea, sus dos extremos. */
export type ShapeGeometry =
  | { kind: "rect" | "ellipse" | "code"; x: number; y: number; w: number; h: number }
  | { kind: "line"; x: number; y: number; x2: number; y2: number }
  /** Un texto: solo su ancho; el alto lo decide Typst (`h: null`). */
  | { kind: "text"; x: number; y: number; w: number };

/** Píxeles que hay que mover el puntero para que sea un arrastre y no un clic. */
export const DRAG_THRESHOLD_PX = 3;

/** Tamaño de lo que se crea con un clic, en mm. */
export const DEFAULT_SIZE: Record<ShapeKind, { w: number; h: number }> = {
  rect: { w: 40, h: 30 },
  ellipse: { w: 30, h: 30 },
  line: { w: 40, h: 0 },
  text: { w: 60, h: 0 },
  code: { w: 80, h: 40 },
};

/**
 * El código con el que nace un bloque: un marco gris que se ve en la página
 * y no necesita ninguna fuente, para que compile aunque el proyecto todavía
 * no tenga ninguna.
 */
export const PLACEHOLDER_CODE = "#rect(width: 100%, height: 100%, stroke: (paint: gray, thickness: 0.2mm))";

/** El alto con que se enseña un texto mientras se crea, en mm: una línea. */
export const TEXT_PREVIEW_HEIGHT_MM = 6;

/** Lo más estrecho que puede salir un texto, en mm. */
export const MIN_TEXT_WIDTH_MM = 10;

/** El texto de relleno de un texto nuevo. Editarlo llega con la Fase 4. */
export const PLACEHOLDER_TEXT = "Texto";

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

  if (kind === "text") {
    // Solo cuenta el ancho: el texto empieza a la altura donde se pulsó.
    const w = Math.max(MIN_TEXT_WIDTH_MM, Math.abs(dx));
    return { kind, x: roundMm(dx < 0 ? start.x - w : start.x), y: roundMm(start.y), w: roundMm(w) };
  }

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

/**
 * El elemento que se crea, con su estilo por defecto.
 *
 * @param textStyle El estilo de un texto nuevo, que decide el núcleo según
 *   las fuentes del proyecto. Solo hace falta para un texto.
 */
export function shapeElement(id: string, shape: ShapeGeometry, textStyle?: TextStyle): Element {
  switch (shape.kind) {
    case "text":
      if (textStyle === undefined) {
        throw new Error("un texto necesita un estilo");
      }
      return {
        type: "text",
        id,
        x: shape.x,
        y: shape.y,
        w: shape.w,
        h: null,
        rotation: 0,
        content: [{ text: PLACEHOLDER_TEXT, bold: false, italic: false, underline: false }],
        style: { ...textStyle },
      };
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
    case "code":
      return {
        type: "code",
        id,
        x: shape.x,
        y: shape.y,
        w: shape.w,
        h: shape.h,
        rotation: 0,
        source: PLACEHOLDER_CODE,
      };
    case "line":
      return { type: "line", id, x: shape.x, y: shape.y, x2: shape.x2, y2: shape.y2, rotation: 0, stroke: { ...DEFAULT_STROKE } };
  }
}
