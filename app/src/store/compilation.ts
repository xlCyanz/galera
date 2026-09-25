/**
 * El estado de la compilación: si se está compilando, el último resultado y
 * sus diagnósticos.
 *
 * Lo alimentan los eventos de la compilación en segundo plano
 * (`hooks/useCompilation.ts`), no las respuestas de los comandos.
 *
 * # Estados
 *
 * - `idle`: no se ha pedido nada, o se ha cerrado el documento.
 * - `compiling`: hay una compilación en curso.
 * - `ready`: la última compilación salió bien.
 * - `error`: la última compilación falló.
 *
 * Mientras se compila y cuando hay error, **se conservan las páginas de la
 * última compilación buena**: el lienzo sigue enseñando algo en vez de
 * quedarse en blanco mientras se escribe.
 *
 * # Resultados que llegan tarde
 *
 * Cada evento trae la revisión del documento de la que sale. Se ignora todo
 * evento de una revisión anterior a la ya guardada, o a la del documento que
 * se acaba de abrir (`expect`): correspondería a un documento que ya no es
 * el que hay.
 *
 * # Solo las páginas que cambian
 *
 * Cada resultado trae la huella de todas las páginas, pero el SVG solo de
 * las que no se tenían: el resto llega como `null` y se toma de lo guardado,
 * si en ese sitio había una página con esa misma huella (#208). Si falta
 * alguna —la interfaz se ha recargado, o se ignoró un resultado que llegó
 * tarde—, `finish` lo dice y quien escucha pide que se reenvíen todas.
 */
import { create } from "zustand";

import type {
  CommandError,
  CompilationFailed,
  CompilationFinished,
  CompilationStarted,
} from "../commands";
import type { Diagnostic } from "../types/diagnostic";

export type CompilationStatus = "idle" | "compiling" | "ready" | "error";

export interface CompilationState {
  status: CompilationStatus;
  /** La revisión del documento del último resultado guardado. */
  revision: number | null;
  /** Por debajo de esta revisión, los eventos son de otro documento. */
  minRevision: number;
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
  /** La huella de cada una de esas páginas. */
  keys: string[];

  /** `compilation:start`. Conserva el último resultado. */
  start: (event: CompilationStarted) => void;
  /**
   * `compilation:finish`. Devuelve `false` si le falta el SVG de alguna
   * página: entonces hay que pedir que se reenvíen todas.
   */
  finish: (event: CompilationFinished) => boolean;
  /** `compilation:error`. Conserva las páginas buenas. */
  fail: (event: CompilationFailed) => void;
  /**
   * Se ha abierto un documento con esta revisión: lo de antes deja de valer.
   * Si su resultado ya llegó (la compilación puede ser más rápida que la
   * respuesta a `open_project`), se conserva.
   */
  expect: (revision: number) => void;
  /** Vuelve al principio: sin resultado ni páginas. */
  reset: () => void;
}

const empty = {
  status: "idle",
  revision: null,
  minRevision: 0,
  ms: null,
  reused: false,
  diagnostics: [],
  error: null,
  pages: [],
  keys: [],
} satisfies Partial<CompilationState>;

export const useCompilationStore = create<CompilationState>()((set, get) => {
  /** Si un evento de esa revisión llega tarde. */
  const isStale = (revision: number) => {
    const state = get();
    return revision < Math.max(state.minRevision, state.revision ?? 0);
  };

  return {
    ...empty,

    start: ({ revision }) => {
      if (!isStale(revision)) {
        set({ status: "compiling" });
      }
    },

    finish: (event) => {
      if (isStale(event.revision)) {
        return true;
      }
      const state = get();
      let complete = true;
      const pages = event.pages.map((svg, index) => {
        if (svg !== null) {
          return svg;
        }
        const kept = state.keys[index] === event.keys[index] ? state.pages[index] : undefined;
        if (kept === undefined) {
          complete = false;
          // Mientras llega, lo que hubiera en ese sitio: mejor que nada.
          return state.pages[index] ?? "";
        }
        return kept;
      });
      set({
        status: "ready",
        revision: event.revision,
        ms: event.ms,
        reused: event.reused,
        diagnostics: event.diagnostics,
        error: null,
        pages,
        keys: event.keys,
      });
      return complete;
    },

    fail: (event) => {
      if (isStale(event.revision)) {
        return;
      }
      set({
        status: "error",
        revision: event.revision,
        ms: event.ms,
        reused: event.reused,
        diagnostics: event.diagnostics,
        error: event.error,
      });
    },

    expect: (revision) => {
      const state = get();
      if (state.revision !== null && state.revision >= revision) {
        set({ minRevision: revision });
        return;
      }
      set({ ...empty, status: "compiling", minRevision: revision });
    },

    reset: () => set({ ...empty }),
  };
});

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
