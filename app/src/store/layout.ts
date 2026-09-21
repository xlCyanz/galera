/**
 * La caja real de cada elemento, tal como la compuso Typst, indexada por id.
 *
 * Llega con cada compilación que sale bien (`compilation:finish`, ver
 * `hooks/useCompilation.ts`) y la usa la capa de controles para dibujarse
 * encima del render sin pedir nada al backend. Son las cajas **de la última
 * compilación buena**: con errores se conservan, igual que sus páginas, para
 * que lo que se ve y lo que se puede señalar sigan coincidiendo.
 *
 * Están en mm; pasarlas a píxeles se hace con `canvas/transform.ts`.
 */
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

import type { CellBox, LayoutBox } from "../types/layout";

export interface LayoutState {
  /** La revisión del documento de la que salen las cajas. */
  revision: number | null;
  /** Por debajo de esta revisión, las cajas son de otro documento. */
  minRevision: number;
  /** Las cajas, por id de elemento. */
  boxes: Record<string, LayoutBox>;
  /**
   * Dónde quedó cada celda de cada tabla, en el orden en que se componen.
   *
   * No van por id porque una celda no lo tiene: se dice por su tabla, su
   * fila y su columna de la rejilla.
   */
  cells: CellBox[];

  /** Guarda las cajas de una compilación. Ignora las de revisiones viejas. */
  update: (revision: number, boxes: readonly LayoutBox[], cells?: readonly CellBox[]) => void;
  /**
   * Se ha abierto un documento con esta revisión: las cajas de antes dejan
   * de valer, salvo que ya hayan llegado las suyas.
   */
  expect: (revision: number) => void;
  /** Olvida todas las cajas. */
  reset: () => void;
}

export const useLayoutStore = create<LayoutState>()((set, get) => ({
  revision: null,
  minRevision: 0,
  boxes: {},
  cells: [],

  update: (revision, boxes, cells = []) => {
    const state = get();
    if (revision < Math.max(state.minRevision, state.revision ?? 0)) {
      return;
    }
    set({
      revision,
      boxes: Object.fromEntries(boxes.map((box) => [box.id, box])),
      cells: [...cells],
    });
  },

  expect: (revision) => {
    const state = get();
    if (state.revision !== null && state.revision >= revision) {
      set({ minRevision: revision });
      return;
    }
    set({ revision: null, minRevision: revision, boxes: {}, cells: [] });
  },

  reset: () => set({ revision: null, minRevision: 0, boxes: {}, cells: [] }),
}));

/** La caja de un elemento, o `null` si no la hay. */
export const useElementBox = (id: string | null) =>
  useLayoutStore((state) => (id === null ? null : (state.boxes[id] ?? null)));

/** Las cajas de una página, en el orden en que se dibujan. */
export const usePageBoxes = (page: number) =>
  useLayoutStore(useShallow((state) => Object.values(state.boxes).filter((box) => box.page === page)));

/**
 * Las cajas de la página cuyo contenido no cabe, para avisarlo encima del
 * elemento (`canvas/OverflowNotice.tsx`). Lo mide el núcleo al componer.
 */
export const useOverflowing = (page: number): LayoutBox[] =>
  useLayoutStore(
    useShallow((state) =>
      Object.values(state.boxes).filter((box) => box.page === page && box.overflow > 0),
    ),
  );
