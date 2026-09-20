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
  code: <path d="M7 6l-4 4 4 4M13 6l4 4-4 4" />,
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
  code: TOOL_ICONS.code,
};

/** Los iconos de los controles de cada capa. */
export const LAYER_ICONS = {
  visible: (
    <>
      <path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" />
      <circle cx="10" cy="10" r="2.5" />
    </>
  ),
  hidden: (
    <>
      <path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" />
      <path d="M3 3l14 14" />
    </>
  ),
  locked: (
    <>
      <rect x="4.5" y="9" width="11" height="8" rx="1" />
      <path d="M7 9V6.5a3 3 0 016 0V9" />
    </>
  ),
  unlocked: (
    <>
      <rect x="4.5" y="9" width="11" height="8" rx="1" />
      <path d="M7 9V6.5a3 3 0 015.8-1" />
    </>
  ),
} satisfies Record<string, ReactNode>;
