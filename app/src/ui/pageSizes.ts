/**
 * Los tamaños de página con nombre, y las cuentas para cambiar de uno a
 * otro desde el inspector.
 *
 * Un tamaño se guarda en el documento como ancho, alto y unidad. Aquí se
 * reconoce a qué papel corresponde —en vertical o en horizontal— y se
 * construye el tamaño nuevo cuando se elige otro papel, se gira la página o
 * se escribe una medida. Lo que se escribe a mano va siempre en milímetros,
 * que es la unidad de trabajo de Galera.
 */
import { toMillimeters } from "../canvas/geometry";
import type { PageSize } from "../types/model";

/** Un papel con nombre, en vertical y en milímetros. */
export interface Paper {
  id: string;
  name: string;
  width: number;
  height: number;
}

/** Los papeles que se ofrecen, de los más usados a los menos. */
export const PAPERS: readonly Paper[] = [
  { id: "a4", name: "A4", width: 210, height: 297 },
  { id: "a5", name: "A5", width: 148, height: 210 },
  { id: "a3", name: "A3", width: 297, height: 420 },
  { id: "a6", name: "A6", width: 105, height: 148 },
  { id: "b5", name: "B5", width: 176, height: 250 },
  { id: "letter", name: "Carta", width: 215.9, height: 279.4 },
  { id: "legal", name: "Legal", width: 215.9, height: 355.6 },
  { id: "tabloid", name: "Tabloide", width: 279.4, height: 431.8 },
];

export type Orientation = "portrait" | "landscape";

/**
 * Cuánto pueden diferir dos medidas para ser el mismo papel. Un documento
 * en pulgadas pasado a milímetros no da justo 215,9, y medio milímetro no
 * lo ve nadie.
 */
const TOLERANCE_MM = 0.5;

/** Un tamaño, entendido: sus medidas en mm, su papel y su orientación. */
export interface SizeInfo {
  width: number;
  height: number;
  /** El papel, o `null` si no es ninguno de los que se ofrecen. */
  paper: Paper | null;
  /** Una página cuadrada cuenta como vertical. */
  orientation: Orientation;
}

/** Qué es un tamaño de página: medidas en mm, papel y orientación. */
export function describeSize(size: PageSize): SizeInfo {
  const width = toMillimeters(size.width, size.unit);
  const height = toMillimeters(size.height, size.unit);
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  const paper =
    PAPERS.find(
      (candidate) =>
        Math.abs(candidate.width - short) <= TOLERANCE_MM && Math.abs(candidate.height - long) <= TOLERANCE_MM,
    ) ?? null;
  return { width, height, paper, orientation: width > height ? "landscape" : "portrait" };
}

/** Un papel en la orientación que se pida. */
export function paperSize(paper: Paper, orientation: Orientation): PageSize {
  return orientation === "portrait"
    ? { width: paper.width, height: paper.height, unit: "mm" }
    : { width: paper.height, height: paper.width, unit: "mm" };
}

/**
 * El mismo tamaño girado a la orientación que se pida, con su unidad. Si
 * ya lo estaba, `null`: no hay nada que cambiar.
 */
export function withOrientation(size: PageSize, orientation: Orientation): PageSize | null {
  if (describeSize(size).orientation === orientation || size.width === size.height) {
    return null;
  }
  return { width: size.height, height: size.width, unit: size.unit };
}

/** El tamaño con una de sus medidas cambiada, todo en milímetros. */
export function withMeasure(size: PageSize, which: "width" | "height", millimeters: number): PageSize {
  const { width, height } = describeSize(size);
  return which === "width"
    ? { width: millimeters, height, unit: "mm" }
    : { width, height: millimeters, unit: "mm" };
}
