import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppliedOp, OpenedProject } from "../commands";
import { useDocumentStore } from "../store/document";
import { Inspector } from "./Inspector";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const code = {
  type: "code" as const,
  id: "code-1",
  x: 20,
  y: 200,
  w: 170,
  h: 40,
  rotation: 0,
  source: "#rect(width: 100%)",
};

const project: OpenedProject = {
  root: "/p",
  revision: 1,
  archive: null,
  document: {
    version: 1,
    meta: { title: "x" },
    fonts: [],
    assets: {},
    variables: {},
    pages: [{ id: "p1", size: { width: 210, height: 297, unit: "mm" }, elements: [code] }],
  },
};

let container: HTMLDivElement;
let root: Root;
let ops: Array<Record<string, unknown>>;

beforeEach(() => {
  ops = [];
  mockIPC((command, args) => {
    if (command === "apply_op") {
      const op = (args as { op: { id: string; property: { value: string } } }).op;
      ops.push(op as unknown as Record<string, unknown>);
      const document = structuredClone(useDocumentStore.getState().document!);
      (document.pages[0]!.elements[0] as typeof code).source = op.property.value;
      const applied: AppliedOp = {
        revision: 2,
        document,
        description: "Cambiar el código de code-1",
        undo: "Cambiar el código de code-1",
        redo: null,
      };
      return applied;
    }
    return null;
  });
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useDocumentStore.getState().open(project);
  useDocumentStore.getState().select("code-1");
  container = window.document.createElement("div");
  window.document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Inspector />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMocks();
});

const field = () => container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Código Typst"]')!;

function type(text: string) {
  const area = field();
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(area, text);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function key(init: KeyboardEventInit) {
  await act(async () => {
    field().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("el código de un bloque", () => {
  it("se ve y se aplica con ⌘↵", async () => {
    expect(field().value).toBe("#rect(width: 100%)");
    type("#table(columns: 2)[A][B]");
    expect(container.textContent).toContain("Sin aplicar");
    await key({ key: "Enter", metaKey: true, ctrlKey: true });
    expect(ops).toEqual([
      { op: "set_property", id: "code-1", property: { name: "source", value: "#table(columns: 2)[A][B]" } },
    ]);
    expect(field().value).toBe("#table(columns: 2)[A][B]");
    expect(useDocumentStore.getState().history.undo).toBe("Cambiar el código de code-1");
  });

  it("se aplica también al salir del campo, y Esc descarta", async () => {
    type("#lorem(3)");
    await act(async () => {
      // React escucha `focusout`, que es el que burbujea.
      field().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(ops).toHaveLength(1);

    type("otra cosa");
    await key({ key: "Escape" });
    expect(ops).toHaveLength(1);
    expect(field().value).toBe("#lorem(3)");
  });

  it("las teclas del código no son atajos del lienzo", async () => {
    let escaped = 0;
    const listener = () => {
      escaped += 1;
    };
    window.addEventListener("keydown", listener);
    await key({ key: "Escape" });
    window.removeEventListener("keydown", listener);
    expect(escaped).toBe(0);
  });
});
