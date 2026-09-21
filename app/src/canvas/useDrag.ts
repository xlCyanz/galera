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
 * - ⌘ desactiva el ajuste a las guías mientras se tenga pulsado.
 *
 * # El ajuste
 *
 * A dónde se engancha lo decide el núcleo (`useSnap.ts`). El elemento sigue
 * al ratón sin esperar la respuesta; cuando llega, se suma al movimiento y
 * salen las guías. Lo que se manda al soltar es lo que se estaba viendo,
 * enganchado incluido.
 */
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { applyOp } from "../commands";
import { useCompilationStore } from "../store/compilation";
import { useDocumentStore } from "../store/document";
import { useLayoutStore } from "../store/layout";
import type { MmRect } from "../types/layout";
import type { Guide } from "../types/snap";
import { type Delta, dragDelta, isStill, roundMm } from "./dragGeometry";
import { WHOLE, snapOff, snapSettings } from "./snapping";
import { useSnap } from "./useSnap";

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
  /** Las guías del ajuste, mientras se arrastra. */
  guides: Guide[];
  /** Empieza a arrastrar `id` desde ese punto de la pantalla. */
  start: (id: string, clientX: number, clientY: number) => void;
}

/**
 * @param pxPerMm La escala del lienzo, o `null` si no hay página.
 * @param page La página visible, contando desde 0.
 */
export function useDrag(pxPerMm: number | null, page: number): Drag {
  const [state, setState] = useState<DragState>(idle);
  const origin = useRef({ x: 0, y: 0 });
  const pointer = useRef({ x: 0, y: 0 });
  const shift = useRef(false);
  const meta = useRef(false);
  /** La caja del elemento al empezar: sobre ella se pregunta el ajuste. */
  const from = useRef<MmRect | null>(null);
  const snapping = useSnap();

  /** Dónde tiene el ratón la caja, sin ajustar. */
  const draggedTo = (delta: Delta): MmRect | null => {
    const box = from.current;
    return box === null ? null : { ...box, x: box.x + delta.dx, y: box.y + delta.dy };
  };

  // Lo que se ve: el movimiento del ratón más lo que haya enganchado.
  const raw = state.phase === "idle" ? { dx: 0, dy: 0 } : state.delta;
  const proposed = state.phase === "idle" ? null : draggedTo(raw);
  const snapped = proposed === null ? null : snapping.at(proposed);
  const delta: Delta =
    snapped === null ? raw : { dx: raw.dx + snapped.dx, dy: raw.dy + snapped.dy };

  const update = useEffectEvent(() => {
    if (state.phase !== "dragging" || pxPerMm === null) {
      return;
    }
    const moved = dragDelta(origin.current, pointer.current, pxPerMm, shift.current);
    setState({ ...state, delta: moved });
    const rect = draggedTo(moved);
    if (meta.current || rect === null) {
      // Con ⌘ no se ajusta: ni enganche ni guías.
      snapping.clear();
      return;
    }
    snapping.ask(page, state.id, rect, WHOLE, snapSettings(pxPerMm));
  });

  const stop = () => {
    snapping.clear();
    setState(idle);
  };

  const commit = useEffectEvent(() => {
    if (state.phase !== "dragging") {
      return;
    }
    const { id } = state;
    if (isStill(delta)) {
      stop();
      return;
    }
    // Lo que se manda es lo que se veía, enganche incluido; a partir de
    // aquí el ajuste ya no pinta nada y las guías se van.
    setState({ phase: "committing", id, delta, revision: null });
    snapping.clear();
    applyOp({ op: "move", id, dx: roundMm(delta.dx), dy: roundMm(delta.dy) })
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
      meta.current = snapOff(event);
      update();
    };
    const up = () => commit();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        stop();
      } else if (event.key === "Shift" || event.key === "Meta") {
        shift.current = event.shiftKey;
        meta.current = snapOff(event);
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
      stop();
    }
  }, [state, layoutRevision, compilation]);

  return {
    state: state.phase === "idle" ? state : { ...state, delta },
    guides: snapped?.guides ?? [],
    start: (id, clientX, clientY) => {
      origin.current = { x: clientX, y: clientY };
      pointer.current = { x: clientX, y: clientY };
      shift.current = false;
      meta.current = false;
      // La caja que se ve, que es sobre la que se pregunta el ajuste.
      from.current = useLayoutStore.getState().boxes[id]?.bounds ?? null;
      snapping.clear();
      setState({ phase: "dragging", id, delta: { dx: 0, dy: 0 } });
    },
  };
}
