import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppliedOp, OpenedProject } from "../commands";
import { useCompilationStore } from "../store/compilation";
import { useDocumentStore } from "../store/document";
import type { ImageLoader } from "../canvas/PageSvg";
import { PagesPanel } from "./PagesPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const size = { width: 210, height: 297, unit: "mm" as const };

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
        size,
        elements: [
          { type: "rect", id: "r1", x: 10, y: 10, w: 40, h: 20, rotation: 0, fill: "#ff0000", stroke: null, radius: 0 },
        ],
      },
      { id: "p2", size, elements: [] },
    ],
  },
};

/** Decodifica al momento, para que haya miniatura. */
const loader: ImageLoader = {
  createUrl: (svg) => `blob:${svg}`,
  revokeUrl: () => undefined,
  decode: () => Promise.resolve(),
};

let container: HTMLDivElement;
let root: Root;
let ops: Array<Record<string, unknown>>;
const restore: Array<() => void> = [];

beforeEach(() => {
  ops = [];
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
    return null;
  });

  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useCompilationStore.setState(useCompilationStore.getInitialState(), true);
  useDocumentStore.getState().open(project);
  useCompilationStore.getState().finish({
    revision: 1,
    ms: 1,
    reused: false,
    diagnostics: [],
    pages: ["<svg>una</svg>", "<svg>dos</svg>"],
    boxes: [],
    flows: [], cells: [],
  });

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<PagesPanel loader={loader} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMocks();
  while (restore.length > 0) restore.pop()?.();
});

const rows = () => [...container.querySelectorAll<HTMLElement>("[data-page]")];
const button = (label: string) =>
  [...container.querySelectorAll("button")].find((one) => one.textContent === label);
const store = () => useDocumentStore.getState();

function pointer(target: HTMLElement, type: string, clientY: number) {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientY }));
  });
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("el panel de páginas", () => {
  it("lista las páginas en orden, con su miniatura", async () => {
    expect(rows().map((row) => row.dataset.page)).toEqual(["p1", "p2"]);
    expect(rows()[0]?.className).toContain("is-current");

    // La miniatura sale cuando el SVG está decodificado.
    await settle();
    expect(container.querySelectorAll("img")).toHaveLength(2);
  });

  it("pulsar una fila lleva a esa página", () => {
    pointer(rows()[1]!, "pointerdown", 100);
    expect(store().currentPage).toBe(1);
  });

  /** El criterio de la tarea: añadir una página. */
  it("añadir mete una página detrás de la que se ve, con su tamaño", async () => {
    pointer(rows()[0]!, "pointerdown", 10);
    act(() => button("Añadir")?.click());
    await settle();

    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({
      op: "insert_page",
      index: 1,
      page: { id: "pagina-1", size, elements: [] },
    });
    expect(store().currentPage).toBe(1);
  });

  /** El criterio de la tarea: duplicar. */
  it("duplicar manda la página y el id de la copia", async () => {
    act(() => button("Duplicar")?.click());
    await settle();
    expect(ops[0]).toEqual({ op: "duplicate_page", id: "p1", to: "pagina-1" });
  });

  it("eliminar quita la que se ve", async () => {
    act(() => button("Eliminar")?.click());
    await settle();
    expect(ops[0]).toEqual({ op: "remove_page", id: "p1" });
  });

  /** El criterio de la tarea: la última página no se puede eliminar. */
  it("con una sola página, eliminar no se puede", () => {
    act(() => {
      const one = structuredClone(project);
      one.document.pages = [one.document.pages[0]!];
      store().open(one);
    });
    expect(button("Eliminar")?.disabled).toBe(true);
  });

  /** El criterio de la tarea: reordenar arrastrando. */
  it("arrastrar una fila la cambia de sitio con un solo comando", async () => {
    // Las filas ocupan 100 px cada una en esta prueba.
    const proto = HTMLElement.prototype;
    const original = proto.getBoundingClientRect;
    proto.getBoundingClientRect = function (this: HTMLElement) {
      const index = rows().indexOf(this);
      return index === -1 ? original.call(this) : new DOMRect(0, index * 100, 200, 100);
    };
    restore.push(() => {
      proto.getBoundingClientRect = original;
    });

    pointer(rows()[0]!, "pointerdown", 10);
    pointer(container.querySelector(".pages")!, "pointermove", 180);
    pointer(container.querySelector(".pages")!, "pointerup", 180);
    await settle();

    expect(ops).toEqual([{ op: "reorder_page", id: "p1", index: 1 }]);
    expect(store().currentPage).toBe(1);
  });

  it("un clic sin arrastrar no reordena nada", async () => {
    pointer(rows()[1]!, "pointerdown", 150);
    pointer(container.querySelector(".pages")!, "pointerup", 150);
    await settle();
    expect(ops).toHaveLength(0);
  });
});

describe("las páginas con el teclado", () => {
  const list = () => container.querySelector<HTMLElement>(".pages")!;
  const key = async (name: string, modifiers: { altKey?: boolean } = {}) => {
    const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...modifiers });
    await act(async () => {
      list().dispatchEvent(event);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return event;
  };

  /** El criterio de la tarea: el tabulador llega a la lista. */
  it("la lista recibe el foco y dice qué página está activa", () => {
    expect(list().tabIndex).toBe(0);
    expect(list().getAttribute("role")).toBe("listbox");
    expect(list().getAttribute("aria-activedescendant")).toBe(`page-${rows()[0]!.dataset.page}`);
  });

  it("↓ y ↑ cambian de página sin salirse de la lista", async () => {
    await key("ArrowDown");
    expect(store().currentPage).toBe(1);
    await key("ArrowDown");
    expect(store().currentPage).toBe(1);
    await key("Home");
    expect(store().currentPage).toBe(0);
    await key("End");
    expect(store().currentPage).toBe(1);
  });

  /** Mover una página era arrastrarla. */
  it("⌥↓ mueve la página un puesto, y la sigue", async () => {
    const first = rows()[0]!.dataset.page;
    const event = await key("ArrowDown", { altKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(ops).toEqual([{ op: "reorder_page", id: first, index: 1 }]);
    expect(store().currentPage).toBe(1);
  });
});
