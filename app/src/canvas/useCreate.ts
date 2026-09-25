/**
 * Crear un rectángulo, una elipse, una línea, un texto, un bloque de código
 * o una tabla arrastrando sobre el lienzo con su herramienta
 * (`store/tool.ts`).
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
 * Un texto se crea arrastrando su ancho (el alto lo decide Typst: `h:
 * null`), con un texto de relleno y el estilo que diga el núcleo según el
 * documento (`textDefaults`). Si el proyecto no tiene ninguna fuente, no se
 * puede: se queda en `needsFont`, el lienzo lo avisa y ofrece añadir una
 * (`addFont`), y en cuanto se añade se crea el texto.
 *
 * Una tabla se crea igual que un texto —arrastrando su ancho, con el estilo
 * del núcleo y pidiendo una fuente si no hay—: tres filas y tres columnas
 * iguales, con las celdas vacías.
 *
 * Una zona de texto se dibuja como una caja y también necesita fuente: sin
 * nada seleccionado empieza un texto que fluye nuevo, y con una zona
 * seleccionada sigue su texto, detrás de ella (`flowCreate.ts`).
 *
 * Las cuentas están en `createGeometry.ts`.
 */
import { type PointerEvent, useEffect, useEffectEvent, useRef, useState } from "react";

import { addFont as addFontToProject, applyOp, errorMessage, textDefaults } from "../commands";
import { useCompilationStore } from "../store/compilation";
import { useDocumentStore } from "../store/document";
import { useLayoutStore } from "../store/layout";
import { useToolStore } from "../store/tool";
import type { TextStyle } from "../types/model";
import {
  DRAG_THRESHOLD_PX,
  type Point,
  type ShapeGeometry,
  type ShapeKind,
  type TextKind,
  defaultShape,
  needsTextStyle,
  newElementId,
  shapeElement,
  shapeFromDrag,
} from "./createGeometry";
import { flowCreateOp } from "./flowCreate";
import { type CanvasTransform, toDocument } from "./transform";

export type CreateState =
  | { phase: "idle" }
  /** Arrastrando: la forma que saldría si se soltara ahora. */
  | { phase: "drawing"; kind: ShapeKind; shape: ShapeGeometry }
  /** Soltado: esperando al núcleo (`revision` null) y a su compilación. */
  | { phase: "committing"; kind: ShapeKind; shape: ShapeGeometry; revision: number | null }
  /**
   * Un texto que no se puede crear porque el proyecto no tiene fuentes.
   * `error`: por qué falló el último intento de añadir una.
   */
  | { phase: "needsFont"; kind: TextKind; shape: ShapeGeometry; error: string | null };

const idle: CreateState = { phase: "idle" };

export interface Create {
  state: CreateState;
  /** El `pointerdown` del área del lienzo con una herramienta de forma o de texto. */
  onPointerDown: (kind: ShapeKind, event: PointerEvent<HTMLElement>) => void;
  /**
   * Crea un elemento del tamaño por defecto con su esquina en `at`, en mm.
   * Es lo que hace un clic sin arrastrar, para crear sin ratón (F8-02).
   */
  createAt: (kind: ShapeKind, at: Point) => void;
  /** En `needsFont`: pide una fuente, la añade y crea el texto o la tabla. */
  addFont: () => Promise<void>;
  /** En `needsFont`: renuncia a crearlo. */
  dismiss: () => void;
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

  /** Crea el elemento: un único `Op::Create`. */
  const create = useEffectEvent(async (kind: ShapeKind, shape: ShapeGeometry) => {
    let style: TextStyle | undefined;
    if (needsTextStyle(kind)) {
      try {
        const found = await textDefaults();
        if (found === null) {
          setState({ phase: "needsFont", kind, shape, error: null });
          return;
        }
        style = found;
      } catch {
        setState(idle);
        return;
      }
    }
    // Se lee ahora: el documento puede haber cambiado mientras se esperaba.
    const { document } = useDocumentStore.getState();
    const target = document?.pages[page];
    if (document === null || target === undefined) {
      setState(idle);
      return;
    }
    const id = newElementId(document, kind);
    setState({ phase: "committing", kind, shape, revision: null });
    try {
      const op =
        kind === "flow" && style !== undefined
          ? flowCreateOp(document, target.id, id, shape, style, useDocumentStore.getState().selection)
          : ({ op: "create", page: target.id, index: null, element: shapeElement(id, shape, style) } as const);
      const applied = await applyOp(op);
      useDocumentStore.getState().applyEdit(applied);
      useDocumentStore.getState().select(id);
      useToolStore.getState().created();
      setState((current) => (current.phase === "committing" ? { ...current, revision: applied.revision } : current));
    } catch {
      setState(idle);
    }
  });

  const commit = useEffectEvent(() => {
    const pressed = press.current;
    press.current = null;
    if (state.phase !== "drawing" || pressed === null) {
      setState(idle);
      return;
    }
    const shape = moved.current ? state.shape : defaultShape(state.kind, pressed.start);
    void create(state.kind, shape);
  });

  const addFont = useEffectEvent(async () => {
    if (state.phase !== "needsFont") {
      return;
    }
    const { kind, shape } = state;
    try {
      const added = await addFontToProject();
      if (added === null) {
        return;
      }
      useDocumentStore.getState().applyEdit(added);
      await create(kind, shape);
    } catch (reason) {
      setState({ phase: "needsFont", kind, shape, error: errorMessage(reason) });
    }
  });

  // Con el aviso de la fuente a la vista, Esc lo cierra.
  const needsFont = state.phase === "needsFont";
  useEffect(() => {
    if (!needsFont) {
      return;
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setState(idle);
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [needsFont]);

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
    createAt: (kind, at) => void create(kind, defaultShape(kind, at)),
    onPointerDown: (kind, event) => {
      if (
        event.button !== 0 ||
        event.defaultPrevented ||
        transform === null ||
        state.phase === "drawing" ||
        state.phase === "needsFont"
      ) {
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
    addFont: () => addFont(),
    dismiss: () => setState(idle),
  };
}
