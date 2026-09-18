/**
 * El documento abierto y cómo se está mirando: página actual, zoom y
 * desplazamiento.
 *
 * El documento que se guarda aquí es **una copia para leer**: la fuente de
 * verdad es el backend (principio 1). Los cambios van al backend como
 * comandos y vuelven aquí (`applyEdit`), no al revés. Con ellos llega qué se
 * puede deshacer y rehacer: el historial también vive en el backend.
 *
 * # Suscribirse con selectores
 *
 * Los componentes no leen el store entero: usan los selectores de abajo
 * (`useZoom`, `useCurrentPage`…) o `useDocumentStore(selector)`. Así un
 * componente solo vuelve a renderizar cuando cambia lo que usa: mover el
 * lienzo no repinta la barra que enseña el zoom.
 */
import { create } from "zustand";

import { findElement } from "../canvas/elements";
import type { AppliedOp, OpenedProject } from "../commands";
import type { Document } from "../types/model";

/** El zoom mínimo: 25 %. */
export const MIN_ZOOM = 0.25;
/** El zoom máximo: 800 %. */
export const MAX_ZOOM = 8;

/**
 * Un desplazamiento del lienzo, en píxeles CSS: cuánto se ha movido la
 * página desde su posición centrada.
 */
export interface Scroll {
  x: number;
  y: number;
}

export interface DocumentState {
  /** El documento abierto, o `null` si no hay ninguno. */
  document: Document | null;
  /** La carpeta del proyecto abierto. */
  root: string | null;
  /** La página visible, contando desde 0. */
  currentPage: number;
  /** El zoom: 1 es el 100 %. Siempre entre `MIN_ZOOM` y `MAX_ZOOM`. */
  zoom: number;
  /** Cuánto se ha movido la página desde el centro, en píxeles CSS. */
  scroll: Scroll;
  /** Si se ven las reglas. Es de quien mira: no cambia al abrir otro documento. */
  rulersVisible: boolean;
  /**
   * El elemento resaltado en el lienzo, por ejemplo al llegar a él desde un
   * error. Hasta que haya selección (Fase 2), es la forma de señalarlo.
   */
  highlightedElement: string | null;
  /** El elemento seleccionado, o `null` si no hay ninguno. */
  selectedElement: string | null;
  /** Qué se desharía y rehacería ahora, según el backend: «Mover r1». */
  history: EditHistory;
  /**
   * Cuántas veces se ha pedido llevar el lienzo a un elemento. El lienzo
   * mira este número: cada vez que cambia, centra el elemento resaltado.
   */
  focusRequests: number;

  /**
   * Guarda un proyecto recién abierto. Vuelve a la primera página y quita el
   * desplazamiento; el zoom se conserva, porque es de quien mira y no del
   * documento.
   */
  open: (opened: OpenedProject) => void;
  /** Olvida el documento abierto. */
  close: () => void;
  /**
   * Sustituye el documento abierto por su versión nueva tras un comando de
   * edición. Conserva la página, el zoom, el desplazamiento y la selección,
   * salvo lo que ya no exista.
   */
  replaceDocument: (document: Document) => void;
  /**
   * Guarda lo que devolvió el backend al aplicar, deshacer o rehacer: el
   * documento nuevo (como `replaceDocument`) y el estado del historial.
   */
  applyEdit: (applied: AppliedOp) => void;
  /** Cambia la página visible, sin salirse de las que hay. */
  setCurrentPage: (page: number) => void;
  /** Cambia el zoom, dentro de sus límites. */
  setZoom: (zoom: number) => void;
  /** Coloca el lienzo en un desplazamiento. */
  setScroll: (scroll: Scroll) => void;
  /** Desplaza el lienzo desde donde está. */
  scrollBy: (dx: number, dy: number) => void;
  /**
   * Cambia zoom y desplazamiento a la vez, en un solo render: es lo que
   * hace el zoom hacia el puntero.
   */
  setView: (zoom: number, scroll: Scroll) => void;
  /** Enseña u oculta las reglas. */
  toggleRulers: () => void;
  /**
   * Lleva el lienzo a un elemento: cambia a su página, lo resalta y pide
   * centrarlo. Devuelve `false` si no hay ningún elemento con ese id.
   */
  focusElement: (id: string) => boolean;
  /** Quita el resaltado. */
  clearHighlight: () => void;
  /** Selecciona un elemento, o ninguno con `null`. */
  select: (id: string | null) => void;
}

/** Lo que se puede deshacer y rehacer. */
export interface EditHistory {
  undo: string | null;
  redo: string | null;
}

const origin: Scroll = { x: 0, y: 0 };
const noHistory: EditHistory = { undo: null, redo: null };

export const useDocumentStore = create<DocumentState>()((set, get) => ({
  document: null,
  root: null,
  currentPage: 0,
  zoom: 1,
  scroll: origin,
  rulersVisible: true,
  highlightedElement: null,
  selectedElement: null,
  history: noHistory,
  focusRequests: 0,

  open: (opened) =>
    set({
      document: opened.document,
      root: opened.root,
      currentPage: 0,
      scroll: origin,
      highlightedElement: null,
      selectedElement: null,
      history: noHistory,
    }),

  close: () =>
    set({
      document: null,
      root: null,
      currentPage: 0,
      scroll: origin,
      highlightedElement: null,
      selectedElement: null,
      history: noHistory,
    }),

  setCurrentPage: (page) =>
    set((state) => ({
      currentPage: clampPage(page, state.document?.pages.length ?? 0),
    })),

  setZoom: (zoom) =>
    set((state) => (Number.isFinite(zoom) ? { zoom: clampZoom(zoom) } : { zoom: state.zoom })),

  setScroll: (scroll) =>
    set((state) =>
      Number.isFinite(scroll.x) && Number.isFinite(scroll.y)
        ? { scroll: { x: scroll.x, y: scroll.y } }
        : { scroll: state.scroll },
    ),

  scrollBy: (dx, dy) =>
    set((state) =>
      Number.isFinite(dx) && Number.isFinite(dy)
        ? { scroll: { x: state.scroll.x + dx, y: state.scroll.y + dy } }
        : { scroll: state.scroll },
    ),

  setView: (zoom, scroll) =>
    set((state) => ({
      zoom: Number.isFinite(zoom) ? clampZoom(zoom) : state.zoom,
      scroll:
        Number.isFinite(scroll.x) && Number.isFinite(scroll.y)
          ? { x: scroll.x, y: scroll.y }
          : state.scroll,
    })),

  toggleRulers: () => set((state) => ({ rulersVisible: !state.rulersVisible })),

  replaceDocument: (document) =>
    set((state) => {
      const exists = (id: string | null) =>
        id !== null && document.pages.some((page) => page.elements.some((element) => element.id === id));
      return {
        document,
        currentPage: clampPage(state.currentPage, document.pages.length),
        selectedElement: exists(state.selectedElement) ? state.selectedElement : null,
        highlightedElement: exists(state.highlightedElement) ? state.highlightedElement : null,
      };
    }),

  applyEdit: (applied) => {
    get().replaceDocument(applied.document);
    set({ history: { undo: applied.undo, redo: applied.redo } });
  },

  focusElement: (id) => {
    const { document } = get();
    const found = document === null ? null : findElement(document, id);
    if (found === null) {
      return false;
    }
    set((state) => ({
      currentPage: found.pageIndex,
      highlightedElement: id,
      focusRequests: state.focusRequests + 1,
    }));
    return true;
  },

  clearHighlight: () => set({ highlightedElement: null }),

  select: (id) => set({ selectedElement: id }),
}));

/** Un zoom dentro de los límites. */
export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Una página que existe: entre 0 y la última, o 0 si no hay páginas. */
export function clampPage(page: number, pageCount: number): number {
  if (pageCount === 0 || !Number.isFinite(page)) {
    return 0;
  }
  return Math.min(pageCount - 1, Math.max(0, Math.trunc(page)));
}

// Selectores. Cada uno devuelve un valor que solo cambia cuando cambia lo que
// representa, así que quien lo usa no se repinta por otros cambios del store.

/** El documento abierto. */
export const useOpenDocument = () => useDocumentStore((state) => state.document);
/** La carpeta del proyecto abierto. */
export const useProjectRoot = () => useDocumentStore((state) => state.root);
/** El título del documento abierto. */
export const useDocumentTitle = () => useDocumentStore((state) => state.document?.meta.title ?? null);
/** Cuántas páginas tiene el documento abierto. */
export const usePageCount = () => useDocumentStore((state) => state.document?.pages.length ?? 0);
/** La página visible. */
export const useCurrentPage = () => useDocumentStore((state) => state.currentPage);
/** El zoom. */
export const useZoom = () => useDocumentStore((state) => state.zoom);
/** El desplazamiento del lienzo. */
export const useScroll = () => useDocumentStore((state) => state.scroll);
/** Si se ven las reglas. */
export const useRulersVisible = () => useDocumentStore((state) => state.rulersVisible);
/** El elemento seleccionado. */
export const useSelectedElement = () => useDocumentStore((state) => state.selectedElement);
/** El elemento resaltado. */
export const useHighlightedElement = () => useDocumentStore((state) => state.highlightedElement);
/** Cuántas veces se ha pedido llevar el lienzo a un elemento. */
export const useFocusRequests = () => useDocumentStore((state) => state.focusRequests);
/** Qué se puede deshacer y rehacer. */
export const useEditHistory = () => useDocumentStore((state) => state.history);
