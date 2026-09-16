/**
 * Criterio de F1-07: un componente suscrito con un selector solo vuelve a
 * renderizar cuando cambia lo que selecciona.
 */
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useCompilationStatus, useCompilationStore } from "./compilation";
import { useDocumentStore, useScroll, useZoom } from "./document";

// Le dice a React que las actualizaciones van dentro de `act`.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useCompilationStore.setState(useCompilationStore.getInitialState(), true);
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
});

/** Monta un componente que cuenta sus renders y enseña lo que lee. */
function mountCounting(useValue: () => unknown) {
  const renders = { count: 0 };
  function Probe() {
    renders.count += 1;
    return <span>{JSON.stringify(useValue())}</span>;
  }
  act(() => root.render(<Probe />));
  return renders;
}

describe("selectores", () => {
  it("quien lee el zoom no se repinta al desplazar el lienzo", () => {
    const renders = mountCounting(useZoom);
    expect(renders.count).toBe(1);

    act(() => useDocumentStore.getState().scrollBy(10, 10));
    act(() => useDocumentStore.getState().setScroll({ x: 3, y: 4 }));
    expect(renders.count).toBe(1);

    act(() => useDocumentStore.getState().setZoom(2));
    expect(renders.count).toBe(2);
    expect(container.textContent).toBe("2");
  });

  it("quien lee el desplazamiento no se repinta si el zoom no cambia de valor", () => {
    const renders = mountCounting(useScroll);

    act(() => useDocumentStore.getState().setZoom(3));
    act(() => useDocumentStore.getState().setCurrentPage(0));
    expect(renders.count).toBe(1);

    act(() => useDocumentStore.getState().scrollBy(5, 0));
    expect(renders.count).toBe(2);
  });

  it("quien lee el estado de compilación no se repinta por el documento", () => {
    const renders = mountCounting(useCompilationStatus);

    act(() => useDocumentStore.getState().setZoom(4));
    expect(renders.count).toBe(1);

    act(() => useCompilationStore.getState().start());
    expect(renders.count).toBe(2);
    expect(container.textContent).toBe('"compiling"');

    // Volver a empezar no cambia el valor: no hay render.
    act(() => useCompilationStore.getState().start());
    expect(renders.count).toBe(2);
  });
});
