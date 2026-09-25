/**
 * Cuánto tarda una tecla en verse: de la pulsación a la página nueva
 * pintada en el lienzo (#208).
 *
 * El núcleo sabe cuánto tarda en compilar —es lo que dice la barra de
 * estado—, pero no lo que viene después: el viaje del resultado al webview,
 * decodificar la imagen de la página y pintarla. Eso es lo que nota quien
 * escribe, y solo se puede medir aquí.
 *
 * Se empieza a contar con la primera tecla que no se ha visto todavía
 * (`HiddenInput`) y se para cuando el lienzo pinta la siguiente imagen de
 * la página, un fotograma después de enseñarla (`Canvas`). Es la primera
 * repintada tras la tecla: si ya había una compilación en marcha de antes,
 * puede no llevarla todavía, y la medida sale algo corta. Para ver si
 * escribir va fluido basta; para un número exacto está el banco del núcleo
 * (`docs/rendimiento.md`).
 */
import { create } from "zustand";

export interface LatencyState {
  /** Cuándo se pulsó la primera tecla que todavía no se ve, o `null`. */
  waitingSince: number | null;
  /** Lo que tardó la última en verse, en milisegundos, o `null`. */
  last: number | null;
  /** Se ha pulsado una tecla en `at` (`performance.now()`). */
  typed: (at: number) => void;
  /** El lienzo ha pintado una imagen nueva de la página en `at`. */
  painted: (at: number) => void;
  /** Olvida lo medido: otro documento. */
  reset: () => void;
}

export const useLatencyStore = create<LatencyState>()((set) => ({
  waitingSince: null,
  last: null,
  typed: (at) => set((state) => (state.waitingSince === null ? { waitingSince: at } : {})),
  painted: (at) =>
    set((state) =>
      state.waitingSince === null ? {} : { last: Math.max(0, at - state.waitingSince), waitingSince: null },
    ),
  reset: () => set({ waitingSince: null, last: null }),
}));

/** Lo que tardó la última tecla en verse. */
export const useScreenLatency = () => useLatencyStore((state) => state.last);
