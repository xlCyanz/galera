/**
 * Agrupar, desagrupar y entrar en un grupo.
 *
 * Un grupo es un elemento más del documento (`type: "group"`), con su caja y
 * sus hijos dentro, en coordenadas relativas a esa caja. Quién queda dentro
 * de quién y qué posición le toca a cada uno lo decide el núcleo
 * (`ops::group`, principio 5): aquí solo se manda el comando.
 *
 * - **⌘G** mete lo seleccionado en un grupo nuevo, con la caja conjunta que
 *   ya enseña el lienzo. No mueve nada de sitio.
 * - **⇧⌘G** deshace los grupos seleccionados y deja sus hijos seleccionados.
 * - **Doble clic** en un grupo entra en él: a partir de ahí el clic coge a
 *   sus hijos. Escape o pulsar fuera salen.
 *
 * Los dos comandos entran en el historial como cualquier otro cambio: ⌘Z
 * deshace un agrupado de una vez.
 */
import { applyOp } from "../commands";
import { useDocumentStore } from "../store/document";
import { useLayoutStore } from "../store/layout";
import type { Document, Element } from "../types/model";
import type { Op } from "../types/ops";
import { newElementId } from "./createGeometry";
import { boxesOf, groupBox } from "./group";

/** Cómo se llaman los grupos nuevos: `grupo-1`, `grupo-2`… */
const GROUP_KIND = "grupo";

/** El elemento con ese id, esté donde esté, incluso dentro de un grupo. */
export function elementById(document: Document, id: string): Element | undefined {
  const find = (elements: readonly Element[]): Element | undefined => {
    for (const element of elements) {
      if (element.id === id) {
        return element;
      }
      if (element.type === "group") {
        const deeper = find(element.children);
        if (deeper !== undefined) {
          return deeper;
        }
      }
    }
    return undefined;
  };
  return find(document.pages.flatMap((page) => page.elements));
}

/** Si ese elemento del documento es un grupo. */
export function isGroup(document: Document | null, id: string | null): boolean {
  if (document === null || id === null) {
    return false;
  }
  return elementById(document, id)?.type === "group";
}

/**
 * Mete lo seleccionado en un grupo nuevo. Devuelve `false` si no hay nada
 * que agrupar: hacen falta al menos dos elementos con caja en la página.
 */
export function groupSelection(page: number): boolean {
  const store = useDocumentStore.getState();
  const { document, selection } = store;
  if (document === null || selection.length < 2) {
    return false;
  }
  const rect = groupBox(boxesOf(useLayoutStore.getState().boxes, selection, page));
  if (rect === null) {
    return false;
  }
  const id = newElementId(document, GROUP_KIND);
  void applyOp({ op: "group", ids: [...selection], id, rect })
    .then((applied) => {
      useDocumentStore.getState().applyEdit(applied);
      useDocumentStore.getState().select(id);
    })
    .catch(() => {
      // Si el núcleo no lo acepta, la selección se queda como estaba.
    });
  return true;
}

/**
 * Deshace los grupos que haya seleccionados y deja seleccionado lo que
 * llevaban dentro. Devuelve `false` si no hay ninguno.
 */
export function ungroupSelection(): boolean {
  const { document, selection } = useDocumentStore.getState();
  if (document === null) {
    return false;
  }
  const groups = selection
    .map((id) => elementById(document, id))
    .filter((element) => element?.type === "group");
  if (groups.length === 0) {
    return false;
  }
  const freed = groups.flatMap((group) => group.children.map((child) => child.id));
  const ops: Op[] = groups.map((group) => ({ op: "ungroup", id: group.id }));
  void applyOp(ops.length === 1 && ops[0] !== undefined ? ops[0] : { op: "batch", ops })
    .then((applied) => {
      useDocumentStore.getState().applyEdit(applied);
      useDocumentStore.getState().selectMany(freed);
    })
    .catch(() => {
      // Si el núcleo no lo acepta, no cambia nada.
    });
  return true;
}
