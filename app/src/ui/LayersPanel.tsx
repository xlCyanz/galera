/**
 * El panel de capas: los elementos de la página que se ve, la capa de
 * arriba primero (`layerOrder.ts`).
 *
 * - La selección es la misma que la del lienzo: pulsar una fila selecciona
 *   el elemento, y seleccionarlo en el lienzo marca su fila (y la trae a la
 *   vista si hace falta). ⇧ + clic suma y resta de la selección, y con
 *   varios marcados se ven todas sus filas.
 * - Arrastrar una fila en vertical la cambia de capa: una línea marca dónde
 *   caerá, y al soltar se manda un único `Op::Reorder`, que recompila y se
 *   deshace con ⌘Z. Esc cancela el arrastre.
 *
 * - Cada fila tiene un ojo (ocultar: el elemento no se emite en el código
 *   Typst) y un candado (bloquear: el clic en el lienzo lo atraviesa, y
 *   solo se selecciona desde aquí). Doble clic en el nombre lo renombra;
 *   dejarlo vacío vuelve al nombre que se deduce del elemento.
 *
 * Ocultar, bloquear y renombrar son `Op::SetProperty`: entran en el
 * historial como cualquier cambio.
 *
 * El arrastre va con eventos de puntero, no con el arrastrar y soltar de
 * HTML: Tauri usa este último para recibir archivos del sistema.
 */
import { type PointerEvent, type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";

import { applyOp } from "../commands";
import {
  useCurrentPage,
  useDocumentStore,
  useOpenDocument,
  useSelectedElement,
  useSelection,
} from "../store/document";
import type { Property } from "../types/ops";
import { ELEMENT_ICONS, LAYER_ICONS } from "./icons";
import { gapAt, layerRows, reorderIndex } from "./layerOrder";

/** Cambia una propiedad de capa de un elemento, como un comando más. */
function setLayerProperty(id: string, property: Property) {
  void applyOp({ op: "set_property", id, property })
    .then((applied) => useDocumentStore.getState().applyEdit(applied))
    .catch(() => undefined);
}

/** Un botón de la fila no empieza a arrastrarla ni la selecciona. */
function keepFromRow(event: PointerEvent<HTMLElement>) {
  event.stopPropagation();
}

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
  const selection = useSelection();
  const list = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<RowDrag | null>(null);
  // La fila que se está renombrando, y lo escrito.
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null);
  /** Si al acabar de renombrar hay que devolver el foco a la lista. */
  const refocus = useRef(false);
  useEffect(() => {
    if (renaming === null && refocus.current) {
      refocus.current = false;
      list.current?.focus();
    }
  }, [renaming]);

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
    if (event.button !== 0 || renaming?.id === id) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (event.shiftKey) {
      // ⇧ suma o quita de la selección, igual que en el lienzo; con varios
      // no se reordena arrastrando.
      useDocumentStore.getState().toggleSelected(id);
      return;
    }
    if (!useDocumentStore.getState().selection.includes(id)) {
      useDocumentStore.getState().select(id);
    }
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

  const finishRenaming = (commit: boolean) => {
    if (renaming === null) {
      return;
    }
    setRenaming(null);
    // El foco vuelve a la lista cuando el campo ya no esté: moverlo ahora le
    // quitaría el foco al campo, y su `onBlur` guardaría el nombre otra vez.
    refocus.current = true;
    const current = rows.find((row) => row.id === renaming.id);
    const text = renaming.text.trim();
    if (!commit || current === undefined || text === (current.name ?? "")) {
      return;
    }
    setLayerProperty(renaming.id, { name: "name", value: text === "" ? null : text });
  };

  const onRenameKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    // Que el lienzo no tome estas teclas por atajos.
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      finishRenaming(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finishRenaming(false);
    }
  };

  /**
   * El teclado en la lista (F8-02, #89): todo lo que se hace con el ratón
   * tiene su tecla.
   *
   * - ↑ y ↓ seleccionan la capa de encima o de debajo; con ⇧, la suman a la
   *   selección. Inicio y Fin, la primera y la última.
   * - ⌥↑ y ⌥↓ suben o bajan la capa seleccionada un puesto, que es lo que
   *   hace arrastrarla.
   * - Intro o F2 empiezan a renombrarla, como el doble clic.
   *
   * Las teclas que atiende no siguen su camino: si no, las flechas moverían
   * además el elemento en el lienzo.
   */
  const onListKey = (event: ReactKeyboardEvent<HTMLOListElement>) => {
    if (renaming !== null || count === 0) {
      return;
    }
    const { selection: chosen } = useDocumentStore.getState();
    const active = rows.findIndex((row) => row.id === chosen.at(-1));
    const at = active < 0 ? 0 : active;
    const row = rows[at];

    const handled = (() => {
      if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        if (row === undefined || chosen.length !== 1) {
          return true;
        }
        // La lista va de la capa de arriba a la de abajo; el orden del
        // documento, al revés.
        const index = row.index + (event.key === "ArrowUp" ? 1 : -1);
        if (index < 0 || index >= count) {
          return true;
        }
        void applyOp({ op: "reorder", id: row.id, index })
          .then((applied) => useDocumentStore.getState().applyEdit(applied))
          .catch(() => undefined);
        return true;
      }
      const target =
        event.key === "ArrowDown"
          ? Math.min(at + (active < 0 ? 0 : 1), count - 1)
          : event.key === "ArrowUp"
            ? Math.max(at - 1, 0)
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? count - 1
                : null;
      if (target !== null) {
        const next = rows[target];
        if (next !== undefined) {
          if (event.shiftKey && !chosen.includes(next.id)) {
            useDocumentStore.getState().toggleSelected(next.id);
          } else if (!event.shiftKey) {
            useDocumentStore.getState().select(next.id);
          }
        }
        return true;
      }
      if ((event.key === "Enter" || event.key === "F2") && row !== undefined && active >= 0) {
        setRenaming({ id: row.id, text: row.name ?? row.label });
        return true;
      }
      return false;
    })();

    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
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
          aria-multiselectable="true"
          tabIndex={0}
          aria-activedescendant={selected === null ? undefined : `layer-${selected}`}
          onKeyDown={onListKey}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDrag(null)}
        >
          {rows.map((row, shown) => {
            const classes = [
              "layer",
              selection.includes(row.id) ? "is-selected" : "",
              drag?.moved === true && row.id === drag.id ? "is-dragged" : "",
              row.hidden ? "is-hidden" : "",
              row.locked ? "is-locked" : "",
              marker === shown ? "drop-above" : "",
              marker === count && shown === count - 1 ? "drop-below" : "",
            ];
            return (
              <li
                key={row.id}
                id={`layer-${row.id}`}
                data-layer={row.id}
                role="option"
                aria-selected={selection.includes(row.id)}
                className={classes.filter(Boolean).join(" ")}
                title={`${row.label} (${row.id})`}
                onPointerDown={(event) => onPointerDown(row.id, row.index, event)}
              >
                <svg className="layer-icon" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                  {ELEMENT_ICONS[row.type]}
                </svg>
                {renaming?.id === row.id ? (
                  <input
                    className="layer-rename"
                    aria-label={`Nombre de ${row.id}`}
                    value={renaming.text}
                    autoFocus
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => setRenaming({ id: row.id, text: event.currentTarget.value })}
                    onKeyDown={onRenameKey}
                    onBlur={() => finishRenaming(true)}
                    onPointerDown={keepFromRow}
                  />
                ) : (
                  <span
                    className="layer-label"
                    onDoubleClick={() => setRenaming({ id: row.id, text: row.name ?? row.label })}
                  >
                    {row.label}
                  </span>
                )}
                <span className="layer-id">{row.id}</span>
                <button
                  type="button"
                  className="layer-toggle"
                  data-toggle="hidden"
                  aria-pressed={row.hidden}
                  aria-label={row.hidden ? `Mostrar ${row.label}` : `Ocultar ${row.label}`}
                  title={row.hidden ? "Mostrar" : "Ocultar"}
                  onPointerDown={keepFromRow}
                  onClick={() => setLayerProperty(row.id, { name: "hidden", value: !row.hidden })}
                >
                  <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
                    {row.hidden ? LAYER_ICONS.hidden : LAYER_ICONS.visible}
                  </svg>
                </button>
                <button
                  type="button"
                  className="layer-toggle"
                  data-toggle="locked"
                  aria-pressed={row.locked}
                  aria-label={row.locked ? `Desbloquear ${row.label}` : `Bloquear ${row.label}`}
                  title={row.locked ? "Desbloquear" : "Bloquear"}
                  onPointerDown={keepFromRow}
                  onClick={() => setLayerProperty(row.id, { name: "locked", value: !row.locked })}
                >
                  <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
                    {row.locked ? LAYER_ICONS.locked : LAYER_ICONS.unlocked}
                  </svg>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
