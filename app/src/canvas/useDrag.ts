/**
 * Mover el elemento seleccionado arrastrándolo, de forma optimista.
 *
 * Durante el arrastre **no se recompila nada**: se mueve una copia recortada
 * del render que ya se ve (`DragGhost.tsx`) y el contorno. Así el arrastre va
 * fluido aunque compilar tarde. Al soltar se manda un único
 * `Op::Move { dx, dy }` al núcleo, que recompila una vez.
 *
 * Entre soltar y que llegue la compilación nueva, la copia se queda donde se
 * soltó: el elemento no vuelve un momento a su sitio antiguo. Se quita en
 * cuanto llegan las cajas (o el error) de esa revisión.
 *
 * - Esc durante el arrastre lo cancela: no se manda nada.
 * - Shift fija el movimiento en horizontal o en vertical.
 */
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { applyOp } from "../commands";
import { useCompilationStore } from "../store/compilation";
import { useDocumentStore } from "../store/document";
import { useLayoutStore } from "../store/layout";
import { type Delta, dragDelta, isStill, roundMm } from "./dragGeometry";

export type DragState =
  | { phase: "idle" }
  /** Arrastrando: el elemento y cuánto se ha movido, en mm. */
  | { phase: "dragging"; id: string; delta: Delta }
  /**
   * Soltado: esperando a que el núcleo aplique el cambio (`revision` null)
   * y a que llegue su compilación.
   */
  | { phase: "committing"; id: string; delta: Delta; revision: number | null };

const idle: DragState = { phase: "idle" };

export interface Drag {
  state: DragState;
  /** Empieza a arrastrar `id` desde ese punto de la pantalla. */
  start: (id: string, clientX: number, clientY: number) => void;
}

/** @param pxPerMm La escala del lienzo, o `null` si no hay página. */
export function useDrag(pxPerMm: number | null): Drag {
  const [state, setState] = useState<DragState>(idle);
  const origin = useRef({ x: 0, y: 0 });
  const pointer = useRef({ x: 0, y: 0 });
  const shift = useRef(false);

  const update = useEffectEvent(() => {
    if (state.phase !== "dragging" || pxPerMm === null) {
      return;
    }
    setState({ ...state, delta: dragDelta(origin.current, pointer.current, pxPerMm, shift.current) });
  });

  const commit = useEffectEvent(() => {
    if (state.phase !== "dragging") {
      return;
    }
    const { id, delta } = state;
    if (isStill(delta)) {
      setState(idle);
      return;
    }
    setState({ phase: "committing", id, delta, revision: null });
    applyOp({ op: "move", id, dx: roundMm(delta.dx), dy: roundMm(delta.dy) })
      .then((applied) => {
        useDocumentStore.getState().replaceDocument(applied.document);
        setState((current) =>
          current.phase === "committing" && current.id === id
            ? { ...current, revision: applied.revision }
            : current,
        );
      })
      .catch(() => setState(idle));
  });

  // Mientras se arrastra, el puntero y las teclas se escuchan en la ventana:
  // así sigue aunque el puntero salga del lienzo.
  const dragging = state.phase === "dragging";
  useEffect(() => {
    if (!dragging) {
      return;
    }
    const move = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
      shift.current = event.shiftKey;
      update();
    };
    const up = () => commit();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setState(idle);
      } else if (event.key === "Shift") {
        shift.current = event.type === "keydown";
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
  }, [dragging]);

  // Tras soltar: en cuanto llega lo compilado con el cambio, la copia sobra.
  const layoutRevision = useLayoutStore((layout) => layout.revision);
  const compilation = useCompilationStore((compiled) =>
    compiled.status === "error" ? compiled.revision : null,
  );
  useEffect(() => {
    if (state.phase !== "committing" || state.revision === null) {
      return;
    }
    const arrived = [layoutRevision, compilation].some(
      (revision) => revision !== null && state.revision !== null && revision >= state.revision,
    );
    if (arrived) {
      setState(idle);
    }
  }, [state, layoutRevision, compilation]);

  return {
    state,
    start: (id, clientX, clientY) => {
      origin.current = { x: clientX, y: clientY };
      pointer.current = { x: clientX, y: clientY };
      shift.current = false;
      setState({ phase: "dragging", id, delta: { dx: 0, dy: 0 } });
    },
  };
}
