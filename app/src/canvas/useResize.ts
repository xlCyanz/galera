/**
 * Redimensionar el elemento seleccionado con sus ocho manejadores, con el
 * mismo esquema optimista que mover (`useDrag.ts`).
 *
 * Mientras se arrastra no se recompila: el contorno y los manejadores se
 * dibujan ya con la caja nueva, con sus medidas al lado. Al soltar se manda
 * un único `Op::Resize`, y la vista previa se queda hasta que llega lo
 * compilado con el cambio. Los cálculos están en `resizeGeometry.ts`.
 *
 * - Shift mantiene la proporción; Alt redimensiona desde el centro.
 * - Esc cancela.
 * - Si el alto lo decide Typst (`h: null`), los manejadores laterales solo
 *   cambian el ancho y el alto sigue siendo automático; los demás lo fijan.
 */
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { applyOp } from "../commands";
import { useCompilationStore } from "../store/compilation";
import { useDocumentStore } from "../store/document";
import { useLayoutStore } from "../store/layout";
import { roundMm } from "./dragGeometry";
import type { ResizeHandle } from "./handleGeometry";
import { type Box, changesHeight, resizeBox } from "./resizeGeometry";

export type ResizeState =
  | { phase: "idle" }
  | { phase: "resizing"; id: string; handle: ResizeHandle; start: Box; box: Box; autoHeight: boolean }
  | {
      phase: "committing";
      id: string;
      handle: ResizeHandle;
      start: Box;
      box: Box;
      autoHeight: boolean;
      revision: number | null;
    };

const idle: ResizeState = { phase: "idle" };

export interface Resize {
  state: ResizeState;
  /**
   * Empieza a redimensionar.
   *
   * @param box La caja del elemento, tal como la midió Typst.
   * @param autoHeight Si el documento deja el alto a Typst (`h: null`).
   */
  start: (id: string, handle: ResizeHandle, box: Box, autoHeight: boolean, clientX: number, clientY: number) => void;
}

/** Si la caja no ha cambiado: soltar entonces no es un cambio. */
function same(a: Box, b: Box): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/** @param pxPerMm La escala del lienzo, o `null` si no hay página. */
export function useResize(pxPerMm: number | null): Resize {
  const [state, setState] = useState<ResizeState>(idle);
  const origin = useRef({ x: 0, y: 0 });
  const pointer = useRef({ x: 0, y: 0 });
  const keys = useRef({ shift: false, alt: false });

  const update = useEffectEvent(() => {
    if (state.phase !== "resizing" || pxPerMm === null) {
      return;
    }
    const dx = (pointer.current.x - origin.current.x) / pxPerMm;
    const dy = (pointer.current.y - origin.current.y) / pxPerMm;
    const box = resizeBox(state.start, state.handle, dx, dy, {
      keepRatio: keys.current.shift,
      fromCenter: keys.current.alt,
    });
    setState({ ...state, box });
  });

  const commit = useEffectEvent(() => {
    if (state.phase !== "resizing") {
      return;
    }
    const { id, handle, box, start, autoHeight } = state;
    if (same(box, start)) {
      setState(idle);
      return;
    }
    // Con alto automático, un lateral no lo fija.
    const h = autoHeight && !changesHeight(handle) ? null : box.h;
    setState({ ...state, phase: "committing", revision: null });
    applyOp({
      op: "resize",
      id,
      x: roundMm(box.x),
      y: roundMm(box.y),
      w: roundMm(box.w),
      h: h === null ? null : roundMm(h),
    })
      .then((applied) => {
        useDocumentStore.getState().applyEdit(applied);
        setState((current) =>
          current.phase === "committing" && current.id === id
            ? { ...current, revision: applied.revision }
            : current,
        );
      })
      .catch(() => setState(idle));
  });

  const resizing = state.phase === "resizing";
  useEffect(() => {
    if (!resizing) {
      return;
    }
    const move = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
      keys.current = { shift: event.shiftKey, alt: event.altKey };
      update();
    };
    const up = () => commit();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setState(idle);
      } else if (event.key === "Shift" || event.key === "Alt") {
        keys.current = { shift: event.shiftKey, alt: event.altKey };
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
      setState(idle);
    }
  }, [state, layoutRevision, failedRevision]);

  return {
    state,
    start: (id, handle, box, autoHeight, clientX, clientY) => {
      origin.current = { x: clientX, y: clientY };
      pointer.current = { x: clientX, y: clientY };
      keys.current = { shift: false, alt: false };
      setState({ phase: "resizing", id, handle, start: box, box, autoHeight });
    },
  };
}
