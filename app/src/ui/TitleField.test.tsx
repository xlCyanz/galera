import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppliedOp, OpenedProject } from "../commands";
import { useDocumentStore } from "../store/document";
import { Inspector } from "./Inspector";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const project: OpenedProject = {
  root: "/p",
  revision: 1,
  archive: null,
  document: {
    version: 1,
    meta: { title: "Sin título" },
    fonts: [],
    assets: {},
    variables: {},
    pages: [{ id: "p1", size: { width: 210, height: 297, unit: "mm" }, elements: [] }],
  },
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
      const op = (args as { op: { title: string } }).op;
      ops.push(op as unknown as Record<string, unknown>);
      if (refuse !== null) {
        throw { kind: "op", message: refuse };
      }
      const document = structuredClone(useDocumentStore.getState().document!);
      document.meta.title = op.title.trim();
      const applied: AppliedOp = {
        revision: 2,
        document,
        description: "Cambiar el título",
        undo: "Cambiar el título",
        redo: null,
      };
      return applied;
    }
    return null;
  });
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useDocumentStore.getState().open(project);
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

const field = () => container.querySelector<HTMLInputElement>('input[aria-label="Título del documento"]')!;

function type(text: string) {
  const input = field();
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function key(name: string) {
  await act(async () => {
    field().dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("el título del documento", () => {
  it("se ve sin selección y se cambia con Enter", async () => {
    expect(field().value).toBe("Sin título");
    type("Informe anual 2026");
    await key("Enter");
    expect(ops).toEqual([{ op: "set_title", title: "Informe anual 2026" }]);
    expect(useDocumentStore.getState().document?.meta.title).toBe("Informe anual 2026");
    expect(useDocumentStore.getState().history.undo).toBe("Cambiar el título");
    expect(field().value).toBe("Informe anual 2026");
  });

  it("Esc descarta lo escrito y el mismo título no manda nada", async () => {
    type("Otro");
    await key("Escape");
    expect(ops).toHaveLength(0);
    expect(field().value).toBe("Sin título");

    type("  Sin título  ");
    await key("Enter");
    expect(ops).toHaveLength(0);
  });

  it("un título vacío lo rechaza el núcleo y se dice", async () => {
    refuse = "el documento tiene que tener un título";
    type("   ");
    await key("Enter");
    expect(ops).toEqual([{ op: "set_title", title: "   " }]);
    expect(container.textContent).toContain("tiene que tener un título");
    expect(useDocumentStore.getState().document?.meta.title).toBe("Sin título");
  });

  it("con un elemento seleccionado no se enseña: ahí manda el elemento", () => {
    act(() => {
      const document = structuredClone(useDocumentStore.getState().document!);
      document.pages[0]!.elements.push({
        type: "rect",
        id: "r1",
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        rotation: 0,
        fill: null,
        stroke: null,
        radius: 0,
      });
      useDocumentStore.getState().replaceDocument(document);
      useDocumentStore.getState().select("r1");
    });
    expect(container.querySelector('input[aria-label="Título del documento"]')).toBeNull();
  });
});
