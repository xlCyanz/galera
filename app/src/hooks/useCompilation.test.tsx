import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CompilationEvents } from "../commands";
import { useCompilationStore } from "../store/compilation";
import { useLayoutStore } from "../store/layout";
import { useCompilation } from "./useCompilation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Listener() {
  useCompilation();
  return null;
}

let root: Root;

/** Deja que se resuelvan las promesas de `listen` y `emit`. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Los comandos que se han pedido. */
let invoked: string[];

beforeEach(async () => {
  invoked = [];
  mockIPC(
    (command) => {
      invoked.push(command);
      return undefined;
    },
    { shouldMockEvents: true },
  );
  useCompilationStore.setState(useCompilationStore.getInitialState(), true);
  useLayoutStore.setState(useLayoutStore.getInitialState(), true);
  root = createRoot(document.createElement("div"));
  act(() => root.render(<Listener />));
  await settle();
});

afterEach(async () => {
  act(() => root.unmount());
  // Dejar de escuchar es asíncrono: tiene que terminar antes de quitar los
  // mocks, o falla fuera de la prueba.
  await settle();
  clearMocks();
});

describe("useCompilation", () => {
  it("lleva los eventos de inicio y fin al store", async () => {
    await emit(CompilationEvents.start, { revision: 1 });
    await settle();
    expect(useCompilationStore.getState().status).toBe("compiling");

    await emit(CompilationEvents.finish, {
      revision: 1,
      ms: 8.5,
      reused: false,
      diagnostics: [],
      pages: ["<svg>1</svg>"],
      boxes: [
        {
          id: "r1",
          page: 0,
          x: 1,
          y: 2,
          w: 3,
          h: 4,
          rotation: 0,
          bounds: { x: 1, y: 2, w: 3, h: 4 },
          line: null,
        },
      ],
    });
    await settle();
    expect(useCompilationStore.getState()).toMatchObject({
      status: "ready",
      ms: 8.5,
      pages: ["<svg>1</svg>"],
    });
    // Las cajas, en el store del layout, con la misma revisión.
    expect(useLayoutStore.getState().revision).toBe(1);
    expect(useLayoutStore.getState().boxes.r1?.h).toBe(4);
  });

  it("lleva el evento de error al store", async () => {
    await emit(CompilationEvents.error, {
      revision: 1,
      ms: 2,
      reused: false,
      diagnostics: [],
      error: { kind: "invalid", message: "el documento tiene 1 problema" },
    });
    await settle();
    expect(useCompilationStore.getState()).toMatchObject({
      status: "error",
      error: { kind: "invalid" },
    });
  });

  it("al desmontar deja de escuchar", async () => {
    act(() => root.unmount());
    await settle();
    await emit(CompilationEvents.start, { revision: 5 });
    await settle();
    expect(useCompilationStore.getState().status).toBe("idle");
    // Para que `afterEach` pueda desmontar otra vez sin fallar.
    root = createRoot(document.createElement("div"));
  });

  /** #208: si al llegar un resultado falta alguna página, se piden todas. */
  it("pide que se reenvíen las páginas si le falta alguna", async () => {
    const event = { ms: 1, reused: false, diagnostics: [], boxes: [], flows: [], cells: [] };
    await emit(CompilationEvents.finish, { ...event, revision: 1, keys: ["a"], pages: ["<svg>a</svg>"] });
    await emit(CompilationEvents.finish, { ...event, revision: 2, keys: ["a"], pages: [null] });
    await settle();
    expect(invoked).toEqual([]);

    await emit(CompilationEvents.finish, { ...event, revision: 3, keys: ["b"], pages: [null] });
    await settle();
    expect(invoked).toEqual(["resend_pages"]);
  });
});
