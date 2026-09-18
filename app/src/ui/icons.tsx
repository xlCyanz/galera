/**
 * Los iconos de la interfaz, de 20 × 20, dibujados con el color del texto.
 * Van dentro de un `<svg viewBox="0 0 20 20">` con trazo `currentColor`
 * (ver `.tool-button svg` y `.layer-icon` en `styles.css`).
 */
import type { ReactNode } from "react";

import type { Element } from "../types/model";
import type { Tool } from "./tools";

/** El icono de cada herramienta del riel. */
export const TOOL_ICONS: Record<Tool, ReactNode> = {
  select: <path d="M5 3l10 7-4.5 1L13 16l-2 1-2.5-5L5 15z" fill="currentColor" />,
  text: <path d="M4 4h12M10 4v12M7 16h6" />,
  rect: <rect x="3.5" y="5.5" width="13" height="9" rx="0.5" />,
  ellipse: <ellipse cx="10" cy="10" rx="6.5" ry="5" />,
  line: <path d="M4 16L16 4" />,
  image: (
    <>
      <rect x="3.5" y="4.5" width="13" height="11" rx="0.5" />
      <path d="M4 14l4-4 3 3 2-2 3 3" />
      <circle cx="13" cy="8" r="1.2" />
    </>
  ),
  hand: (
    <path d="M7 10V5.5a1 1 0 012 0V9m0-4.5V4a1 1 0 012 0v5m0-4a1 1 0 012 0v5m0-3a1 1 0 012 0v5c0 3-2 5-5 5h-1c-2 0-3-1-4-2.5L4.5 12a1 1 0 011.6-1.2L7 12" />
  ),
};

/** El icono de cada tipo de elemento: el de la herramienta que lo crea. */
export const ELEMENT_ICONS: Record<Element["type"], ReactNode> = {
  text: TOOL_ICONS.text,
  rect: TOOL_ICONS.rect,
  ellipse: TOOL_ICONS.ellipse,
  line: TOOL_ICONS.line,
  image: TOOL_ICONS.image,
  code: <path d="M7 6l-4 4 4 4M13 6l4 4-4 4" />,
};
