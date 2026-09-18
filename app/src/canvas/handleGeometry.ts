/**
 * Los manejadores del elemento seleccionado, sin DOM: cuáles hay, dónde van
 * y qué cursor lleva cada uno.
 */

/** Los ocho manejadores de redimensionado, por la dirección hacia la que tiran. */
export const RESIZE_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type ResizeHandle = (typeof RESIZE_HANDLES)[number];

/** Lado de cada manejador en pantalla, en píxeles CSS. No cambia con el zoom. */
export const HANDLE_SIZE = 8;

/** Distancia del manejador de rotación al borde superior, en píxeles CSS. */
export const ROTATE_HANDLE_OFFSET = 24;

/** Dónde va cada manejador, como fracción del ancho y del alto de la caja. */
export const HANDLE_POSITION: Record<ResizeHandle, { x: number; y: number }> = {
  nw: { x: 0, y: 0 },
  n: { x: 0.5, y: 0 },
  ne: { x: 1, y: 0 },
  e: { x: 1, y: 0.5 },
  se: { x: 1, y: 1 },
  s: { x: 0.5, y: 1 },
  sw: { x: 0, y: 1 },
  w: { x: 0, y: 0.5 },
};

/** Hacia dónde tira cada manejador, en grados desde arriba y en sentido horario. */
const HANDLE_ANGLE: Record<ResizeHandle, number> = {
  n: 0,
  ne: 45,
  e: 90,
  se: 135,
  s: 180,
  sw: 225,
  w: 270,
  nw: 315,
};

/** Los cuatro cursores de redimensionado de CSS, cada 45°. */
const CURSORS = ["ns-resize", "nesw-resize", "ew-resize", "nwse-resize"] as const;
export type ResizeCursor = (typeof CURSORS)[number];

/**
 * El cursor de un manejador con el elemento girado `rotation` grados en
 * sentido horario: el de la dirección en la que tira de verdad en pantalla,
 * redondeada al múltiplo de 45° más cercano.
 */
export function resizeCursor(handle: ResizeHandle, rotation: number): ResizeCursor {
  const angle = HANDLE_ANGLE[handle] + rotation;
  const step = Math.round(angle / 45);
  // Opuestos comparten cursor: el paso se toma módulo 4.
  return CURSORS[((step % 4) + 4) % 4] ?? "ns-resize";
}
