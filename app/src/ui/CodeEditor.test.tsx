import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EditorView } from "@codemirror/view";

import type { AppliedOp, OpenedProject } from "../commands";
import { useDocumentStore } from "../store/document";
import type { CodeError } from "../types/code";
import { APPLY_DELAY_MS, CodeEditor } from "./CodeEditor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SOURCE = "#rect(width: 100%)";

const project: OpenedProject = {
  root: "/p",
  archive: null,
  revision: 1,
  document: {
    version: 1,
    meta: { title: "x" },
    fonts: [],
    assets: {},
    variables: {},
    pages: [
      {
        id: "p1",
        size: { width: 200, height: 100, unit: "mm" },
        elements: [{ type: "code", id: "c1", x: 10, y: 10, w: 40, h: 20, rotation: 0, source: SOURCE }],
      },
    ],
  },
};

let container: HTMLDivElement;
let root: Root;
let ops: Array<Record<string, unknown>>;
/** Lo que contesta el núcleo cuando se le pregunta por la sintaxis. */
let broken: CodeError[];
let checked: string[];
const restore: Array<() => void> = [];

beforeEach(() => {
  vi.useFakeTimers();
  ops = [];
  broken = [];
  checked = [];

  // CodeMirror mide con rangos del DOM, que jsdom no implementa.
  const proto = Range.prototype as unknown as { getClientRects?: unknown; getBoundingClientRect?: unknown };
  const rects = { list: proto.getClientRects, box: proto.getBoundingClientRect };
  proto.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  proto.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
  restore.push(() => {
    proto.getClientRects = rects.list;
    proto.getBoundingClientRect = rects.box;
  });

  mockIPC((command, args) => {
    if (command === "apply_op") {
      ops.push((args as { op: Record<string, unknown> }).op);
      const applied: AppliedOp = {
        revision: 1 + ops.length,
        document: structuredClone(project.document),
        description: "",
        undo: null,
        redo: null,
      };
      return applied;
    }
    if (command === "check_code") {
      checked.push((args as { source: string }).source);
      return broken;
    }
    return null;
  });

  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useDocumentStore.getState().open(project);

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<CodeEditor id="c1" source={SOURCE} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMocks();
  vi.useRealTimers();
  while (restore.length > 0) restore.pop()?.();
});

const content = () => container.querySelector<HTMLElement>(".cm-content")!;
const gutter = () => container.querySelector(".cm-lineNumbers");
const hint = () => container.querySelector(".code-hint")?.textContent ?? "";
const warning = () => container.querySelector(".code-broken")?.textContent ?? null;

/** Escribe en el editor, como haría una persona. */
function type(text: string) {
  const editor = EditorView.findFromDOM(container);
  if (editor === null) {
    throw new Error("no hay editor");
  }
  act(() => {
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } });
  });
}

/** Deja correr los temporizadores y las promesas. */
async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("el editor de código de un bloque", () => {
  /** El criterio de la tarea: resaltado, líneas y cierre de paréntesis. */
  it("enseña el código con números de línea, y se puede escribir", () => {
    expect(content().textContent).toContain("#rect(width: 100%)");
    expect(gutter()).not.toBeNull();
    expect(content().getAttribute("contenteditable")).toBe("true");
  });

  /** El criterio de la tarea: el aviso de que no se escapa está a la vista. */
  it("avisa de que lo que se escribe es código y no se escapa", () => {
    expect(hint()).toContain("código");
    expect(hint()).toContain("no se escapa");
  });

  /** El criterio de la tarea: se aplica con un retardo prudente. */
  it("aplica lo escrito cuando se deja de escribir, no en cada tecla", async () => {
    type("#rect(width: 50%)");
    await settle(APPLY_DELAY_MS - 100);
    expect(ops).toHaveLength(0);

    await settle(200);
    expect(ops).toEqual([
      { op: "set_property", id: "c1", property: { name: "source", value: "#rect(width: 50%)" } },
    ]);
  });

  it("escribir otra vez antes del retardo manda un solo cambio", async () => {
    type("#rect(");
    await settle(100);
    type("#rect(width: 10%)");
    await settle(APPLY_DELAY_MS + 100);

    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ property: { value: "#rect(width: 10%)" } });
  });

  /** El criterio de la tarea: el error se marca en su línea. */
  it("pregunta al núcleo por la sintaxis y enseña el error con su línea", async () => {
    broken = [{ message: "unclosed delimiter", line: 2, column: 3, hints: [] }];
    type("bien\n#table(columns: 2)[A");
    await settle(10);

    expect(checked.at(-1)).toBe("bien\n#table(columns: 2)[A");
    expect(warning()).toContain("Línea 2");
    expect(warning()).toContain("unclosed delimiter");
  });

  it("sin errores no se avisa de nada", async () => {
    type("#rect(width: 10%)");
    await settle(10);
    expect(warning()).toBeNull();
  });

  it("un cambio de fuera —deshacer— se ve en el editor", async () => {
    await act(async () => {
      root.render(<CodeEditor id="c1" source="#circle()" />);
      await Promise.resolve();
    });
    expect(content().textContent).toContain("#circle()");
    // Y no se manda de vuelta al núcleo.
    await settle(APPLY_DELAY_MS + 100);
    expect(ops).toHaveLength(0);
  });
});
