/**
 * El comando que cambia el estilo de un texto desde el inspector, sin DOM.
 *
 * Todo el estilo va junto (`SetProperty` de `style`): se parte del de ahora
 * y se cambia lo pedido, con los límites de cada campo.
 */
import type { Element, TextStyle } from "../types/model";
import type { Op } from "../types/ops";

/** El espacio entre párrafos de Typst si el estilo no dice otro (`DEFAULT_PARAGRAPH_SPACING` del núcleo). */
export const DEFAULT_PARAGRAPH_SPACING = 1.2;

/** El tamaño más pequeño que se admite, en puntos. */
export const MIN_TEXT_SIZE = 1;

/** Lo que se cambia del estilo; `spacing: null` vuelve al de Typst. */
export type TextStyleChange = Partial<Omit<TextStyle, "spacing">> & { spacing?: number | null };

/** Redondea a la centésima: sin ruido de coma flotante en el documento. */
function round(value: number): number {
  return Math.round(value * 100) / 100 + 0;
}

/**
 * El estilo nuevo de `element` con `change`, o `null` si no es un texto o
 * no cambia nada.
 */
export function textStyleOp(element: Element, change: TextStyleChange): Op | null {
  if (element.type !== "text") {
    return null;
  }
  const current = element.style;
  const next: TextStyle = { ...current };
  if (change.font !== undefined) next.font = change.font;
  if (change.color !== undefined) next.color = change.color;
  if (change.align !== undefined) next.align = change.align;
  if (change.size !== undefined && Number.isFinite(change.size)) next.size = round(Math.max(MIN_TEXT_SIZE, change.size));
  if (change.leading !== undefined && Number.isFinite(change.leading)) next.leading = round(Math.max(0, change.leading));
  if (change.spacing === null) {
    delete next.spacing;
  } else if (change.spacing !== undefined && Number.isFinite(change.spacing)) {
    next.spacing = round(Math.max(0, change.spacing));
  }
  if (JSON.stringify(next) === JSON.stringify(current)) {
    return null;
  }
  return { op: "set_property", id: element.id, property: { name: "style", value: next } };
}
