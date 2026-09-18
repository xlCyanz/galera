/**
 * Crear un rectángulo, una elipse o una línea arrastrando sobre el lienzo
 * con su herramienta (`store/tool.ts`).
 *
 * Mientras se arrastra se ve la forma (`CreatePreview.tsx`); al soltar se
 * manda un único `Op::Create` al núcleo, con el estilo por defecto, y el
 * elemento nuevo queda seleccionado y se vuelve a la herramienta de
 * selección. Es un comando más: entra en el historial y se deshace con ⌘Z.
 * La vista previa se queda hasta que llega lo compilado con el elemento.
 *
 * - Un clic sin arrastrar crea la forma con su tamaño por defecto.
 * - Shift fuerza cuadrado, círculo o ángulos de 45° en una línea.
 * - Esc cancela.
 *
 * Las cuentas están en `createGeometry.ts`.
 */
import { type PointerEvent, useEffect, useEffectEvent, useRef, useState } from "react";

import { applyOp } from "../commands";
import { useCompilationStore } from "../store/compilation";
import { useDocumentStore } from "../store/document";
import { useLayoutStore } from "../store/layout";
import { useToolStore } from "../store/tool";
import {
  DRAG_THRESHOLD_PX,
  type Point,
  type ShapeGeometry,
  type ShapeKind,
  defaultShape,
  newElementId,
  shapeElement,
  shapeFromDrag,
} from "./createGeometry";
import { type CanvasTransform, toDocument } from "./transform";

export type CreateState =
  | { phase: "idle" }
  /** Arrastrando: la forma que saldría si se soltara ahora. */
  | { phase: "drawing"; kind: ShapeKind; shape: ShapeGeometry }
  /** Soltado: esperando al núcleo (`revision` null) y a su compilación. */
  | { phase: "committing"; kind: ShapeKind; shape: ShapeGeometry; revision: number | null };

const idle: CreateState = { phase: "idle" };

export interface Create {
  state: CreateState;
  /** El `pointerdown` del área del lienzo con una herramienta de forma. */
  onPointerDown: (kind: ShapeKind, event: PointerEvent<HTMLElement>) => void;
}

/**
 * @param transform Dónde está la página visible y a qué escala.
 * @param page La página visible, contando desde 0.
 */
export function useCreate(transform: CanvasTransform | null, page: number): Create {
  const [state, setState] = useState<CreateState>(idle);
  // Dónde se pulsó, en pantalla y en mm, y dónde estaba el área.
  const press = useRef<{ client: Point; start: Point; area: Point; transform: CanvasTransform } | null>(null);
  const pointer = useRef<Point>({ x: 0, y: 0 });
  const shift = useRef(false);
  const moved = useRef(false);

  const update = useEffectEvent(() => {
    const pressed = press.current;
    if (state.phase !== "drawing" || pressed === null) {
      return;
    }
    const { x, y } = pointer.current;
    moved.current ||= Math.hypot(x - pressed.client.x, y - pressed.client.y) >= DRAG_THRESHOLD_PX;
    if (!moved.current) {
      return;
    }
    const end = toDocument(pressed.transform, x - pressed.area.x, y - pressed.area.y);
    setState({ ...state, shape: shapeFromDrag(state.kind, pressed.start, end, shift.current) });
  });

  const commit = useEffectEvent(() => {
    const pressed = press.current;
    press.current = null;
    const { document } = useDocumentStore.getState();
    const target = document?.pages[page];
    if (state.phase !== "drawing" || pressed === null || document === null || target === undefined) {
      setState(idle);
      return;
    }
    const shape = moved.current ? state.shape : defaultShape(state.kind, pressed.start);
    const id = newElementId(document, state.kind);
    setState({ phase: "committing", kind: state.kind, shape, revision: null });
    applyOp({ op: "create", page: target.id, index: null, element: shapeElement(id, shape) })
      .then((applied) => {
        useDocumentStore.getState().applyEdit(applied);
        useDocumentStore.getState().select(id);
        useToolStore.getState().created();
        setState((current) =>
          current.phase === "committing" ? { ...current, revision: applied.revision } : current,
        );
      })
      .catch(() => setState(idle));
  });

  // Mientras se dibuja, el puntero y las teclas se escuchan en la ventana.
  const drawing = state.phase === "drawing";
  useEffect(() => {
    if (!drawing) {
      return;
    }
    const move = (event: globalThis.PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
      shift.current = event.shiftKey;
      update();
    };
    const up = () => commit();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        // Que el lienzo no lo tome también por «volver a selección».
        event.stopImmediatePropagation();
        press.current = null;
        setState(idle);
      } else if (event.key === "Shift") {
        shift.current = event.type === "keydown";
        update();
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    // En captura: el Escape tiene que llegar aquí antes que al lienzo.
    window.addEventListener("keydown", key, true);
    window.addEventListener("keyup", key, true);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("keyup", key, true);
    };
  }, [drawing]);

  // Tras soltar: en cuanto llega lo compilado con el elemento, la vista previa sobra.
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
    onPointerDown: (kind, event) => {
      if (event.button !== 0 || event.defaultPrevented || transform === null || state.phase === "drawing") {
        return;
      }
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const area = { x: rect.left, y: rect.top };
      const client = { x: event.clientX, y: event.clientY };
      const start = toDocument(transform, client.x - area.x, client.y - area.y);
      press.current = { client, start, area, transform };
      pointer.current = client;
      shift.current = event.shiftKey;
      moved.current = false;
      setState({ phase: "drawing", kind, shape: defaultShape(kind, start) });
    },
  };
}
