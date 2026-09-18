import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "../App";
import type { AppliedOp, OpenedProject } from "../commands";
import { useCompilationStore } from "../store/compilation";
import { useDocumentStore } from "../store/document";
import { useLayoutStore } from "../store/layout";
import type { Document } from "../types/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const at = (x: number): Document => ({
  version: 1,
  meta: { title: "Historial" },
  fonts: [],
  assets: {},
  variables: {},
  pages: [
    {
      id: "p1",
      size: { width: 210, height: 297, unit: "mm" },
      elements: [{ type: "rect", id: "r1", x, y: 10, w: 20, h: 20, rotation: 0, fill: "#ff0000", stroke: null, radius: 0 }],
    },
  ],
});

const project: OpenedProject = { root: "/p", revision: 1, document: at(10) };

let container: HTMLDivElement;
let root: Root;
let calls: string[];
/** Lo que contesta el backend a `undo` y `redo`. */
let answers: Record<string, AppliedOp | null>;

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(async () => {
  calls = [];
  answers = {};
  mockIPC(
    (command) => {
      calls.push(command);
      return answers[command] ?? null;
    },
    { shouldMockEvents: true },
  );
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useLayoutStore.setState(useLayoutStore.getInitialState(), true);
  useCompilationStore.setState(useCompilationStore.getInitialState(), true);

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<App />));
  await settle();
});

afterEach(async () => {
  act(() => root.unmount());
  await settle();
  container.remove();
  clearMocks();
});

const button = (text: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith(text))!;

function press(init: KeyboardEventInit, target: EventTarget = window) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
}

describe("deshacer y rehacer", () => {
  it("sin nada que deshacer, los botones están desactivados y el atajo no llama al backend", async () => {
    act(() => useDocumentStore.getState().open(project));
    expect(button("Deshacer").disabled).toBe(true);
    expect(button("Rehacer").disabled).toBe(true);
    press({ key: "z", ctrlKey: true });
    await settle();
    expect(calls).not.toContain("undo");
  });

  it("los botones dicen qué se va a deshacer y rehacer", () => {
    act(() => {
      useDocumentStore.getState().open(project);
      useDocumentStore
        .getState()
        .applyEdit({ revision: 2, document: at(15), description: "Mover r1", undo: "Mover r1", redo: null });
    });
    expect(button("Deshacer").textContent).toContain("Deshacer: Mover r1");
    expect(button("Deshacer").disabled).toBe(false);
    expect(button("Rehacer").textContent).not.toContain(":");
  });

  it("Ctrl+Z deshace y Ctrl+Shift+Z rehace, con lo que devuelve el backend", async () => {
    act(() => {
      useDocumentStore.getState().open(project);
      useDocumentStore
        .getState()
        .applyEdit({ revision: 2, document: at(15), description: "Mover r1", undo: "Mover r1", redo: null });
    });

    answers.undo = { revision: 3, document: at(10), description: "Mover r1", undo: null, redo: "Mover r1" };
    press({ key: "z", ctrlKey: true });
    await settle();
    expect(calls).toContain("undo");
    expect(useDocumentStore.getState().document).toEqual(at(10));
    expect(button("Rehacer").textContent).toContain("Rehacer: Mover r1");
    expect(button("Deshacer").disabled).toBe(true);

    answers.redo = { revision: 4, document: at(15), description: "Mover r1", undo: "Mover r1", redo: null };
    press({ key: "Z", ctrlKey: true, shiftKey: true });
    await settle();
    expect(calls).toContain("redo");
    expect(useDocumentStore.getState().document).toEqual(at(15));
  });

  it("el botón hace lo mismo que el atajo", async () => {
    act(() => {
      useDocumentStore.getState().open(project);
      useDocumentStore
        .getState()
        .applyEdit({ revision: 2, document: at(15), description: "Mover r1", undo: "Mover r1", redo: null });
    });
    answers.undo = { revision: 3, document: at(10), description: "Mover r1", undo: null, redo: "Mover r1" };
    act(() => button("Deshacer").click());
    await settle();
    expect(calls.filter((c) => c === "undo")).toHaveLength(1);
    expect(useDocumentStore.getState().history).toEqual({ undo: null, redo: "Mover r1" });
  });

  it("mientras se escribe en un campo, ⌘Z es el del campo", async () => {
    act(() => {
      useDocumentStore.getState().open(project);
      useDocumentStore
        .getState()
        .applyEdit({ revision: 2, document: at(15), description: "Mover r1", undo: "Mover r1", redo: null });
    });
    const input = document.createElement("input");
    container.append(input);
    press({ key: "z", ctrlKey: true }, input);
    await settle();
    expect(calls).not.toContain("undo");
  });

  it("abrir otro documento olvida el historial", () => {
    act(() => {
      useDocumentStore.getState().open(project);
      useDocumentStore
        .getState()
        .applyEdit({ revision: 2, document: at(15), description: "Mover r1", undo: "Mover r1", redo: null });
      useDocumentStore.getState().open(project);
    });
    expect(useDocumentStore.getState().history).toEqual({ undo: null, redo: null });
  });
});
