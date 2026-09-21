/**
 * Lo que está seleccionado dentro de un texto, pintado sobre el render.
 *
 * Los rectángulos salen de los glifos que compuso Typst
 * (`selection.ts`), uno por cada línea de las que él decidió: cubren las
 * letras, no el marco, así que el espacio por el que partió una línea no
 * aparece seleccionado. Se coloca como el cursor: sobre la caja sin girar
 * del elemento y girada alrededor de su centro.
 */
import type { CanvasTransform } from "../canvas/transform";
import { rectToCanvas } from "../canvas/transform";
import { useEditingStore } from "../store/editing";
import type { LayoutBox } from "../types/layout";
import { selectionRects } from "./selection";
import { onPage } from "./target";

export interface SelectionLayerProps {
  /** La caja del texto que se está escribiendo, la que midió Typst. */
  box: LayoutBox;
  /** Dónde está la página y a qué escala. */
  transform: CanvasTransform;
  /**
   * Qué página se está viendo, si el texto pasa por varias: de un flujo
   * solo se dibuja aquí lo que quedó en esta.
   */
  page?: number;
}

export function SelectionLayer({ box, transform, page }: SelectionLayerProps) {
  const all = useEditingStore((state) => state.glyphs);
  const glyphs = page === undefined ? all : onPage(all, page);
  const start = useEditingStore((state) => state.start);
  const end = useEditingStore((state) => state.end);

  const rects = selectionRects(glyphs, start, end);
  if (rects.length === 0) {
    return null;
  }

  const layer = rectToCanvas(transform, box);
  const scale = transform.pxPerMm;

  return (
    <div
      className="text-selection-layer"
      style={{
        width: layer.width,
        height: layer.height,
        transform: `translate(${layer.left}px, ${layer.top}px) rotate(${box.rotation}deg)`,
        transformOrigin: "center",
      }}
    >
      {rects.map((rect) => (
        <span
          key={`${rect.x}:${rect.y}`}
          className="text-selection"
          style={{
            left: (rect.x - box.x) * scale,
            top: (rect.y - box.y) * scale,
            width: rect.w * scale,
            height: rect.h * scale,
          }}
        />
      ))}
    </div>
  );
}
