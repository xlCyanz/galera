/**
 * El menú que sale con el botón derecho sobre una celda.
 *
 * Lo que ofrece es lo mismo que el inspector —meter y quitar filas y
 * columnas— pero **sobre la celda donde se ha pulsado**: meter una fila
 * encima es meterla encima de esa. Cada opción manda un comando, así que
 * todas se deshacen.
 */
import { applyOp } from "../commands";
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
  const table = tableOf(document, at.table);
  if (table === null) {
    return null;
  }

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
      className="table-menu"
      style={{ left: at.x, top: at.y }}
      role="menu"
      aria-label="Tabla"
      // Pulsar dentro no llega al lienzo, que cerraría el menú.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button type="button" onClick={() => run(insertRowOp(at.table, columns, at.row))}>
        Insertar fila encima
      </button>
      <button type="button" onClick={() => run(insertRowOp(at.table, columns, at.row + 1))}>
        Insertar fila debajo
      </button>
      <button
        type="button"
        disabled={table.rows.length <= 1}
        onClick={() => run(removeRowOp(at.table, at.row))}
      >
        Quitar la fila
      </button>
      <hr />
      <button
        type="button"
        onClick={() => run(insertColumnOp(at.table, at.column, table.columns[at.column]))}
      >
        Insertar columna a la izquierda
      </button>
      <button
        type="button"
        onClick={() => run(insertColumnOp(at.table, at.column + 1, table.columns[at.column]))}
      >
        Insertar columna a la derecha
      </button>
      <button
        type="button"
        disabled={columns <= 1}
        onClick={() => run(removeColumnOp(at.table, at.column))}
      >
        Quitar la columna
      </button>
    </div>
  );
}
