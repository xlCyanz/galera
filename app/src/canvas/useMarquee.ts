/**
 * El rectángulo de selección: arrastrar desde una zona vacía para coger
 * varios elementos.
 *
 * Mientras se arrastra solo se dibuja el rectángulo (`Marquee.tsx`); al
 * soltar se le pregunta al núcleo qué elementos toca (`elements_in`), que es
 * quien decide, igual que con el clic (principio 5). Los bloqueados no
 * entran.
 *
 * - Con ⇧ se suma a lo que ya estuviera seleccionado.
 * - Esc cancela: no cambia la selección.
 * - Un rectángulo de menos de unos píxeles es un clic en vacío, y eso ya lo
 *   atendió `useSelection`: no se pregunta nada.
 */
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { elementsIn } from "../commands";
import { useDocumentStore } from "../store/document";
import type { MmRect } from "../types/layout";
import { type CanvasTransform, toDocument } from "./transform";

/** Desde cuántos píxeles de pantalla el arrastre cuenta como rectángulo. */
export const MARQUEE_MIN_PX = 3;

export type MarqueeState =
  | { phase: "idle" }
  /** Arrastrando: el rectángulo en mm de la página. */
  | { phase: "drawing"; rect: MmRect; additive: boolean };

const idle: MarqueeState = { phase: "idle" };

export interface Marquee {
  state: MarqueeState;
  /** Empieza a dibujar desde ese punto de la pantalla. */
  start: (clientX: number, clientY: number, additive: boolean) => void;
}

/**
 * @param viewport El área del lienzo, para pasar la pantalla a milímetros.
 * @param transform Dónde está la página visible y a qué escala.
 * @param page La página visible, contando desde 0.
 */
export function useMarquee(
  viewport: { current: HTMLElement | null },
  transform: CanvasTransform | null,
  page: number,
): Marquee {
  const [state, setState] = useState<MarqueeState>(idle);
  const origin = useRef({ x: 0, y: 0 });
  const pointer = useRef({ x: 0, y: 0 });
  const moved = useRef(false);

  /** El punto de la pantalla en mm de la página. */
  const inPage = (clientX: number, clientY: number) => {
    const area = viewport.current?.getBoundingClientRect();
    if (transform === null || area === undefined) {
      return null;
    }
    return toDocument(transform, clientX - area.left, clientY - area.top);
  };

  const update = useEffectEvent(() => {
    if (state.phase !== "drawing") {
      return;
    }
    const from = inPage(origin.current.x, origin.current.y);
    const to = inPage(pointer.current.x, pointer.current.y);
    if (from === null || to === null) {
      return;
    }
    setState({ ...state, rect: { x: from.x, y: from.y, w: to.x - from.x, h: to.y - from.y } });
  });

  const commit = useEffectEvent(() => {
    if (state.phase !== "drawing") {
      return;
    }
    const { rect, additive } = state;
    setState(idle);
    if (!moved.current) {
      // Un clic en vacío, no un rectángulo: ya lo atendió `useSelection`.
      return;
    }
    const before = additive ? useDocumentStore.getState().selection : [];
    void elementsIn(page, rect)
      .then((ids) => {
        const taken = ids.filter((id) => !before.includes(id));
        useDocumentStore.getState().selectMany([...before, ...taken]);
      })
      .catch(() => {
        // Sin respuesta del núcleo, la selección se queda como estaba.
      });
  });

  const drawing = state.phase === "drawing";
  useEffect(() => {
    if (!drawing) {
      return;
    }
    const move = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
      const far =
        Math.abs(event.clientX - origin.current.x) >= MARQUEE_MIN_PX ||
        Math.abs(event.clientY - origin.current.y) >= MARQUEE_MIN_PX;
      moved.current = moved.current || far;
      update();
    };
    const up = () => commit();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setState(idle);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", key);
    };
  }, [drawing]);

  return {
    state,
    start: (clientX, clientY, additive) => {
      const from = inPage(clientX, clientY);
      if (from === null) {
        return;
      }
      origin.current = { x: clientX, y: clientY };
      pointer.current = { x: clientX, y: clientY };
      moved.current = false;
      setState({ phase: "drawing", rect: { x: from.x, y: from.y, w: 0, h: 0 }, additive });
    },
  };
}
