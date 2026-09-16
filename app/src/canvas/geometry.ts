/**
 * Medidas del lienzo: de las unidades del documento a píxeles de pantalla.
 *
 * # La escala
 *
 * Al 100 % de zoom, **1 mm del documento mide `PX_PER_MM` píxeles CSS**:
 * 96/25,4 ≈ 3,78, la equivalencia de CSS entre pulgadas y píxeles. A otro
 * zoom se multiplica por él. Toda la capa de controles (selección, guías,
 * reglas) tiene que usar esta misma escala para caer encima del SVG.
 */
import type { PageSize, Unit } from "../types/model";

/** Píxeles CSS por pulgada, fijado por CSS. */
const PX_PER_INCH = 96;
/** Milímetros por pulgada. */
const MM_PER_INCH = 25.4;

/** Píxeles CSS que mide 1 mm del documento al 100 % de zoom. */
export const PX_PER_MM = PX_PER_INCH / MM_PER_INCH;

/**
 * Convierte una medida a milímetros.
 *
 * Mismos factores que `Unit::to_millimeters` en `galera-core`; una prueba
 * del backend comprueba que el SVG de Typst mide lo que dice el documento.
 */
export function toMillimeters(value: number, unit: Unit): number {
  switch (unit) {
    case "mm":
      return value;
    case "cm":
      return value * 10;
    case "in":
      return value * MM_PER_INCH;
    case "pt":
      return (value * MM_PER_INCH) / 72;
  }
}

/** Píxeles CSS que mide una distancia en milímetros con un zoom. */
export function mmToPx(mm: number, zoom: number): number {
  return mm * PX_PER_MM * zoom;
}

/** Un tamaño en píxeles CSS. */
export interface PixelSize {
  width: number;
  height: number;
}

/** Lo que mide una página en pantalla con un zoom. */
export function pageSizeInPx(size: PageSize, zoom: number): PixelSize {
  return {
    width: mmToPx(toMillimeters(size.width, size.unit), zoom),
    height: mmToPx(toMillimeters(size.height, size.unit), zoom),
  };
}
