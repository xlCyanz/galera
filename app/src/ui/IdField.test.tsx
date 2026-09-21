import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppliedOp, OpenedProject } from "../commands";
import { useDocumentStore } from "../store/document";
import { useLayoutStore } from "../store/layout";
import type { LayoutBox } from "../types/layout";
import { Inspector } from "./Inspector";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rect = {
  type: "rect" as const,
  id: "rect-1",
  x: 0,
  y: 0,
  w: 210,
  h: 15,
  rotation: 0,
  fill: "#1e40af",
  stroke: null,
  radius: 0,
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
    pages: [{ id: "p1", size: { width: 210, height: 297, unit: "mm" }, elements: [rect] }],
  },
};

const box: LayoutBox = {
  id: "rect-1",
  page: 0,
  x: 0,
  y: 0,
  w: 210,
  h: 15,
  rotation: 0,
  bounds: { x: 0, y: 0, w: 210, h: 15 },
  line: null,
  overflow: 0,
};

let container: HTMLDivElement;
let root: Root;
let ops: Array<Record<string, unknown>>;
/** Si el backend rechaza el cambio, con este mensaje. */
let refuse: string | null;

beforeEach(() => {
  ops = [];
  refuse = null;
  mockIPC((command, args) => {
    if (command === "apply_op") {
      const op = (args as { op: { id: string; to: string } }).op;
      ops.push(op as unknown as Record<string, unknown>);
      if (refuse !== null) {
        throw { kind: "op", message: refuse };
      }
      const document = structuredClone(useDocumentStore.getState().document!);
      document.pages[0]!.elements[0]!.id = op.to;
      const applied: AppliedOp = {
        revision: 2,
        document,
        description: `Renombrar ${op.id} a ${op.to}`,
        undo: `Renombrar ${op.id} a ${op.to}`,
        redo: null,
      };
      return applied;
    }
    return null;
  });
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useLayoutStore.setState(useLayoutStore.getInitialState(), true);
  useDocumentStore.getState().open(project);
  useLayoutStore.getState().update(1, [box]);
  useDocumentStore.getState().select("rect-1");
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

const shown = () => container.querySelector<HTMLElement>(".inspector-id");
const field = () => container.querySelector<HTMLInputElement>('input[aria-label^="Id de"]');

function startEditing() {
  act(() => {
    shown()!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  });
}

function type(text: string) {
  const input = field()!;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function key(name: string) {
  await act(async () => {
    field()!.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("el id de un elemento", () => {
  it("se enseña y se cambia con doble clic", async () => {
    expect(shown()!.textContent).toBe("rect-1");
    startEditing();
    type("r1");
    await key("Enter");
    expect(ops).toEqual([{ op: "rename", id: "rect-1", to: "r1" }]);
    expect(shown()!.textContent).toBe("r1");
    // La selección sigue al elemento, que ahora se llama de otra forma.
    expect(useDocumentStore.getState().selection).toEqual(["r1"]);
    expect(useDocumentStore.getState().history.undo).toBe("Renombrar rect-1 a r1");
  });

  it("Esc cancela, y el mismo id no manda nada", async () => {
    startEditing();
    type("otro");
    await key("Escape");
    expect(ops).toHaveLength(0);
    expect(shown()!.textContent).toBe("rect-1");

    startEditing();
    type("  rect-1  ");
    await key("Enter");
    expect(ops).toHaveLength(0);
  });

  it("uno repetido o que no vale lo rechaza el núcleo y se dice", async () => {
    refuse = 'ya hay un elemento o una página con el id "p1"';
    startEditing();
    type("p1");
    await key("Enter");
    expect(container.textContent).toContain("ya hay un elemento o una página");
    expect(useDocumentStore.getState().document?.pages[0]?.elements[0]?.id).toBe("rect-1");
    expect(useDocumentStore.getState().selection).toEqual(["rect-1"]);
  });
});
