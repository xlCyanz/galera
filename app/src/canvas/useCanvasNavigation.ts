/**
 * Navegar por el lienzo: zoom y desplazamiento.
 *
 * | Gesto | Qué hace |
 * |---|---|
 * | Rueda, o dos dedos en el trackpad | Desplaza. Con Shift, en horizontal. |
 * | Ctrl o ⌘ + rueda | Zoom hacia el puntero. |
 * | Pinza en el trackpad | Zoom hacia los dedos. WebKit (macOS) la manda como `gesturechange`; Chromium (Windows) y WebKitGTK, como rueda con Ctrl. Se atienden las dos. |
 * | Espacio + arrastrar, o botón central | Desplaza como con una mano. |
 * | ⌘+ / ⌘- / ⌘0 / ⌘1 | Acercar, alejar, 100 % y ajustar a la ventana (Ctrl en Windows y Linux). |
 *
 * El zoom siempre se hace hacia un punto: el puntero, los dedos o, con
 * atajos y botones, el centro del área. Los cálculos están en `zoom.ts`;
 * aquí solo se traducen los eventos.
 */
import {
  type PointerEvent,
  type RefObject,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { type ZoomCommand, isMac, isTypingTarget, zoomShortcut } from "../shortcuts";
import { type Scroll, useDocumentStore, useScroll, useZoom } from "../store/document";
import type { PageSize } from "../types/model";
import { type PixelSize, pageSizeInPx } from "./geometry";
import {
  type Point,
  type View,
  fitView,
  nextZoomLevel,
  panBy,
  wheelPan,
  wheelZoom,
  zoomAround,
} from "./zoom";

/**
 * El evento de pinza de WebKit. No es estándar y TypeScript no lo trae.
 * `scale` es cuánto ha cambiado desde `gesturestart`.
 */
interface GestureEvent extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

/** Lo que el lienzo necesita para pintar y navegar. */
export interface CanvasNavigation {
  zoom: number;
  scroll: Scroll;
  /** El tamaño del área, medido. */
  viewportSize: PixelSize;
  /** Ejecuta un comando de zoom hacia el centro del área. */
  run: (command: ZoomCommand) => void;
  /** Espacio pulsado: el siguiente arrastre desplaza. */
  panReady: boolean;
  /** Se está arrastrando para desplazar. */
  panning: boolean;
  /** Para el área. */
  viewportHandlers: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
  };
}

const mac = isMac();

/**
 * @param viewport El área del lienzo.
 * @param pageSize El tamaño de la página visible, o `null` si no hay.
 * @param hand Si está activa la herramienta mano: el botón principal
 *   desplaza siempre, sin mantener Espacio.
 */
export function useCanvasNavigation(
  viewport: RefObject<HTMLElement | null>,
  pageSize: PageSize | null,
  hand = false,
): CanvasNavigation {
  const zoom = useZoom();
  const scroll = useScroll();
  const [viewportSize, setViewportSize] = useState<PixelSize>({ width: 0, height: 0 });
  // En refs y no en estado: los eventos de pinza y de arrastre llegan
  // seguidos, antes de que React vuelva a renderizar, y cada uno tiene que
  // ver lo que dejó el anterior.
  const gestureStartZoom = useRef<number | null>(null);
  const drag = useRef<Point | null>(null);
  const [panning, setPanning] = useState(false);
  const [panReady, setPanReady] = useState(false);

  // El tamaño del área, al montar y cada vez que cambia la ventana.
  useLayoutEffect(() => {
    const element = viewport.current;
    if (element === null) {
      return;
    }
    const measure = () =>
      setViewportSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [viewport]);

  /** La vista actual y la página al 100 %, leídas del store en el momento. */
  function current(): { view: View; pageAt100: PixelSize } | null {
    if (pageSize === null) {
      return null;
    }
    const { zoom: storedZoom, scroll: storedScroll } = useDocumentStore.getState();
    return { view: { zoom: storedZoom, scroll: storedScroll }, pageAt100: pageSizeInPx(pageSize, 1) };
  }

  function apply(view: View) {
    useDocumentStore.getState().setView(view.zoom, view.scroll);
  }

  /** Un punto de la pantalla, relativo al área. */
  function toViewport(event: { clientX: number; clientY: number }): Point {
    const rect = viewport.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  }

  function zoomTo(next: number, point?: Point) {
    const state = current();
    if (state === null) {
      return;
    }
    const center = { x: viewportSize.width / 2, y: viewportSize.height / 2 };
    apply(zoomAround(state.view, next, point ?? center, viewportSize, state.pageAt100));
  }

  function run(command: ZoomCommand) {
    const state = current();
    if (state === null) {
      return;
    }
    switch (command) {
      case "in":
        return zoomTo(nextZoomLevel(state.view.zoom, "in"));
      case "out":
        return zoomTo(nextZoomLevel(state.view.zoom, "out"));
      case "reset":
        return zoomTo(1);
      case "fit":
        return apply(fitView(state.pageAt100, viewportSize));
    }
  }

  function pan(delta: Point) {
    const state = current();
    if (state !== null) {
      apply(panBy(state.view, delta, viewportSize, state.pageAt100));
    }
  }

  // Rueda y pinza. Se registran a mano porque React registra la rueda como
  // pasiva, y hace falta `preventDefault` para que el webview no desplace ni
  // haga zoom de la página entera por su cuenta.
  const onWheel = useEffectEvent((event: WheelEvent) => {
    if (pageSize === null) {
      return;
    }
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      // Durante una pinza de WebKit no se suma el zoom de la rueda.
      if (gestureStartZoom.current === null) {
        zoomTo(wheelZoom(useDocumentStore.getState().zoom, event.deltaY, event.deltaMode), toViewport(event));
      }
      return;
    }
    // Rueda hacia abajo: el contenido sube.
    const delta = wheelPan(event, viewportSize);
    pan({ x: -delta.x, y: -delta.y });
  });
  const onGestureStart = useEffectEvent((event: Event) => {
    event.preventDefault();
    gestureStartZoom.current = useDocumentStore.getState().zoom;
  });
  const onGestureChange = useEffectEvent((event: Event) => {
    event.preventDefault();
    const start = gestureStartZoom.current;
    if (start !== null) {
      const gesture = event as GestureEvent;
      zoomTo(start * gesture.scale, toViewport(gesture));
    }
  });
  const onGestureEnd = useEffectEvent((event: Event) => {
    event.preventDefault();
    gestureStartZoom.current = null;
  });

  useEffect(() => {
    const element = viewport.current;
    if (element === null) {
      return;
    }
    const wheel = (event: WheelEvent) => onWheel(event);
    const start = (event: Event) => onGestureStart(event);
    const change = (event: Event) => onGestureChange(event);
    const end = (event: Event) => onGestureEnd(event);
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("gesturestart", start);
    element.addEventListener("gesturechange", change);
    element.addEventListener("gestureend", end);
    return () => {
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("gesturestart", start);
      element.removeEventListener("gesturechange", change);
      element.removeEventListener("gestureend", end);
    };
  }, [viewport]);

  // Atajos de teclado y barra espaciadora.
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (pageSize === null) {
      return;
    }
    const command = zoomShortcut(event, mac);
    if (command !== null) {
      event.preventDefault();
      run(command);
      return;
    }
    if (event.code === "Space" && !isTypingTarget(event.target)) {
      event.preventDefault();
      setPanReady(true);
    }
  });
  const onKeyUp = useEffectEvent((event: KeyboardEvent) => {
    if (event.code === "Space") {
      setPanReady(false);
    }
  });

  useEffect(() => {
    const down = (event: KeyboardEvent) => onKeyDown(event);
    const up = (event: KeyboardEvent) => onKeyUp(event);
    // Si la ventana pierde el foco con Espacio pulsado, no llega el keyup.
    const blur = () => setPanReady(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const viewportHandlers: CanvasNavigation["viewportHandlers"] = {
    onPointerDown: (event) => {
      const middleButton = event.button === 1;
      if (pageSize === null || !(middleButton || ((panReady || hand) && event.button === 0))) {
        return;
      }
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, y: event.clientY };
      setPanning(true);
    },
    onPointerMove: (event) => {
      const last = drag.current;
      if (last === null) {
        return;
      }
      pan({ x: event.clientX - last.x, y: event.clientY - last.y });
      drag.current = { x: event.clientX, y: event.clientY };
    },
    onPointerUp: () => {
      drag.current = null;
      setPanning(false);
    },
    onPointerCancel: () => {
      drag.current = null;
      setPanning(false);
    },
  };

  return { zoom, scroll, viewportSize, run, panReady: panReady || hand, panning, viewportHandlers };
}
