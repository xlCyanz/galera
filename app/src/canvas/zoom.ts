/**
 * Cálculos de la vista del lienzo, sin DOM: dónde queda la página, niveles
 * de zoom, rueda, ajustar a la ventana y zoom hacia un punto.
 *
 * # La vista
 *
 * La página se coloca **centrada en el área** y movida `scroll` píxeles
 * desde ahí (`pageOrigin`). No se usa el desplazamiento nativo del
 * navegador: con él, una página más pequeña que el área no se puede mover, y
 * el zoom hacia el puntero dejaría de serlo justo al empezar a acercar.
 *
 * # Zoom hacia un punto
 *
 * El punto de la página que está bajo el puntero tiene que seguir bajo el
 * puntero: se calcula qué punto es con la vista actual y se elige el
 * desplazamiento nuevo que lo vuelve a poner ahí (`zoomAround`).
 *
 * Todas las coordenadas son píxeles CSS relativos a la esquina superior
 * izquierda del área.
 */
import { MAX_ZOOM, MIN_ZOOM, type Scroll, clampZoom } from "../store/document";
import type { PixelSize } from "./geometry";

/** Los niveles por los que pasan los atajos y botones de acercar y alejar. */
export const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8] as const;

/** Margen alrededor de la página al ajustarla a la ventana. */
export const FIT_MARGIN = 32;

/** Lo mínimo de la página que queda siempre dentro del área al desplazar. */
export const MIN_VISIBLE = 64;

/** Zoom y desplazamiento. */
export interface View {
  zoom: number;
  scroll: Scroll;
}

/** Un punto relativo al área. */
export interface Point {
  x: number;
  y: number;
}

/** El siguiente nivel de zoom hacia dentro o hacia fuera. */
export function nextZoomLevel(zoom: number, direction: "in" | "out"): number {
  // Un margen pequeño para que 0,999 cuente como 1 y no se quede en el sitio.
  const epsilon = 1e-3;
  if (direction === "in") {
    return ZOOM_LEVELS.find((level) => level > zoom + epsilon) ?? MAX_ZOOM;
  }
  return [...ZOOM_LEVELS].reverse().find((level) => level < zoom - epsilon) ?? MIN_ZOOM;
}

/** Píxeles por línea o por página cuando la rueda no cuenta en píxeles. */
function wheelPixels(delta: number, deltaMode: number, pageSize: number): number {
  if (deltaMode === 1) {
    return delta * 16;
  }
  if (deltaMode === 2) {
    return delta * pageSize;
  }
  return delta;
}

/** Cuánto zoom da cada píxel de rueda o de pinza. */
const WHEEL_SENSITIVITY = 0.01;

/**
 * El zoom tras un evento de rueda con Ctrl o ⌘, o de pinza en los webview
 * que la convierten en rueda con Ctrl.
 *
 * Es exponencial: la misma distancia de rueda multiplica el zoom por lo
 * mismo, así que acercar y alejar la misma cantidad vuelve al principio.
 */
export function wheelZoom(zoom: number, deltaY: number, deltaMode: number): number {
  return clampZoom(zoom * Math.exp(-wheelPixels(deltaY, deltaMode, 800) * WHEEL_SENSITIVITY));
}

/**
 * Cuánto desplazar con un evento de rueda sin Ctrl ni ⌘: la rueda del ratón
 * o dos dedos en el trackpad. Con Shift, una rueda vertical desplaza en
 * horizontal, como en el resto de aplicaciones.
 */
export function wheelPan(
  event: { deltaX: number; deltaY: number; deltaMode: number; shiftKey: boolean },
  viewport: PixelSize,
): Point {
  let x = wheelPixels(event.deltaX, event.deltaMode, viewport.width);
  let y = wheelPixels(event.deltaY, event.deltaMode, viewport.height);
  if (event.shiftKey && x === 0) {
    [x, y] = [y, 0];
  }
  return { x, y };
}

/**
 * El zoom con el que la página cabe entera en el espacio disponible.
 *
 * @param pageAt100 La página al 100 %, en píxeles CSS.
 */
export function fitZoom(pageAt100: PixelSize, available: PixelSize): number {
  if (pageAt100.width <= 0 || pageAt100.height <= 0) {
    return 1;
  }
  const zoom = Math.min(available.width / pageAt100.width, available.height / pageAt100.height);
  return clampZoom(zoom > 0 ? zoom : MIN_ZOOM);
}

/** La página ajustada al área, con margen, y centrada. */
export function fitView(pageAt100: PixelSize, viewport: PixelSize): View {
  return {
    zoom: fitZoom(pageAt100, {
      width: viewport.width - 2 * FIT_MARGIN,
      height: viewport.height - 2 * FIT_MARGIN,
    }),
    scroll: { x: 0, y: 0 },
  };
}

function scaled(size: PixelSize, zoom: number): PixelSize {
  return { width: size.width * zoom, height: size.height * zoom };
}

/** Dónde queda la esquina superior izquierda de la página en el área. */
export function pageOrigin(viewport: PixelSize, page: PixelSize, scroll: Scroll): Point {
  return {
    x: (viewport.width - page.width) / 2 + scroll.x,
    y: (viewport.height - page.height) / 2 + scroll.y,
  };
}

/**
 * Un desplazamiento que no deja la página fuera del área: siempre quedan a
 * la vista al menos `MIN_VISIBLE` píxeles de ella (o la página entera, si
 * es más pequeña).
 */
export function clampScroll(scroll: Scroll, viewport: PixelSize, page: PixelSize): Scroll {
  const axis = (value: number, area: number, size: number) => {
    if (area <= 0) {
      return value;
    }
    const keep = Math.min(MIN_VISIBLE, size);
    const centered = (area - size) / 2;
    const origin = Math.min(area - keep, Math.max(keep - size, centered + value));
    return origin - centered;
  };
  return {
    x: axis(scroll.x, viewport.width, page.width),
    y: axis(scroll.y, viewport.height, page.height),
  };
}

/** La vista tras desplazar la página `delta` píxeles. */
export function panBy(view: View, delta: Point, viewport: PixelSize, pageAt100: PixelSize): View {
  return {
    zoom: view.zoom,
    scroll: clampScroll(
      { x: view.scroll.x + delta.x, y: view.scroll.y + delta.y },
      viewport,
      scaled(pageAt100, view.zoom),
    ),
  };
}

/**
 * La vista con otro zoom, manteniendo bajo `point` el mismo punto de la
 * página.
 */
export function zoomAround(
  view: View,
  nextZoom: number,
  point: Point,
  viewport: PixelSize,
  pageAt100: PixelSize,
): View {
  const zoom = clampZoom(nextZoom);
  const origin = pageOrigin(viewport, scaled(pageAt100, view.zoom), view.scroll);
  // El punto de la página bajo `point`, en píxeles al 100 %.
  const at100 = { x: (point.x - origin.x) / view.zoom, y: (point.y - origin.y) / view.zoom };

  const page = scaled(pageAt100, zoom);
  const centered = pageOrigin(viewport, page, { x: 0, y: 0 });
  const scroll = {
    x: point.x - at100.x * zoom - centered.x,
    y: point.y - at100.y * zoom - centered.y,
  };
  return { zoom, scroll: clampScroll(scroll, viewport, page) };
}

/** Cómo se escribe un zoom: «100 %», con espacio fino como en español. */
export function formatZoom(zoom: number): string {
  return `${Math.round(zoom * 100)} %`;
}
