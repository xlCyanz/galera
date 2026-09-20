/**
 * El aviso de que el contenido de un elemento no cabe en su caja.
 *
 * Con un alto fijo, lo que no cabe **no se recorta**: se dibuja fuera del
 * marco, también en el PDF, y quien edita puede no darse cuenta mirando el
 * lienzo. El núcleo lo mide al componer (`layout::LayoutBox::overflow`) y
 * aquí se enseña encima del elemento, con lo que sobra y un botón para
 * arreglarlo de una vez: quitar el alto fijo y dejar que lo mida Typst
 * (principio 3).
 *
 * El mismo aviso sale en el panel de problemas, con el resto de lo que dice
 * la compilación.
 */
import { applyOp } from "../commands";
import { useDocumentStore } from "../store/document";
import type { LayoutBox } from "../types/layout";
import { type CanvasTransform, rectToCanvas } from "./transform";

export interface OverflowNoticeProps {
  /** La caja del elemento que se sale, la que midió Typst. */
  box: LayoutBox;
  /** Dónde está la página y a qué escala. */
  transform: CanvasTransform;
}

export function OverflowNotice({ box, transform }: OverflowNoticeProps) {
  const rect = rectToCanvas(transform, box);

  return (
    <div
      className="overflow-notice"
      role="status"
      style={{ left: rect.left, top: rect.top + rect.height }}
      // Pulsar el aviso no es pulsar el lienzo.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span>No cabe por {millimetres(box.overflow)}</span>
      <button type="button" onClick={() => void fit(box)}>
        Ajustar el alto
      </button>
    </div>
  );
}

/** Lo que sobra, en milímetros. */
function millimetres(value: number): string {
  return `${value.toLocaleString("es", { maximumFractionDigits: 1 })} mm`;
}

/** Quita el alto fijo: a partir de ahí lo mide Typst y siempre cabe. */
async function fit(box: LayoutBox): Promise<void> {
  try {
    const applied = await applyOp({
      op: "resize",
      id: box.id,
      x: box.x,
      y: box.y,
      w: box.w,
      h: null,
    });
    useDocumentStore.getState().applyEdit(applied);
  } catch {
    // Si el núcleo no lo acepta, el elemento se queda como estaba.
  }
}
