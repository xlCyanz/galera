/**
 * Las celdas de una tabla, señaladas en el lienzo.
 *
 * Mientras se escribe una celda se recuadra la que se escribe y se marcan
 * las demás de su tabla, para que se vea la rejilla aunque la tabla no
 * dibuje líneas. Con ⇧ o ⌘ se marcan varias, y entonces el formato que se
 * dé va a todas (ver `useCellSelection`).
 *
 * Dónde está cada celda lo dice la composición, no una medida hecha aquí
 * (principio 3): llega con cada compilación y está en el store del layout.
 *
 * Es una ayuda del editor, no parte del documento: no se exporta ni sale en
 * el PDF (principio 2).
 */
import { useLayoutStore } from "../store/layout";
import type { CellBox, LayoutBox } from "../types/layout";
import type { CanvasTransform } from "./transform";
import { toCanvas } from "./transform";

export interface TableCellsProps {
  /** La tabla cuyas celdas se señalan. */
  table: string;
  /** La caja de la tabla, para girar con ella. */
  box: LayoutBox;
  /** La página que se está viendo, contando desde 0. */
  page: number;
  /** Dónde está la página y a qué escala. */
  transform: CanvasTransform;
  /** Las celdas marcadas: la que se escribe y las que se le hayan sumado. */
  marked: readonly { row: number; column: number }[];
}

/** Si esa celda está entre las marcadas. */
function isMarked(
  marked: readonly { row: number; column: number }[],
  cell: CellBox,
): boolean {
  return marked.some((one) => one.row === cell.row && one.column === cell.column);
}

export function TableCells({ table, box, page, transform, marked }: TableCellsProps) {
  const cells = useLayoutStore((state) => state.cells);
  const mine = cells.filter((cell) => cell.table === table && cell.page === page);

  if (mine.length === 0) {
    return null;
  }

  const origin = toCanvas(transform, box.x, box.y);

  return (
    <div
      className="table-cells"
      style={{
        left: origin.x,
        top: origin.y,
        width: box.w * transform.pxPerMm,
        height: box.h * transform.pxPerMm,
        transform: `rotate(${box.rotation}deg)`,
      }}
    >
      {mine.map((cell) => (
        <div
          key={`${cell.row}:${cell.column}`}
          className={isMarked(marked, cell) ? "table-cell is-marked" : "table-cell"}
          data-cell={`${cell.row}:${cell.column}`}
          style={{
            left: (cell.x - box.x) * transform.pxPerMm,
            top: (cell.y - box.y) * transform.pxPerMm,
            width: cell.w * transform.pxPerMm,
            height: cell.h * transform.pxPerMm,
          }}
        />
      ))}
    </div>
  );
}
