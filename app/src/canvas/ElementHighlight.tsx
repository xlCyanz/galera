/**
 * Un recuadro sobre un elemento del lienzo, para señalarlo: por ejemplo, al
 * llegar a él desde un error.
 *
 * Usa la caja que midió Typst (`store/layout.ts`) cuando ya la hay, y si no,
 * la que declara el documento (ver `elements.ts`). En ese caso, si el alto lo
 * decide Typst (`h: null`), no se sabe dónde acaba: se marca solo el borde de
 * arriba y los laterales, abierto por abajo.
 */
import type { ElementBounds } from "./elements";
import { type CanvasTransform, rectToCanvas } from "./transform";

/** Alto del recuadro abierto cuando no se sabe el alto, en px. */
const OPEN_HEIGHT = 16;

export interface ElementHighlightProps {
  /** La caja sin girar, en mm, y el giro. */
  box: ElementBounds;
  /** Dónde está la página y a qué escala. */
  transform: CanvasTransform;
}

export function ElementHighlight({ box, transform }: ElementHighlightProps) {
  const open = box.h === null;
  const rect = rectToCanvas(transform, { x: box.x, y: box.y, w: box.w, h: box.h ?? 0 });
  const height = open ? OPEN_HEIGHT : rect.height;

  return (
    <div
      className={open ? "element-highlight is-open" : "element-highlight"}
      aria-hidden="true"
      style={{
        width: rect.width,
        height,
        transform: `translate(${rect.left}px, ${rect.top}px) rotate(${box.rotation}deg)`,
        // Como en Typst, se gira alrededor del centro de la caja.
        transformOrigin: open ? "center top" : "center",
      }}
    />
  );
}
