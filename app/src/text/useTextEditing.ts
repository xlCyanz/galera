/**
 * Entrar a escribir en un texto del lienzo, y señalar dentro de él.
 *
 * - **Doble clic** sobre un bloque de texto entra a escribirlo. Quién hay
 *   bajo el puntero lo dice el núcleo, igual que al seleccionar
 *   (principio 5). Sobre una zona se escribe su flujo entero, y sobre una
 *   tabla, la celda que haya debajo. Sobre cualquier otro elemento no hace
 *   nada.
 * - **Ya dentro**, el puntero coloca el cursor y selecciona: pulsar y
 *   arrastrar elige un tramo, doble clic una palabra, triple clic un
 *   párrafo, y ⇧ + clic estira lo que ya hubiera. Todo eso se resuelve con
 *   las posiciones de los glifos (`selection.ts`), que ya están aquí:
 *   arrastrar no puede ir y volver al backend en cada movimiento.
 * - Pulsar **fuera** del texto que se escribe sale del modo, y el clic sigue
 *   su camino normal por el lienzo.
 *
 * Lo que se elige se guarda en el estado de edición, y el campo invisible
 * se pone al día con ello: así escribir sustituye lo seleccionado y ⌘C
 * copia lo que se ve seleccionado.
 */
import type { MouseEvent, PointerEvent } from "react";
import { useRef } from "react";

import { elementAt } from "../commands";
import { HIT_TOLERANCE_PX } from "../canvas/useSelection";
import { type CanvasTransform, toDocument } from "../canvas/transform";
import { useDocumentStore } from "../store/document";
import { useEditingStore } from "../store/editing";
import { useLayoutStore } from "../store/layout";
import type { Glyph, LayoutBox } from "../types/layout";
import { byteIndex } from "./caret";
import { textOf } from "./change";
import { indexAt, paragraphAt, unrotate, wordAt } from "./selection";
import { boxOf, cellAt } from "./table";
import { inBox, runsOf } from "./target";

/** Cuánto se ensancha la caja del texto para seguir señalando dentro, en
 * mm: pulsar justo en el borde no tendría que salirse. */
const EDGE_MM = 1;

/** Los manejadores que el lienzo necesita para escribir en un texto. */
export interface TextEditing {
  /** Doble clic en el lienzo: entrar a escribir un texto. */
  onDoubleClick: (event: MouseEvent<HTMLElement>) => void;
  /**
   * Pulsar en el lienzo. Devuelve `true` si lo ha atendido —se estaba
   * escribiendo y se ha pulsado dentro del texto—, y entonces el lienzo no
   * hace nada más con ese clic.
   */
  onPointerDown: (event: PointerEvent<HTMLElement>) => boolean;
  /**
   * Entra a escribir en ese elemento, sin puntero: lo que hace Intro sobre
   * lo seleccionado (F8-02). Devuelve si era algo donde se escribe.
   */
  enter: (id: string) => boolean;
}

/**
 * @param transform Dónde está la página visible y a qué escala.
 * @param page La página visible, contando desde 0.
 */
export function useTextEditing(transform: CanvasTransform | null, page: number): TextEditing {
  /** Mientras se arrastra para seleccionar: dónde empezó, en bytes. */
  const anchor = useRef<number | null>(null);

  /** El punto del evento en mm de la página. */
  const pointOf = (event: { currentTarget: HTMLElement; clientX: number; clientY: number }) => {
    if (transform === null) {
      return null;
    }
    const area = event.currentTarget.getBoundingClientRect();
    return toDocument(transform, event.clientX - area.left, event.clientY - area.top);
  };

  /** Si el punto cae dentro de la caja, con un margen para el borde. */
  const within = (box: LayoutBox, x: number, y: number) => {
    const local = unrotate(box, x, y);
    return (
      local.x >= box.x - EDGE_MM &&
      local.x <= box.x + box.w + EDGE_MM &&
      local.y >= box.y - EDGE_MM &&
      local.y <= box.y + box.h + EDGE_MM
    );
  };

  /**
   * El texto que se está escribiendo y la caja por la que se señala, si el
   * punto cae dentro.
   *
   * De un flujo vale **cualquiera de sus zonas**: el texto es uno solo, así
   * que señalar en la tercera zona es señalar en el mismo texto que en la
   * primera. Los glifos que se miran son los de la página que se ve, que es
   * donde se ha pulsado.
   */
  const editedAt = (
    x: number,
    y: number,
  ): { box: LayoutBox; text: string; glyphs: Glyph[] } | null => {
    const { element, flow, cell, glyphs } = useEditingStore.getState();
    const document = useDocumentStore.getState().document;
    if (document === undefined || document === null) {
      return null;
    }
    const boxes = useLayoutStore.getState().boxes;

    if (flow !== null) {
      const chain = document.flows?.[flow]?.zones ?? [];
      const zone = chain
        .map((id) => boxes[id])
        .find((box) => box !== undefined && box.page === page && within(box, x, y));
      if (zone === undefined) {
        return null;
      }
      const runs = runsOf(document, { kind: "flow", name: flow });
      return runs === null
        ? null
        : { box: zone, text: textOf(runs), glyphs: inBox(glyphs, zone) };
    }

    if (cell !== null) {
      // La celda se señala dentro de su tabla: el punto se desgira con la
      // caja de la tabla, que es lo que gira el lienzo, y se compara con la
      // caja de la celda, que la midió Typst.
      const table = boxes[cell.table];
      const rect = boxOf(useLayoutStore.getState().cells, cell.table, cell.row, cell.column);
      if (table === undefined || rect === null || rect.page !== page) {
        return null;
      }
      const local = unrotate(table, x, y);
      const inside =
        local.x >= rect.x - EDGE_MM &&
        local.x <= rect.x + rect.w + EDGE_MM &&
        local.y >= rect.y - EDGE_MM &&
        local.y <= rect.y + rect.h + EDGE_MM;
      if (!inside) {
        return null;
      }
      const runs = runsOf(document, { kind: "cell", ...cell });
      return runs === null
        ? null
        : { box: table, text: textOf(runs), glyphs: inBox(glyphs, rect) };
    }

    if (element === null) {
      return null;
    }
    const box = boxes[element];
    if (box === undefined || !within(box, x, y)) {
      return null;
    }
    const found = document.pages
      .flatMap((one) => one.elements)
      .find((candidate) => candidate.id === element);
    return found !== undefined && found.type === "text"
      ? { box, text: textOf(found.content), glyphs }
      : null;
  };

  /**
   * Si se está escribiendo una celda y el punto cae en **otra** de la misma
   * tabla, pasa a escribir esa, con el cursor al final de su texto: sus
   * glifos todavía no están aquí, y el cursor no puede ir a un sitio que no
   * se ha medido. Con `extend`, la suma a las marcadas en vez de cambiar de
   * celda.
   */
  const changedCell = (x: number, y: number, extend: boolean): boolean => {
    const { cell } = useEditingStore.getState();
    const document = useDocumentStore.getState().document;
    if (cell === null || document === null || document === undefined) {
      return false;
    }
    const table = useLayoutStore.getState().boxes[cell.table];
    if (table === undefined) {
      return false;
    }
    const local = unrotate(table, x, y);
    const found = cellAt(useLayoutStore.getState().cells, page, local.x, local.y, cell.table);
    if (found === null || (found.row === cell.row && found.column === cell.column)) {
      return false;
    }
    // Con ⇧ o ⌘ se suma a las marcadas en vez de cambiar de celda, y la
    // que se escribe queda entera seleccionada: el formato va a todas.
    if (extend) {
      useEditingStore.getState().markCell(found.row, found.column);
      const mine = runsOf(document, { kind: "cell", ...cell });
      if (mine !== null) {
        const text = textOf(mine);
        useEditingStore.getState().select(0, byteIndex(text, text.length));
      }
      return true;
    }

    const runs = runsOf(document, {
      kind: "cell",
      table: cell.table,
      row: found.row,
      column: found.column,
    });
    if (runs === null) {
      return false;
    }
    const text = textOf(runs);
    useEditingStore
      .getState()
      .editCell(cell.table, found.row, found.column, byteIndex(text, text.length));
    return true;
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    const view = transform;
    if (event.button !== 0 || view === null) {
      return false;
    }
    const point = pointOf(event);
    if (point === null) {
      return false;
    }
    // Dentro de la misma tabla, pulsar en otra celda pasa a escribirla: es
    // la celda la que se escribe, no la tabla.
    if (changedCell(point.x, point.y, event.shiftKey || event.metaKey)) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }

    const edited = editedAt(point.x, point.y);
    if (edited === null) {
      // Fuera del texto: se deja de escribir y el clic sigue su camino.
      useEditingStore.getState().stop();
      return false;
    }

    const { box, text, glyphs } = edited;
    const { start, end } = useEditingStore.getState();
    const local = unrotate(box, point.x, point.y);
    const at = indexAt(glyphs, text, local.x, local.y);
    const select = useEditingStore.getState().select;

    // Tres clics seguidos: el párrafo. Dos: la palabra.
    if (event.detail >= 3) {
      const range = paragraphAt(text, at);
      anchor.current = null;
      select(range.start, range.end);
    } else if (event.detail === 2) {
      const range = wordAt(text, at);
      anchor.current = null;
      select(range.start, range.end);
    } else if (event.shiftKey) {
      // ⇧ estira lo que ya hubiera desde su otro extremo.
      const from = start === end ? start : (at < start ? end : start);
      anchor.current = from;
      select(from, at);
    } else {
      anchor.current = at;
      select(at, at);
    }

    // Arrastrar estira la selección hasta que se suelta. El área se guarda
    // ahora: React vacía el evento en cuanto vuelve el manejador.
    const viewport = event.currentTarget;
    const move = (moved: globalThis.PointerEvent) => {
      const from = anchor.current;
      if (from === null) {
        return;
      }
      const area = viewport.getBoundingClientRect();
      const inCanvas = toDocument(view, moved.clientX - area.left, moved.clientY - area.top);
      // Al arrastrar por un flujo se cruzan zonas: la que vale es la que
      // haya debajo ahora, con sus glifos. Fuera de todas —o fuera de la
      // caja de un bloque— sigue valiendo la de donde empezó, para que
      // arrastrar más allá del texto llegue hasta el final.
      const over = editedAt(inCanvas.x, inCanvas.y) ?? { box, text, glyphs };
      const there = unrotate(over.box, inCanvas.x, inCanvas.y);
      useEditingStore.getState().select(from, indexAt(over.glyphs, over.text, there.x, there.y));
    };
    const release = () => {
      anchor.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release);

    // El lienzo no tiene que seleccionar ni arrastrar el elemento.
    event.preventDefault();
    event.stopPropagation();
    return true;
  };

  /**
   * Entra a escribir en el elemento `id`: un bloque de texto, el flujo de
   * una zona o una celda de una tabla. Devuelve si había dónde escribir.
   *
   * `point` es dónde se pulsó, en mm de la página. En una tabla dice en qué
   * celda se entra; sin él —desde el teclado—, se entra en la primera.
   */
  const enter = (id: string, point: { x: number; y: number } | null): boolean => {
    const element = useDocumentStore
      .getState()
      .document?.pages.flatMap((one) => one.elements)
      .find((candidate) => candidate.id === id);
    if (element === undefined) {
      return false;
    }
    // Una zona no lleva texto: lo lleva su flujo, y se escribe entero.
    if (element.type === "flow") {
      const runs = runsOf(useDocumentStore.getState().document, { kind: "flow", name: element.flow });
      if (runs === null) {
        return false;
      }
      useDocumentStore.getState().select(id);
      const text = textOf(runs);
      useEditingStore.getState().editFlow(element.flow, byteIndex(text, text.length));
      return true;
    }
    // Una tabla no lleva texto: lo llevan sus celdas, y se entra en la que
    // esté bajo el puntero, o en la primera.
    if (element.type === "table") {
      const cells = useLayoutStore.getState().cells.filter((one) => one.table === id);
      let cell = cells[0] ?? null;
      if (point !== null) {
        const box = useLayoutStore.getState().boxes[id];
        if (box === undefined) {
          return false;
        }
        const local = unrotate(box, point.x, point.y);
        cell = cellAt(cells, page, local.x, local.y, id);
      }
      if (cell === null) {
        return false;
      }
      const runs = runsOf(useDocumentStore.getState().document, {
        kind: "cell",
        table: id,
        row: cell.row,
        column: cell.column,
      });
      if (runs === null) {
        return false;
      }
      useDocumentStore.getState().select(id);
      const text = textOf(runs);
      useEditingStore.getState().editCell(id, cell.row, cell.column, byteIndex(text, text.length));
      return true;
    }
    if (element.type !== "text") {
      return false;
    }
    useDocumentStore.getState().select(id);
    // El cursor entra al final, contado en bytes como el núcleo.
    const text = textOf(element.content);
    useEditingStore.getState().edit(id, byteIndex(text, text.length));
    return true;
  };

  const onDoubleClick = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0 || transform === null) {
      return;
    }
    const point = pointOf(event);
    if (point === null || editedAt(point.x, point.y) !== null) {
      // Dentro del texto que ya se escribe lo atendió `onPointerDown`.
      return;
    }
    // Dentro de un grupo se atraviesa, que si no el doble clic acertaría
    // el grupo y nunca el texto que lleva dentro.
    const below = useDocumentStore.getState().enteredGroup;
    void elementAt(page, point.x, point.y, HIT_TOLERANCE_PX / transform.pxPerMm, below)
      .then((id) => {
        if (id !== null) {
          enter(id, point);
        }
      })
      .catch(() => {
        // Sin respuesta del núcleo no se entra a escribir.
      });
  };

  return { onDoubleClick, onPointerDown, enter: (id) => enter(id, null) };
}
