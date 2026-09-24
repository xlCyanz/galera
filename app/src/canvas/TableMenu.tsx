/**
 * El menú que sale con el botón derecho sobre una celda.
 *
 * Lo que ofrece es lo mismo que el inspector —meter y quitar filas y
 * columnas— pero **sobre la celda donde se ha pulsado**: meter una fila
 * encima es meterla encima de esa. Cada opción manda un comando, así que
 * todas se deshacen.
 */
import { type KeyboardEvent, useRef } from "react";

import { applyOp } from "../commands";
import { focusables, useDialogFocus } from "../hooks/useDialogFocus";
import { useDocumentStore } from "../store/document";
import { tableOf } from "../text/table";
import {
  insertColumnOp,
  insertRowOp,
  removeColumnOp,
  removeRowOp,
} from "../ui/tableEdits";
import type { Op } from "../types/ops";
import type { TableMenuAt } from "./useTableMenu";

export interface TableMenuProps {
  /** Dónde se ha pedido y sobre qué celda. */
  at: TableMenuAt;
  /** Cierra el menú. */
  onClose: () => void;
}

export function TableMenu({ at, onClose }: TableMenuProps) {
  const document = useDocumentStore((state) => state.document);
  const menu = useRef<HTMLDivElement>(null);
  // El foco entra en la primera opción y, al cerrar, vuelve a donde estaba
  // —el texto de la celda, si se abrió escribiendo—. Un menú no atrapa el
  // tabulador: salir con él lo cierra (F8-02, #89).
  useDialogFocus(menu, { onEscape: onClose, trap: false });

  const table = tableOf(document, at.table);
  if (table === null) {
    return null;
  }

  /** ↑ y ↓ recorren las opciones dando la vuelta; Inicio y Fin, los extremos. */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = menu.current === null ? [] : focusables(menu.current);
    const now = items.indexOf(globalThis.document.activeElement as HTMLElement);
    const next =
      event.key === "ArrowDown"
        ? (now + 1) % items.length
        : event.key === "ArrowUp"
          ? (now - 1 + items.length) % items.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : null;
    if (event.key === "Tab") {
      onClose();
      return;
    }
    if (next === null || items.length === 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    items[next]?.focus();
  };

  const run = (op: Op) => {
    onClose();
    applyOp(op)
      .then((applied) => useDocumentStore.getState().applyEdit(applied))
      .catch(() => {
        // La tabla se queda como estaba.
      });
  };

  const columns = table.columns.length;

  return (
    <div
      ref={menu}
      tabIndex={-1}
      className="table-menu"
      style={{ left: at.x, top: at.y }}
      role="menu"
      aria-label="Tabla"
      onKeyDown={onKeyDown}
      // Pulsar dentro no llega al lienzo, que cerraría el menú.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button type="button" role="menuitem" onClick={() => run(insertRowOp(at.table, columns, at.row))}>
        Insertar fila encima
      </button>
      <button type="button" role="menuitem" onClick={() => run(insertRowOp(at.table, columns, at.row + 1))}>
        Insertar fila debajo
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={table.rows.length <= 1}
        onClick={() => run(removeRowOp(at.table, at.row))}
      >
        Quitar la fila
      </button>
      <hr />
      <button
        type="button"
        role="menuitem"
        onClick={() => run(insertColumnOp(at.table, at.column, table.columns[at.column]))}
      >
        Insertar columna a la izquierda
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => run(insertColumnOp(at.table, at.column + 1, table.columns[at.column]))}
      >
        Insertar columna a la derecha
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={columns <= 1}
        onClick={() => run(removeColumnOp(at.table, at.column))}
      >
        Quitar la columna
      </button>
    </div>
  );
}
