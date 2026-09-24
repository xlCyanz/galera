import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppliedOp, OpenedProject } from "../commands";
import { useDocumentStore } from "../store/document";
import type { Element } from "../types/model";
import { LayersPanel } from "./LayersPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rect = (id: string): Element => ({ type: "rect", id, x: 0, y: 0, w: 1, h: 1, rotation: 0, fill: null, stroke: null, radius: 0 });

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
      { id: "p1", size: { width: 10, height: 10, unit: "mm" }, elements: [rect("a"), rect("b"), rect("c")] },
      { id: "p2", size: { width: 10, height: 10, unit: "mm" }, elements: [] },
    ],
  },
};

const ROW = 20;

let container: HTMLDivElement;
let root: Root;
let ops: Array<Record<string, unknown>>;

beforeEach(() => {
  ops = [];
  mockIPC((command, args) => {
    if (command === "apply_op") {
      const op = (args as { op: { op: string; id: string; index: number; property?: { name: string; value: unknown } } }).op;
      ops.push(op);
      if (op.op === "set_property") {
        const document = structuredClone(useDocumentStore.getState().document!);
        const element = document.pages[0]!.elements.find((e) => e.id === op.id)! as Record<string, unknown>;
        const { name, value } = op.property!;
        element[name] = value === false || value === null ? undefined : value;
        const applied: AppliedOp = { revision: 2, document, description: "x", undo: "x", redo: null };
        return applied;
      }
      // Aplica el reordenado como el núcleo, para ver la lista nueva.
      const document = structuredClone(useDocumentStore.getState().document!);
      const elements = document.pages[0]!.elements;
      const from = elements.findIndex((e) => e.id === op.id);
      const [moved] = elements.splice(from, 1);
      elements.splice(op.index, 0, moved!);
      const applied: AppliedOp = { revision: 2, document, description: `Reordenar ${op.id}`, undo: `Reordenar ${op.id}`, redo: null };
      return applied;
    }
    return null;
  });
  // Cada fila mide ROW píxeles, una debajo de otra, en el orden del DOM.
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: HTMLElement) {
      const rows = [...(this.parentElement?.children ?? [])];
      const at = rows.indexOf(this);
      return { top: at * ROW, bottom: (at + 1) * ROW, left: 0, right: 100, width: 100, height: ROW };
    },
  });
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useDocumentStore.getState().open(project);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<LayersPanel />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMocks();
  delete (HTMLElement.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
});

const rows = () => [...container.querySelectorAll<HTMLElement>("[data-layer]")];
const order = () => rows().map((row) => row.dataset.layer);
const row = (id: string) => rows().find((r) => r.dataset.layer === id)!;
const list = () => container.querySelector<HTMLElement>(".layers")!;

function pointer(target: HTMLElement, type: string, clientY: number, init: MouseEventInit = {}) {
  act(() => {
    target.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientY, ...init }),
    );
  });
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("panel de capas", () => {
  it("lista la página con la capa de arriba (la última del arreglo) primero, con icono y nombre", () => {
    expect(order()).toEqual(["c", "b", "a"]);
    expect(row("c").querySelector("svg")).not.toBeNull();
    expect(row("c").textContent).toContain("Rectángulo");
  });

  it("pulsar una fila selecciona el elemento, y seleccionar en el lienzo marca su fila", () => {
    pointer(row("b"), "pointerdown", 30);
    pointer(list(), "pointerup", 30);
    expect(useDocumentStore.getState().selection).toEqual(["b"]);
    expect(row("b").getAttribute("aria-selected")).toBe("true");
    expect(ops).toHaveLength(0);

    act(() => useDocumentStore.getState().select("a"));
    expect(row("a").className).toContain("is-selected");
    expect(row("b").className).not.toContain("is-selected");
  });

  /** El criterio de la tarea: ⇧ + clic también suma y resta aquí. */
  it("⇧ + clic marca varias filas, y otro ⇧ + clic la quita", () => {
    pointer(row("b"), "pointerdown", 30);
    pointer(list(), "pointerup", 30);
    pointer(row("a"), "pointerdown", 2 * ROW + 10, { shiftKey: true });
    pointer(list(), "pointerup", 2 * ROW + 10);

    expect(useDocumentStore.getState().selection).toEqual(["b", "a"]);
    expect(row("a").className).toContain("is-selected");
    expect(row("b").className).toContain("is-selected");
    // Con ⇧ no se reordena nada.
    expect(ops).toHaveLength(0);

    pointer(row("a"), "pointerdown", 2 * ROW + 10, { shiftKey: true });
    pointer(list(), "pointerup", 2 * ROW + 10);
    expect(useDocumentStore.getState().selection).toEqual(["b"]);
  });

  it("arrastrar una fila la cambia de capa con un único Reorder", async () => {
    // «a» (abajo del todo, índice 0) hasta arriba del todo.
    pointer(row("a"), "pointerdown", 2 * ROW + 10);
    pointer(list(), "pointermove", 2);
    expect(row("c").className).toContain("drop-above");
    pointer(list(), "pointerup", 2);
    await settle();
    expect(ops).toEqual([{ op: "reorder", id: "a", index: 2 }]);
    expect(order()).toEqual(["a", "c", "b"]);
    expect(useDocumentStore.getState().history.undo).toBe("Reordenar a");
  });

  it("soltarla donde estaba no manda nada; Esc cancela", async () => {
    pointer(row("b"), "pointerdown", ROW + 10);
    pointer(list(), "pointermove", ROW + 14);
    pointer(list(), "pointerup", ROW + 14);
    await settle();
    expect(ops).toHaveLength(0);

    pointer(row("c"), "pointerdown", 10);
    pointer(list(), "pointermove", 3 * ROW);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    });
    pointer(list(), "pointerup", 3 * ROW);
    await settle();
    expect(ops).toHaveLength(0);
  });

  it("enseña la página que se ve", () => {
    act(() => useDocumentStore.getState().setCurrentPage(1));
    expect(rows()).toHaveLength(0);
    expect(container.textContent).toContain("no tiene elementos");
  });
});

describe("ocultar, bloquear y renombrar", () => {
  const toggle = (id: string, which: "hidden" | "locked") =>
    row(id).querySelector<HTMLButtonElement>(`[data-toggle="${which}"]`)!;

  async function click(button: HTMLElement) {
    await act(async () => {
      button.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("el ojo oculta y vuelve a mostrar, sin seleccionar ni arrastrar la fila", async () => {
    await click(toggle("b", "hidden"));
    expect(ops).toEqual([{ op: "set_property", id: "b", property: { name: "hidden", value: true } }]);
    expect(row("b").className).toContain("is-hidden");
    expect(toggle("b", "hidden").getAttribute("aria-pressed")).toBe("true");
    expect(useDocumentStore.getState().selection).toEqual([]);

    await click(toggle("b", "hidden"));
    expect(ops[1]).toEqual({ op: "set_property", id: "b", property: { name: "hidden", value: false } });
    expect(row("b").className).not.toContain("is-hidden");
  });

  it("el candado bloquea, y un bloqueado se sigue seleccionando desde el panel", async () => {
    await click(toggle("c", "locked"));
    expect(ops).toEqual([{ op: "set_property", id: "c", property: { name: "locked", value: true } }]);
    expect(row("c").className).toContain("is-locked");
    pointer(row("c"), "pointerdown", 10);
    pointer(list(), "pointerup", 10);
    expect(useDocumentStore.getState().selection).toEqual(["c"]);
  });

  it("doble clic en el nombre lo renombra; vacío vuelve al deducido; Esc cancela", async () => {
    const rename = async (id: string, text: string, key: string) => {
      act(() => {
        row(id).querySelector(".layer-label")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      });
      const input = row(id).querySelector<HTMLInputElement>("input")!;
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setter.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };

    await rename("a", "Fondo", "Enter");
    expect(ops).toEqual([{ op: "set_property", id: "a", property: { name: "name", value: "Fondo" } }]);
    expect(row("a").querySelector(".layer-label")!.textContent).toBe("Fondo");

    await rename("a", "Otra cosa", "Escape");
    expect(ops).toHaveLength(1);
    expect(row("a").querySelector(".layer-label")!.textContent).toBe("Fondo");

    await rename("a", "  ", "Enter");
    expect(ops[1]).toEqual({ op: "set_property", id: "a", property: { name: "name", value: null } });
    expect(row("a").querySelector(".layer-label")!.textContent).toBe("Rectángulo");
  });
});

describe("las capas con el teclado", () => {
  const key = async (name: string, modifiers: { shiftKey?: boolean; altKey?: boolean } = {}) => {
    const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...modifiers });
    await act(async () => {
      list().dispatchEvent(event);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return event;
  };

  /** El criterio de la tarea: el tabulador llega a la lista. */
  it("la lista recibe el foco y dice qué capa está activa", () => {
    expect(list().tabIndex).toBe(0);
    act(() => useDocumentStore.getState().select("b"));
    expect(list().getAttribute("aria-activedescendant")).toBe("layer-b");
    expect(container.querySelector("#layer-b")).toBe(row("b"));
  });

  /** El criterio de la tarea: los elementos se seleccionan solo con el
   * teclado. La lista va de la capa de arriba a la de abajo. */
  it("las flechas seleccionan la capa de al lado, y ⇧ la suma", async () => {
    act(() => useDocumentStore.getState().select("c"));
    await key("ArrowDown");
    expect(useDocumentStore.getState().selection).toEqual(["b"]);

    await key("ArrowDown", { shiftKey: true });
    expect(useDocumentStore.getState().selection).toEqual(["b", "a"]);

    await key("Home");
    expect(useDocumentStore.getState().selection).toEqual(["c"]);
    await key("End");
    expect(useDocumentStore.getState().selection).toEqual(["a"]);
  });

  it("las flechas de la lista no mueven el elemento en el lienzo", async () => {
    let reached = false;
    const listener = () => {
      reached = true;
    };
    window.addEventListener("keydown", listener);
    const event = await key("ArrowDown");
    window.removeEventListener("keydown", listener);

    expect(event.defaultPrevented).toBe(true);
    expect(reached).toBe(false);
  });

  /** El criterio de la tarea: ninguna función es solo del ratón. Reordenar
   * era arrastrar. */
  it("⌥↑ sube la capa un puesto, como arrastrarla", async () => {
    act(() => useDocumentStore.getState().select("b"));
    await key("ArrowUp", { altKey: true });

    expect(ops).toEqual([{ op: "reorder", id: "b", index: 2 }]);
    expect(order()).toEqual(["b", "c", "a"]);
  });

  it("⌥↓ en la de abajo del todo no hace nada", async () => {
    act(() => useDocumentStore.getState().select("a"));
    await key("ArrowDown", { altKey: true });
    expect(ops).toEqual([]);
  });

  /** Renombrar era doble clic. */
  it("Intro renombra la capa activa, y el foco vuelve a la lista", async () => {
    act(() => useDocumentStore.getState().select("a"));
    list().focus();
    await key("Enter");

    const input = container.querySelector<HTMLInputElement>(".layer-rename");
    expect(input).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "Fondo");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
      input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(ops).toEqual([{ op: "set_property", id: "a", property: { name: "name", value: "Fondo" } }]);
    expect(document.activeElement).toBe(list());
  });
});
