/**
 * Copiar, cortar, pegar y duplicar lo seleccionado: ⌘C, ⌘X, ⌘V y ⌘D.
 *
 * Lo copiado se queda en la aplicación, con los recursos y las fuentes que
 * necesita, y eso es lo que permite pegarlo en otro documento
 * (`commands::clipboard`). Al portapapeles del sistema va el **texto plano**
 * de lo copiado, que es lo que tiene sentido pegar fuera; lo escribe la
 * interfaz, que es quien tiene el gesto de la persona.
 *
 * - **Cortar** es copiar y borrar: un solo comando con todos los borrados,
 *   así que se deshace de una vez.
 * - **Pegar** deja los elementos desplazados unos milímetros y los deja
 *   seleccionados, para poder colocarlos a continuación.
 * - **Duplicar** hace lo mismo sin tocar lo copiado.
 *
 * Dentro de un texto, ⌘C, ⌘X y ⌘V son del texto y no llegan aquí
 * (`shortcuts.ts`).
 */
import { copyElements, duplicateElements, applyOp, pasteElements } from "../commands";
import { useDocumentStore } from "../store/document";
import type { AppliedOp } from "../commands";
import type { Document } from "../types/model";
import type { Op } from "../types/ops";
import { useShortcut } from "./useShortcuts";

/** Los ids de todo lo que hay en el documento, grupos incluidos. */
function idsOf(document: Document | null): string[] {
  const all: string[] = [];
  const walk = (elements: Document["pages"][number]["elements"]) => {
    for (const element of elements) {
      all.push(element.id);
      if (element.type === "group") {
        walk(element.children);
      }
    }
  };
  for (const page of document?.pages ?? []) {
    walk(page.elements);
  }
  return all;
}

/** Guarda el cambio y deja seleccionado lo que haya aparecido. */
function applyAndSelect(before: string[], applied: AppliedOp | null): void {
  if (applied === null) {
    return;
  }
  const store = useDocumentStore.getState();
  store.applyEdit(applied);
  const fresh = idsOf(applied.document).filter((id) => !before.includes(id));
  if (fresh.length > 0) {
    store.selectMany(fresh);
  }
}

/** Escribe el texto en el portapapeles del sistema, si se puede. */
async function toSystem(text: string): Promise<void> {
  if (text === "" || typeof navigator === "undefined") {
    return;
  }
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    // Sin permiso o sin portapapeles: lo de dentro de la app sigue valiendo.
  }
}

export function useClipboard(): void {
  const copy = () => {
    const { selection } = useDocumentStore.getState();
    if (selection.length === 0) {
      return false;
    }
    void copyElements(selection)
      .then(toSystem)
      .catch(() => undefined);
    return true;
  };

  useShortcut("copy", copy);

  useShortcut("cut", () => {
    const { selection } = useDocumentStore.getState();
    if (selection.length === 0) {
      return false;
    }
    const ops: Op[] = selection.map((id) => ({ op: "delete", id }));
    void copyElements(selection)
      .then(async (text) => {
        await toSystem(text);
        const applied = await applyOp(
          ops.length === 1 && ops[0] !== undefined ? ops[0] : { op: "batch", ops },
        );
        useDocumentStore.getState().applyEdit(applied);
        useDocumentStore.getState().select(null);
      })
      .catch(() => undefined);
    return true;
  });

  useShortcut("paste", () => {
    const { document, currentPage } = useDocumentStore.getState();
    const page = document?.pages[currentPage]?.id;
    if (page === undefined) {
      return false;
    }
    const before = idsOf(document);
    void pasteElements(page)
      .then((applied) => applyAndSelect(before, applied))
      .catch(() => undefined);
    return true;
  });

  useShortcut("duplicate", () => {
    const { document, selection } = useDocumentStore.getState();
    if (selection.length === 0) {
      return false;
    }
    const before = idsOf(document);
    void duplicateElements(selection)
      .then((applied) => applyAndSelect(before, applied))
      .catch(() => undefined);
    return true;
  });
}
