/**
 * De milímetros del documento a píxeles del lienzo, y vuelta.
 *
 * **Es el único sitio donde se hace esta conversión.** La página, las
 * reglas, el resaltado y, más adelante, la selección y los manejadores
 * reciben un `CanvasTransform` y lo usan con estas funciones: así todo cae
 * exactamente encima del SVG de Typst.
 *
 * Los píxeles son CSS y relativos a la esquina superior izquierda del área
 * del lienzo. Los milímetros, relativos a la esquina superior izquierda de la
 * página, como en el documento.
 */
import type { Scroll } from "../store/document";
import type { MmRect } from "../types/layout";
import type { PageSize } from "../types/model";
import { PX_PER_MM, type PixelSize, pageSizeInPx } from "./geometry";
import { pageOrigin } from "./zoom";

/** Dónde está la página en el área y a qué escala. */
export interface CanvasTransform {
  /** La esquina superior izquierda de la página, en píxeles del área. */
  origin: { x: number; y: number };
  /** Píxeles CSS por milímetro: `PX_PER_MM × zoom`. */
  pxPerMm: number;
}

/** Un rectángulo en píxeles del área. */
export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * La transformación de una página de ese tamaño, centrada en el área y
 * movida `scroll` (ver `zoom.ts`).
 */
export function canvasTransform(
  viewport: PixelSize,
  page: PageSize,
  zoom: number,
  scroll: Scroll,
): CanvasTransform {
  return {
    origin: pageOrigin(viewport, pageSizeInPx(page, zoom), scroll),
    pxPerMm: PX_PER_MM * zoom,
  };
}

/** Un punto del documento, en mm, en píxeles del área. */
export function toCanvas(transform: CanvasTransform, x: number, y: number): { x: number; y: number } {
  return {
    x: transform.origin.x + x * transform.pxPerMm,
    y: transform.origin.y + y * transform.pxPerMm,
  };
}

/** Un punto del área, en píxeles, en mm del documento. */
export function toDocument(transform: CanvasTransform, x: number, y: number): { x: number; y: number } {
  return {
    x: (x - transform.origin.x) / transform.pxPerMm,
    y: (y - transform.origin.y) / transform.pxPerMm,
  };
}

/** Un rectángulo del documento, en mm, en píxeles del área. */
export function rectToCanvas(transform: CanvasTransform, rect: MmRect): PixelRect {
  const corner = toCanvas(transform, rect.x, rect.y);
  return {
    left: corner.x,
    top: corner.y,
    width: rect.w * transform.pxPerMm,
    height: rect.h * transform.pxPerMm,
  };
}
