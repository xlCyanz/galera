/**
 * Redimensionar lo seleccionado con sus ocho manejadores, con el mismo
 * esquema optimista que mover (`useDrag.ts`).
 *
 * Con varios elementos se estira **la caja conjunta**, y el núcleo reparte
 * el estirón entre ellos (`scale_group`): un solo comando, una sola
 * compilación y un solo paso del historial.
 *
 * Mientras se arrastra no se recompila: el contorno y los manejadores se
 * dibujan ya con la caja nueva, con sus medidas al lado. Al soltar se manda
 * un único `Op::Resize`, y la vista previa se queda hasta que llega lo
 * compilado con el cambio. Los cálculos están en `resizeGeometry.ts`.
 *
 * - Shift mantiene la proporción; Alt redimensiona desde el centro. Con
 *   cualquiera de los dos no se ajusta a las guías: manda la forma que se
 *   está imponiendo, no el enganche.
 * - ⌘ desactiva el ajuste mientras se tenga pulsado. Un elemento girado
 *   tampoco se ajusta: lo que se ve no es su caja, sino la que la contiene.
 * - Esc cancela.
 * - Si el alto lo decide Typst (`h: null`), los manejadores laterales solo
 *   cambian el ancho y el alto sigue siendo automático; los demás lo fijan.
 */
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { applyOp, scaleGroup } from "../commands";
import { useCompilationStore } from "../store/compilation";
import { useDocumentStore } from "../store/document";
import { useLayoutStore } from "../store/layout";
import type { Guide } from "../types/snap";
import { roundMm } from "./dragGeometry";
import type { ResizeHandle } from "./handleGeometry";
import { type Box, changesHeight, resizeBox } from "./resizeGeometry";
import { gripsFor, snapOff, snapSettings } from "./snapping";
import { useSnap } from "./useSnap";

export type ResizeState =
  | { phase: "idle" }
  | {
      phase: "resizing";
      id: string;
      /** Todos los que se estiran: uno, o los de la multiselección. */
      ids: string[];
      handle: ResizeHandle;
      start: Box;
      box: Box;
      autoHeight: boolean;
    }
  | {
      phase: "committing";
      id: string;
      ids: string[];
      handle: ResizeHandle;
      start: Box;
      box: Box;
      autoHeight: boolean;
      revision: number | null;
    };

const idle: ResizeState = { phase: "idle" };

export interface Resize {
  state: ResizeState;
  /** Las guías del ajuste, mientras se redimensiona. */
  guides: Guide[];
  /**
   * Empieza a redimensionar.
   *
   * @param ids Lo que se estira: un elemento, o todos los de la
   *   multiselección, y entonces `box` es la caja conjunta.
   * @param box La caja, tal como la midió Typst.
   * @param autoHeight Si el documento deja el alto a Typst (`h: null`).
   */
  start: (
    ids: readonly string[],
    handle: ResizeHandle,
    box: Box,
    autoHeight: boolean,
    clientX: number,
    clientY: number,
  ) => void;
}

/** Si la caja no ha cambiado: soltar entonces no es un cambio. */
function same(a: Box, b: Box): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/**
 * @param pxPerMm La escala del lienzo, o `null` si no hay página.
 * @param page La página visible, contando desde 0.
 */
export function useResize(pxPerMm: number | null, page: number): Resize {
  const [state, setState] = useState<ResizeState>(idle);
  const origin = useRef({ x: 0, y: 0 });
  const pointer = useRef({ x: 0, y: 0 });
  const keys = useRef({ shift: false, alt: false, meta: false });
  const snapping = useSnap();

  // Lo que se ve: la caja que sale del ratón, o la enganchada si ya ha
  // contestado el núcleo para ella.
  const snapped = state.phase === "idle" ? null : snapping.at(state.box);
  const box: Box | null =
    state.phase === "idle" ? null : snapped === null ? state.box : { ...state.box, ...snapped.rect };

  const update = useEffectEvent(() => {
    if (state.phase !== "resizing" || pxPerMm === null) {
      return;
    }
    const dx = (pointer.current.x - origin.current.x) / pxPerMm;
    const dy = (pointer.current.y - origin.current.y) / pxPerMm;
    const pulled = resizeBox(state.start, state.handle, dx, dy, {
      keepRatio: keys.current.shift,
      fromCenter: keys.current.alt,
    });
    setState({ ...state, box: pulled });
    // Con ⌘, con la proporción fija, desde el centro o con el elemento
    // girado —su caja y la que se ve no son la misma—, no se ajusta.
    if (
      keys.current.meta ||
      keys.current.shift ||
      keys.current.alt ||
      state.start.rotation !== 0
    ) {
      snapping.clear();
      return;
    }
    snapping.ask(page, state.ids, pulled, gripsFor(state.handle), snapSettings(pxPerMm));
  });

  const stop = () => {
    snapping.clear();
    setState(idle);
  };

  const commit = useEffectEvent(() => {
    if (state.phase !== "resizing" || box === null) {
      return;
    }
    const { id, ids, handle, start, autoHeight } = state;
    if (same(box, start)) {
      stop();
      return;
    }
    // Con alto automático, un lateral no lo fija.
    const h = autoHeight && !changesHeight(handle) ? null : box.h;
    // Lo que se manda es lo que se veía, enganche incluido; a partir de
    // aquí el ajuste ya no pinta nada y las guías se van.
    setState({ ...state, phase: "committing", box, revision: null });
    snapping.clear();
    const rect = (one: Box) => ({
      x: roundMm(one.x),
      y: roundMm(one.y),
      w: roundMm(one.w),
      h: roundMm(one.h),
    });
    // Con varios, el núcleo reparte el estirón entre ellos.
    const change =
      ids.length > 1
        ? scaleGroup(ids, rect(start), rect(box))
        : applyOp({
            op: "resize",
            id,
            x: roundMm(box.x),
            y: roundMm(box.y),
            w: roundMm(box.w),
            h: h === null ? null : roundMm(h),
          });
    change
      .then((applied) => {
        useDocumentStore.getState().applyEdit(applied);
        setState((current) =>
          current.phase === "committing" && current.id === id
            ? { ...current, revision: applied.revision }
            : current,
        );
      })
      .catch(() => stop());
  });

  const resizing = state.phase === "resizing";
  useEffect(() => {
    if (!resizing) {
      return;
    }
    const move = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
      keys.current = { shift: event.shiftKey, alt: event.altKey, meta: snapOff(event) };
      update();
    };
    const up = () => commit();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        stop();
      } else if (event.key === "Shift" || event.key === "Alt" || event.key === "Meta") {
        keys.current = { shift: event.shiftKey, alt: event.altKey, meta: snapOff(event) };
        update();
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
    };
  }, [resizing]);

  // Tras soltar: en cuanto llega lo compilado con el cambio, la vista previa sobra.
  const layoutRevision = useLayoutStore((layout) => layout.revision);
  const failedRevision = useCompilationStore((compiled) =>
    compiled.status === "error" ? compiled.revision : null,
  );
  useEffect(() => {
    if (state.phase !== "committing" || state.revision === null) {
      return;
    }
    const revision = state.revision;
    if ([layoutRevision, failedRevision].some((arrived) => arrived !== null && arrived >= revision)) {
      stop();
    }
  }, [state, layoutRevision, failedRevision]);

  return {
    state: state.phase === "idle" || box === null ? state : { ...state, box },
    guides: snapped?.guides ?? [],
    start: (ids, handle, box, autoHeight, clientX, clientY) => {
      const id = ids[0];
      if (id === undefined) {
        return;
      }
      origin.current = { x: clientX, y: clientY };
      pointer.current = { x: clientX, y: clientY };
      keys.current = { shift: false, alt: false, meta: false };
      snapping.clear();
      setState({ phase: "resizing", id, ids: [...ids], handle, start: box, box, autoHeight });
    },
  };
}
