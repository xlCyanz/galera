/**
 * Los bordes de las columnas de una tabla, para arrastrarlos.
 *
 * Por dónde pasa cada borde lo dice la composición, no una medida hecha
 * aquí (principio 3): una columna `auto` mide lo que pida su contenido y eso
 * solo lo sabe Typst. Mientras se arrastra, el borde se enseña donde va el
 * puntero; al soltar se manda **un solo comando** con el ancho nuevo.
 *
 * # Qué cambia al soltar
 *
 * Las dos columnas que tocan ese borde, y ninguna más: la de la izquierda
 * pasa a medir hasta donde se soltó, y la de la derecha, lo que le queda
 * hasta su otro borde. Las dos quedan con un ancho fijo, que es lo que hace
 * que arrastrar signifique siempre lo mismo: si la de la derecha siguiera
 * siendo `auto`, movería el borde de más allá y la tabla entera bailaría.
 *
 * Los extremos de la tabla no se arrastran: ese es el ancho del elemento, y
 * se cambia con sus manejadores.
 */
import { useEffect, useState } from "react";

import { applyOp, columnEdges } from "../commands";
import { useDocumentStore } from "../store/document";
import { useLayoutStore } from "../store/layout";
import type { LayoutBox } from "../types/layout";
import type { Op } from "../types/ops";
import { unrotate } from "../text/selection";
import { type CanvasTransform, toCanvas, toDocument } from "./transform";

/** Lo menos que puede medir una columna al arrastrarla, en mm. */
const MIN_MM = 2;

export interface ColumnHandlesProps {
  /** La tabla cuyos bordes se pueden arrastrar. */
  table: string;
  /** La caja de la tabla, para girar con ella. */
  box: LayoutBox;
  /** Dónde está la página y a qué escala. */
  transform: CanvasTransform;
}

export function ColumnHandles({ table, box, transform }: ColumnHandlesProps) {
  const revision = useLayoutStore((state) => state.revision);
  const [edges, setEdges] = useState<(number | null)[]>([]);
  /** Mientras se arrastra: qué borde y por dónde va, en mm de la página. */
  const [dragging, setDragging] = useState<{ index: number; at: number } | null>(null);

  useEffect(() => {
    let alive = true;
    void columnEdges(table)
      .then((found) => {
        if (alive) {
          setEdges(found);
        }
      })
      .catch(() => {
        // Sin bordes no se dibuja ningún manejador.
      });
    return () => {
      alive = false;
    };
  }, [table, revision]);

  if (edges.length < 3) {
    // Una tabla de una sola columna no tiene ningún borde por dentro.
    return null;
  }

  const start = (index: number, event: React.PointerEvent<HTMLElement>) => {
    const left = edges[index - 1];
    const right = edges[index + 1];
    const area = event.currentTarget.ownerDocument.querySelector(".canvas-viewport");
    if (left === null || left === undefined || right === null || right === undefined || area === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    const bounds = area.getBoundingClientRect();
    // El puntero se desgira con la tabla: en una tabla girada, arrastrar
    // sigue moviendo el borde a lo ancho de ella, no a lo ancho de la
    // pantalla.
    const place = (clientX: number, clientY: number) => {
      const point = toDocument(transform, clientX - bounds.left, clientY - bounds.top);
      const local = unrotate(box, point.x, point.y);
      return Math.min(Math.max(local.x, left + MIN_MM), right - MIN_MM);
    };

    setDragging({ index, at: place(event.clientX, event.clientY) });

    const move = (moved: PointerEvent) =>
      setDragging({ index, at: place(moved.clientX, moved.clientY) });
    const release = (released: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      setDragging(null);
      const at = place(released.clientX, released.clientY);
      const op: Op = {
        op: "batch",
        ops: [
          { op: "set_column_width", id: table, column: index - 1, width: { width: "fixed", mm: round(at - left) } },
          { op: "set_column_width", id: table, column: index, width: { width: "fixed", mm: round(right - at) } },
        ],
      };
      applyOp(op)
        .then((applied) => useDocumentStore.getState().applyEdit(applied))
        .catch(() => {
          // La tabla se queda como estaba.
        });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release);
  };

  return (
    <div
      className="column-handles"
      style={{
        left: toCanvas(transform, box.x, box.y).x,
        top: toCanvas(transform, box.x, box.y).y,
        width: box.w * transform.pxPerMm,
        height: box.h * transform.pxPerMm,
        transform: `rotate(${box.rotation}deg)`,
      }}
    >
      {edges.map((edge, index) => {
        // Ni el borde de la izquierda del todo ni el de la derecha: esos
        // son el ancho de la tabla, y se cambia con sus manejadores.
        if (index === 0 || index === edges.length - 1 || edge === null) {
          return null;
        }
        const at = dragging?.index === index ? dragging.at : edge;
        return (
          <div
            key={index}
            className={dragging?.index === index ? "column-handle is-dragging" : "column-handle"}
            data-column-edge={index}
            role="separator"
            aria-orientation="vertical"
            aria-label={`Ancho de la columna ${index}`}
            style={{ left: (at - box.x) * transform.pxPerMm }}
            onPointerDown={(event) => start(index, event)}
          />
        );
      })}
    </div>
  );
}

/** Un ancho en milímetros, con una décima de precisión. */
function round(mm: number): number {
  return Math.round(mm * 10) / 10;
}
