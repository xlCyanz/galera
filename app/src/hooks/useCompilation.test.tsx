import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CompilationEvents } from "../commands";
import { useCompilationStore } from "../store/compilation";
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

beforeEach(async () => {
  mockIPC(() => undefined, { shouldMockEvents: true });
  useCompilationStore.setState(useCompilationStore.getInitialState(), true);
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
    });
    await settle();
    expect(useCompilationStore.getState()).toMatchObject({
      status: "ready",
      ms: 8.5,
      pages: ["<svg>1</svg>"],
    });
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
});
