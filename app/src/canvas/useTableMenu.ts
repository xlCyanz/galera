/**
 * El menú de una tabla: el botón derecho sobre una celda.
 *
 * Lo que se puede hacer ahí —meter y quitar filas y columnas— depende de
 * **en qué celda** se ha pulsado, así que lo primero es saberlo. La celda
 * sale de las cajas que dejó la composición (`layout::cells`), desgirando
 * el punto con la caja de su tabla, igual que al entrar a escribir.
 *
 * El menú solo sale sobre una tabla: en el resto del lienzo, el botón
 * derecho sigue haciendo lo que hiciera.
 */
import { useState } from "react";
import type { MouseEvent } from "react";

import { useLayoutStore } from "../store/layout";
import { unrotate } from "../text/selection";
import { type CanvasTransform, toDocument } from "./transform";

/** Dónde se ha pedido el menú y sobre qué celda. */
export interface TableMenuAt {
  /** La tabla. */
  table: string;
  /** La fila, contando desde 0. */
  row: number;
  /** La columna de la rejilla, contando desde 0. */
  column: number;
  /** Dónde ponerlo, en píxeles del área. */
  x: number;
  y: number;
}

export interface TableMenuControl {
  /** El menú abierto, o `null`. */
  menu: TableMenuAt | null;
  /** Botón derecho en el lienzo: abre el menú si hay una celda debajo. */
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  /** Cierra el menú. */
  close: () => void;
  /** Lo abre sobre una celda sin puntero: ⇧F10 o la tecla de menú. */
  openAt: (at: TableMenuAt) => void;
}

export function useTableMenu(
  transform: CanvasTransform | null,
  page: number,
): TableMenuControl {
  const [menu, setMenu] = useState<TableMenuAt | null>(null);

  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    if (transform === null) {
      return;
    }
    const area = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - area.left;
    const y = event.clientY - area.top;
    const point = toDocument(transform, x, y);

    const { boxes, cells } = useLayoutStore.getState();
    // La última gana: es la que se dibujó encima.
    for (let index = cells.length - 1; index >= 0; index -= 1) {
      const cell = cells[index];
      const box = cell === undefined ? undefined : boxes[cell.table];
      if (cell === undefined || cell.page !== page || box === undefined) {
        continue;
      }
      const local = unrotate(box, point.x, point.y);
      if (
        local.x >= cell.x &&
        local.x <= cell.x + cell.w &&
        local.y >= cell.y &&
        local.y <= cell.y + cell.h
      ) {
        event.preventDefault();
        setMenu({ table: cell.table, row: cell.row, column: cell.column, x, y });
        return;
      }
    }

    setMenu(null);
  };

  return { menu, onContextMenu, close: () => setMenu(null), openAt: setMenu };
}
