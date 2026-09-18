/**
 * Un recuadro sobre un elemento del lienzo, para señalarlo: por ejemplo, al
 * llegar a él desde un error.
 *
 * Usa la caja que declara el documento (ver `elements.ts`). Si el alto lo
 * decide Typst (`h: null`), no se sabe dónde acaba: se marca solo el borde
 * de arriba y los laterales, abierto por abajo. Con el layout de la Fase 2
 * se podrá recuadrar lo que de verdad ocupa.
 */
import type { ElementBounds } from "./elements";
import type { Point } from "./zoom";

/** Alto del recuadro abierto cuando no se sabe el alto, en px. */
const OPEN_HEIGHT = 16;

export interface ElementHighlightProps {
  box: ElementBounds;
  /** La esquina de la página en el área. */
  origin: Point;
  /** Píxeles CSS por milímetro. */
  pxPerMm: number;
}

export function ElementHighlight({ box, origin, pxPerMm }: ElementHighlightProps) {
  const open = box.h === null;
  const width = box.w * pxPerMm;
  const height = open ? OPEN_HEIGHT : (box.h ?? 0) * pxPerMm;

  return (
    <div
      className={open ? "element-highlight is-open" : "element-highlight"}
      aria-hidden="true"
      style={{
        width,
        height,
        transform: `translate(${origin.x + box.x * pxPerMm}px, ${origin.y + box.y * pxPerMm}px) rotate(${box.rotation}deg)`,
        // Como en Typst, se gira alrededor del centro de la caja.
        transformOrigin: open ? "center top" : "center",
      }}
    />
  );
}
