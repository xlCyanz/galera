/**
 * Girar el elemento seleccionado con el manejador de rotación, con el mismo
 * esquema optimista que mover (`useDrag.ts`) y redimensionar
 * (`useResize.ts`).
 *
 * El giro es alrededor del centro del elemento, igual que el que emite el
 * codegen (`rotate(…, origin: center + horizon)`), así que la caja sin girar
 * no cambia: solo el ángulo. Mientras se gira no se recompila: el contorno y
 * una copia del render giran ya con el ángulo nuevo, que se enseña al lado.
 * Al soltar se manda un único `Op::Rotate`, y la vista previa se queda hasta
 * que llega lo compilado con el cambio. Las cuentas están en
 * `rotateGeometry.ts`.
 *
 * - Shift fija el ángulo en múltiplos de 15°.
 * - Esc cancela.
 */
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { applyOp } from "../commands";
import { useCompilationStore } from "../store/compilation";
import { useDocumentStore } from "../store/document";
import { useLayoutStore } from "../store/layout";
import { type Point, rotationFor, sameRotation } from "./rotateGeometry";

export type RotateState =
  | { phase: "idle" }
  /** Girando: el giro de partida y el de ahora, en grados. */
  | { phase: "rotating"; id: string; start: number; rotation: number }
  /**
   * Soltado: esperando a que el núcleo aplique el cambio (`revision` null)
   * y a que llegue su compilación.
   */
  | { phase: "committing"; id: string; start: number; rotation: number; revision: number | null };

const idle: RotateState = { phase: "idle" };

export interface Rotate {
  state: RotateState;
  /**
   * Empieza a girar.
   *
   * @param rotation El giro del elemento, tal como lo midió Typst.
   * @param center El centro del elemento en la pantalla (coordenadas de
   *   cliente): el punto alrededor del que gira el puntero.
   */
  start: (id: string, rotation: number, center: Point, clientX: number, clientY: number) => void;
}

export function useRotate(): Rotate {
  const [state, setState] = useState<RotateState>(idle);
  const center = useRef<Point>({ x: 0, y: 0 });
  const origin = useRef<Point>({ x: 0, y: 0 });
  const pointer = useRef<Point>({ x: 0, y: 0 });
  const shift = useRef(false);

  const update = useEffectEvent(() => {
    if (state.phase !== "rotating") {
      return;
    }
    const rotation = rotationFor(state.start, center.current, origin.current, pointer.current, shift.current);
    setState({ ...state, rotation });
  });

  const commit = useEffectEvent(() => {
    if (state.phase !== "rotating") {
      return;
    }
    const { id, start, rotation } = state;
    if (sameRotation(start, rotation)) {
      setState(idle);
      return;
    }
    setState({ ...state, phase: "committing", revision: null });
    applyOp({ op: "rotate", id, rotation })
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

  // Mientras se gira, el puntero y las teclas se escuchan en la ventana:
  // así sigue aunque el puntero salga del lienzo.
  const rotating = state.phase === "rotating";
  useEffect(() => {
    if (!rotating) {
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
  }, [rotating]);

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
    start: (id, rotation, at, clientX, clientY) => {
      center.current = at;
      origin.current = { x: clientX, y: clientY };
      pointer.current = { x: clientX, y: clientY };
      shift.current = false;
      setState({ phase: "rotating", id, start: rotation, rotation });
    },
  };
}
