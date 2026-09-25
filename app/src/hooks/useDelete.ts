/**
 * Borrar lo seleccionado con Supr o ⌫.
 *
 * Es cortar sin copiar: el mismo comando, un borrado por elemento en un solo
 * paso, así que se deshace de una vez («Eliminar 3 elementos»).
 *
 * # Dónde vale
 *
 * Borrar se lleva cosas, así que solo cuenta donde la tecla no puede querer
 * decir otra cosa: con el foco en el lienzo, en la lista de capas o en
 * ninguna parte. En un diálogo, un menú, la lista de páginas o un botón de
 * un panel no hace nada. Escribiendo —un texto del lienzo o cualquier
 * campo— la tecla es del texto, y ni llega aquí (`shortcuts.ts`).
 *
 * Lo bloqueado no se borra: para eso se bloquea. Se queda seleccionado.
 */
import { applyOp } from "../commands";
import { useDocumentStore } from "../store/document";
import type { Document, Element } from "../types/model";
import type { Op } from "../types/ops";
import { useShortcut } from "./useShortcuts";

/** El comando que borra esos elementos, en un solo paso. */
export function deleteOp(ids: string[]): Op {
  const ops: Op[] = ids.map((id) => ({ op: "delete", id }));
  return ops.length === 1 && ops[0] !== undefined ? ops[0] : { op: "batch", ops };
}

/** Los de la selección que se pueden borrar y los que no, por bloqueados. */
export function splitLocked(document: Document | null, selection: string[]): { deletable: string[]; locked: string[] } {
  const locked = new Set<string>();
  const walk = (elements: Element[]) => {
    for (const element of elements) {
      if (element.locked === true) {
        locked.add(element.id);
      }
      if (element.type === "group") {
        walk(element.children);
      }
    }
  };
  for (const page of document?.pages ?? []) {
    walk(page.elements);
  }
  return {
    deletable: selection.filter((id) => !locked.has(id)),
    locked: selection.filter((id) => locked.has(id)),
  };
}

/** Si con el foco ahí la tecla borra elementos. */
export function deletesFrom(target: EventTarget | null): boolean {
  // Sin foco en nada, la tecla va a la ventana o a la página entera.
  if (!(target instanceof Element) || target === document.body || target === document.documentElement) {
    return true;
  }
  return target.closest('[role="application"], .layers') !== null;
}

export function useDelete(): void {
  useShortcut("delete", (event) => {
    if (!deletesFrom(event.target)) {
      return false;
    }
    const { document, selection } = useDocumentStore.getState();
    const { deletable, locked } = splitLocked(document, selection);
    if (deletable.length === 0) {
      return false;
    }
    void applyOp(deleteOp(deletable))
      .then((applied) => {
        const store = useDocumentStore.getState();
        store.applyEdit(applied);
        if (locked.length > 0) {
          store.selectMany(locked);
        } else {
          store.select(null);
        }
      })
      .catch(() => undefined);
    return true;
  });
}
