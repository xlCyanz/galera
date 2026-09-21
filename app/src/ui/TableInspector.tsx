/**
 * El inspector de una tabla: sus filas, sus columnas y lo que mide cada una.
 *
 * - **Filas y columnas**: se añaden al final y se quita la última. Para
 *   meter una por en medio está el menú del lienzo, que sabe en qué celda
 *   se ha pulsado (`canvas/TableMenu.tsx`).
 * - **Ancho de cada columna**: automático —lo que pida su contenido—, fijo
 *   en milímetros, o una parte de lo que sobre (`fr`). Lo que mide de
 *   verdad una columna automática lo decide Typst, así que aquí no se
 *   enseña un número inventado (principio 3): se arrastra su borde en el
 *   lienzo (`canvas/ColumnHandles.tsx`).
 *
 * Cada cambio es un comando, así que todos se deshacen.
 */
import { applyOp } from "../commands";
import { useDocumentStore } from "../store/document";
import type { ColumnWidth, Element } from "../types/model";
import type { Op } from "../types/ops";
import { MeasureField } from "./MeasureField";
import {
  columnWidthOp,
  insertColumnOp,
  insertRowOp,
  removeColumnOp,
  removeRowOp,
} from "./tableEdits";

/** Cómo se llama cada forma de medir una columna. */
const KINDS: Array<{ value: ColumnWidth["width"]; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "fixed", label: "Fija" },
  { value: "fraction", label: "Parte" },
];

/** Una columna de ese tipo, conservando el número si lo tenía. */
function widthOf(kind: ColumnWidth["width"], current: ColumnWidth): ColumnWidth {
  switch (kind) {
    case "fixed":
      return { width: "fixed", mm: current.width === "fixed" ? current.mm : 20 };
    case "fraction":
      return { width: "fraction", fr: current.width === "fraction" ? current.fr : 1 };
    default:
      return { width: "auto" };
  }
}

function run(op: Op) {
  applyOp(op)
    .then((applied) => useDocumentStore.getState().applyEdit(applied))
    .catch(() => {
      // La tabla se queda como estaba.
    });
}

export function TableInspector({ element }: { element: Element & { type: "table" } }) {
  const { id, columns, rows } = element;

  return (
    <div className="table-inspector">
      <div className="inspector-row">
        <span className="inspector-label">Filas</span>
        <span className="inspector-value">{rows.length}</span>
        <button
          type="button"
          aria-label="Añadir una fila"
          onClick={() => run(insertRowOp(id, columns.length, rows.length))}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Quitar la última fila"
          disabled={rows.length <= 1}
          onClick={() => run(removeRowOp(id, rows.length - 1))}
        >
          −
        </button>
      </div>

      <div className="inspector-row">
        <span className="inspector-label">Columnas</span>
        <span className="inspector-value">{columns.length}</span>
        <button
          type="button"
          aria-label="Añadir una columna"
          onClick={() =>
            run(insertColumnOp(id, columns.length, columns[columns.length - 1]))
          }
        >
          +
        </button>
        <button
          type="button"
          aria-label="Quitar la última columna"
          disabled={columns.length <= 1}
          onClick={() => run(removeColumnOp(id, columns.length - 1))}
        >
          −
        </button>
      </div>

      {columns.map((width, column) => (
        // Las columnas no tienen id: su sitio es lo que las distingue, y
        // meter o quitar una vuelve a montar las de detrás.
        <div className="inspector-row" key={column}>
          <span className="inspector-label">Col. {column + 1}</span>
          <select
            aria-label={`Ancho de la columna ${column + 1}`}
            value={width.width}
            onChange={(event) =>
              run(
                columnWidthOp(
                  id,
                  column,
                  widthOf(event.target.value as ColumnWidth["width"], width),
                ),
              )
            }
          >
            {KINDS.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </select>
          {width.width === "fixed" && (
            <MeasureField
              label="An"
              title={`Ancho de la columna ${column + 1}`}
              value={width.mm}
              unit="mm"
              onCommit={(mm) => run(columnWidthOp(id, column, { width: "fixed", mm }))}
            />
          )}
          {width.width === "fraction" && (
            <MeasureField
              label="fr"
              title={`Partes de la columna ${column + 1}`}
              value={width.fr}
              unit="fr"
              step={0.5}
              onCommit={(fr) => run(columnWidthOp(id, column, { width: "fraction", fr }))}
            />
          )}
        </div>
      ))}
    </div>
  );
}
