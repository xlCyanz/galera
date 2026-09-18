/**
 * El panel de capas: los elementos de la página que se ve, la capa de
 * arriba primero (`layerOrder.ts`).
 *
 * - La selección es la misma que la del lienzo: pulsar una fila selecciona
 *   el elemento, y seleccionarlo en el lienzo marca su fila (y la trae a la
 *   vista si hace falta).
 * - Arrastrar una fila en vertical la cambia de capa: una línea marca dónde
 *   caerá, y al soltar se manda un único `Op::Reorder`, que recompila y se
 *   deshace con ⌘Z. Esc cancela el arrastre.
 *
 * El arrastre va con eventos de puntero, no con el arrastrar y soltar de
 * HTML: Tauri usa este último para recibir archivos del sistema.
 */
import { type PointerEvent, useEffect, useRef, useState } from "react";

import { applyOp } from "../commands";
import { useCurrentPage, useDocumentStore, useOpenDocument, useSelectedElement } from "../store/document";
import { ELEMENT_ICONS } from "./icons";
import { gapAt, layerRows, reorderIndex } from "./layerOrder";

/** Píxeles que hay que mover una fila para que sea un arrastre y no un clic. */
const DRAG_THRESHOLD_PX = 3;

interface RowDrag {
  id: string;
  /** Su posición en el arreglo. */
  from: number;
  startY: number;
  moved: boolean;
  /** La hendidura donde caería, contando desde arriba. */
  gap: number;
}

export function LayersPanel() {
  const document = useOpenDocument();
  const currentPage = useCurrentPage();
  const selected = useSelectedElement();
  const list = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<RowDrag | null>(null);

  // Lo seleccionado en el lienzo se trae a la vista en la lista.
  useEffect(() => {
    if (selected === null) {
      return;
    }
    const row = [...(list.current?.querySelectorAll<HTMLElement>("[data-layer]") ?? [])].find(
      (candidate) => candidate.dataset.layer === selected,
    );
    row?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);

  // Esc cancela el arrastre.
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) {
      return;
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setDrag(null);
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [dragging]);

  const page = document?.pages[currentPage];
  if (page === undefined) {
    return null;
  }
  const rows = layerRows(page);
  const count = rows.length;

  const rowRects = () =>
    [...(list.current?.querySelectorAll<HTMLElement>("[data-layer]") ?? [])].map((row) => row.getBoundingClientRect());

  const onPointerDown = (id: string, from: number, event: PointerEvent<HTMLLIElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    useDocumentStore.getState().select(id);
    setDrag({ id, from, startY: event.clientY, moved: false, gap: count - 1 - from });
  };

  const onPointerMove = (event: PointerEvent<HTMLOListElement>) => {
    if (drag === null) {
      return;
    }
    const moved = drag.moved || Math.abs(event.clientY - drag.startY) >= DRAG_THRESHOLD_PX;
    setDrag({ ...drag, moved, gap: gapAt(event.clientY, rowRects()) });
  };

  const onPointerUp = () => {
    if (drag === null) {
      return;
    }
    setDrag(null);
    const index = drag.moved ? reorderIndex(drag.from, drag.gap, count) : null;
    if (index === null) {
      return;
    }
    void applyOp({ op: "reorder", id: drag.id, index })
      .then((applied) => useDocumentStore.getState().applyEdit(applied))
      .catch(() => undefined);
  };

  // Dónde marcar la línea: encima de una fila, o debajo de la última.
  const target = drag?.moved === true ? reorderIndex(drag.from, drag.gap, count) : null;
  const marker = target === null || drag === null ? null : drag.gap;

  return (
    <section className="layers-panel" aria-label="Capas">
      <h2>Capas</h2>
      {count === 0 ? (
        <p className="layers-empty">La página no tiene elementos.</p>
      ) : (
        <ol
          ref={list}
          className={drag?.moved === true ? "layers is-dragging" : "layers"}
          role="listbox"
          aria-label="Capas de la página, la de arriba primero"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDrag(null)}
        >
          {rows.map((row, shown) => {
            const classes = [
              "layer",
              row.id === selected ? "is-selected" : "",
              drag?.moved === true && row.id === drag.id ? "is-dragged" : "",
              marker === shown ? "drop-above" : "",
              marker === count && shown === count - 1 ? "drop-below" : "",
            ];
            return (
              <li
                key={row.id}
                data-layer={row.id}
                role="option"
                aria-selected={row.id === selected}
                className={classes.filter(Boolean).join(" ")}
                title={`${row.label} (${row.id})`}
                onPointerDown={(event) => onPointerDown(row.id, row.index, event)}
              >
                <svg className="layer-icon" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                  {ELEMENT_ICONS[row.type]}
                </svg>
                <span className="layer-label">{row.label}</span>
                <span className="layer-id">{row.id}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
