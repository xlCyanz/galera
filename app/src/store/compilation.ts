/**
 * El estado de la compilación: si se está compilando, el último resultado y
 * sus diagnósticos.
 *
 * # Estados
 *
 * - `idle`: no se ha pedido nada, o se ha cerrado el documento.
 * - `compiling`: hay una petición en curso.
 * - `ready`: la última compilación salió bien.
 * - `error`: la última compilación falló, o el backend rechazó la petición.
 *
 * Mientras se compila y cuando hay error, **se conservan las páginas de la
 * última compilación buena**: el lienzo sigue enseñando algo en vez de
 * quedarse en blanco mientras se escribe.
 *
 * # Respuestas que llegan tarde
 *
 * Cada resultado trae la revisión del documento de la que sale. Si llega uno
 * de una revisión anterior a la ya guardada, se ignora: correspondería a un
 * documento que ya no es el que hay.
 */
import { create } from "zustand";

import { type CommandError, type RenderedPage, isCommandError, renderPage } from "../commands";
import type { Diagnostic } from "../types/diagnostic";

export type CompilationStatus = "idle" | "compiling" | "ready" | "error";

export interface CompilationState {
  status: CompilationStatus;
  /** La revisión del documento del último resultado guardado. */
  revision: number | null;
  /** Lo que tardó la última compilación, en milisegundos. */
  ms: number | null;
  /** Si el último resultado salió de una compilación anterior. */
  reused: boolean;
  /** Los avisos si compiló; los errores de Typst si no. */
  diagnostics: Diagnostic[];
  /** Por qué falló, si falló. */
  error: CommandError | null;
  /** El SVG de cada página de la última compilación buena. */
  pages: string[];

  /** Empieza una compilación. Conserva el último resultado. */
  start: () => void;
  /** Guarda lo que devolvió el backend para todas las páginas pedidas. */
  finish: (rendered: readonly RenderedPage[]) => void;
  /** Guarda que el backend rechazó la petición. */
  fail: (error: CommandError) => void;
  /** Vuelve al principio: sin resultado ni páginas. */
  reset: () => void;
}

export const useCompilationStore = create<CompilationState>()((set, get) => ({
  status: "idle",
  revision: null,
  ms: null,
  reused: false,
  diagnostics: [],
  error: null,
  pages: [],

  start: () => set({ status: "compiling" }),

  finish: (rendered) => {
    const first = rendered[0];
    if (first === undefined) {
      set({ status: "ready", diagnostics: [], error: null, pages: [] });
      return;
    }

    const { revision } = get();
    if (revision !== null && first.revision < revision) {
      return;
    }

    // Todas las páginas de una petición salen de la misma compilación.
    const common = {
      revision: first.revision,
      ms: first.ms,
      reused: rendered.every((page) => page.reused),
      diagnostics: first.diagnostics,
    };
    const svgs = rendered.map((page) => page.svg);

    if (first.error !== null || !svgs.every((svg) => svg !== null)) {
      set({ ...common, status: "error", error: first.error });
    } else {
      set({ ...common, status: "ready", error: null, pages: svgs });
    }
  },

  fail: (error) => set({ status: "error", error, diagnostics: [] }),

  reset: () =>
    set({
      status: "idle",
      revision: null,
      ms: null,
      reused: false,
      diagnostics: [],
      error: null,
      pages: [],
    }),
}));

/**
 * Compila el documento abierto y guarda el resultado en el store: pide todas
 * las páginas a la vez, y el backend compila una sola vez.
 *
 * `render` se puede sustituir en las pruebas.
 */
export async function compileOpenDocument(
  pageCount: number,
  render: (page: number) => Promise<RenderedPage> = renderPage,
): Promise<void> {
  const store = useCompilationStore.getState();
  store.start();
  try {
    const pages = Array.from({ length: pageCount }, (_, index) => index);
    store.finish(await Promise.all(pages.map((page) => render(page))));
  } catch (reason) {
    store.fail(
      isCommandError(reason)
        ? reason
        : { kind: "unknown", message: reason instanceof Error ? reason.message : String(reason) },
    );
  }
}

// Selectores: ver `store/document.ts`.

/** En qué estado está la compilación. */
export const useCompilationStatus = () => useCompilationStore((state) => state.status);
/** Lo que tardó la última compilación. */
export const useCompilationMs = () => useCompilationStore((state) => state.ms);
/** Si el último resultado salió de una compilación anterior. */
export const useCompilationReused = () => useCompilationStore((state) => state.reused);
/** Los diagnósticos de la última compilación. */
export const useDiagnostics = () => useCompilationStore((state) => state.diagnostics);
/** Por qué falló la última compilación. */
export const useCompilationError = () => useCompilationStore((state) => state.error);
/** Las páginas de la última compilación buena. */
export const useRenderedPages = () => useCompilationStore((state) => state.pages);
