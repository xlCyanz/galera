import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppliedOp, OpenedProject } from "../commands";
import { useDocumentStore } from "../store/document";
import { useLayoutStore } from "../store/layout";
import type { LayoutBox } from "../types/layout";
import { Inspector } from "./Inspector";
import { SCRUB_PX_PER_STEP } from "./fieldValue";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
        id: "portada",
        size: { width: 21, height: 29.7, unit: "cm" },
        elements: [
          { type: "rect", id: "r1", x: 30, y: 40, w: 60, h: 20, rotation: 15, fill: "#ff0000", stroke: null, radius: 0 },
          {
            type: "text", id: "t1", x: 100, y: 10, w: 50, h: null, rotation: 0,
            content: [{ text: "Hola", bold: false, italic: false, underline: false }],
            style: { font: "Inter", size: 12, color: "#000000", align: "left", leading: 0.65 },
          },
        ],
      },
    ],
  },
};

const box = (id: string, x: number, y: number, w: number, h: number): LayoutBox => ({
  id, page: 0, x, y, w, h, rotation: 0, bounds: { x, y, w, h }, line: null, overflow: 0,
});

let container: HTMLDivElement;
let root: Root;
let ops: Array<Record<string, unknown>>;

beforeEach(() => {
  ops = [];
  mockIPC((command, args) => {
    if (command === "apply_op") {
      ops.push((args as { op: Record<string, unknown> }).op);
      const applied: AppliedOp = {
        revision: 1 + ops.length,
        document: structuredClone(project.document),
        description: "",
        undo: "x",
        redo: null,
      };
      return applied;
    }
    return null;
  });
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useLayoutStore.setState(useLayoutStore.getInitialState(), true);
  useDocumentStore.getState().open(project);
  useLayoutStore.getState().update(1, [box("r1", 30, 40, 60, 20), box("t1", 100, 10, 50, 7.5)]);

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Inspector />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMocks();
});

const input = (title: string) => container.querySelector<HTMLInputElement>(`input[aria-label="${title}"]`)!;
const values = () =>
  ["Posición horizontal", "Posición vertical", "Ancho", "Alto", "Rotación"].map((title) => input(title).value);

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Escribe en un campo como lo haría el usuario. */
function type(field: HTMLInputElement, text: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function key(field: HTMLInputElement, init: KeyboardEventInit) {
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
}

function select(id: string | null) {
  act(() => useDocumentStore.getState().select(id));
}

describe("inspector", () => {
  it("sin selección enseña la página, en mm", () => {
    expect(container.textContent).toContain("Página 1");
    expect(container.textContent).toContain("portada");
    expect(container.textContent).toContain("210 × 297 mm");
    // Sin selección solo se edita el título del documento (ver `TitleField`).
    expect([...container.querySelectorAll("input")].map((input) => input.getAttribute("aria-label"))).toEqual([
      "Título del documento",
    ]);
  });

  it("con un elemento seleccionado enseña sus cinco valores reales", () => {
    select("r1");
    expect(container.textContent).toContain("Rectángulo");
    expect(values()).toEqual(["30", "40", "60", "20", "15"]);
  });

  it("en un texto con alto automático, el alto es el medido y es de solo lectura", () => {
    select("t1");
    expect(input("Alto").value).toBe("7,5");
    expect(input("Alto").readOnly).toBe(true);
    expect(container.textContent).toContain("auto");
    expect(input("Ancho").readOnly).toBe(false);
  });

  it("escribir y pulsar Enter manda un comando", async () => {
    select("r1");
    type(input("Ancho"), "80,5");
    key(input("Ancho"), { key: "Enter" });
    await settle();
    expect(ops).toEqual([{ op: "resize", id: "r1", x: 30, y: 40, w: 80.5, h: 20 }]);
  });

  it("Esc descarta lo escrito, y lo que no es un número no manda nada", async () => {
    select("r1");
    type(input("Posición horizontal"), "99");
    key(input("Posición horizontal"), { key: "Escape" });
    expect(input("Posición horizontal").value).toBe("30");
    type(input("Posición vertical"), "abc");
    key(input("Posición vertical"), { key: "Enter" });
    await settle();
    expect(ops).toHaveLength(0);
    expect(input("Posición vertical").value).toBe("40");
  });

  it("las flechas suben y bajan el valor y lo aplican", async () => {
    select("r1");
    key(input("Rotación"), { key: "ArrowUp", shiftKey: true });
    await settle();
    key(input("Posición horizontal"), { key: "ArrowDown" });
    await settle();
    expect(ops).toEqual([
      { op: "rotate", id: "r1", rotation: 25 },
      { op: "move", id: "r1", dx: -1, dy: 0 },
    ]);
  });

  it("arrastrar la etiqueta en vertical ajusta el valor y lo aplica una vez al soltar", async () => {
    select("r1");
    const label = [...container.querySelectorAll("label")].find((l) => l.textContent === "Y")!;
    const pointer = (type: string, clientY: number) =>
      act(() => {
        label.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientY }));
      });
    pointer("pointerdown", 300);
    pointer("pointermove", 300 - 5 * SCRUB_PX_PER_STEP);
    expect(input("Posición vertical").value).toBe("45");
    expect(ops).toHaveLength(0);
    pointer("pointermove", 300 - 12 * SCRUB_PX_PER_STEP);
    pointer("pointerup", 300 - 12 * SCRUB_PX_PER_STEP);
    await settle();
    expect(ops).toEqual([{ op: "move", id: "r1", dx: 0, dy: 12 }]);
  });

  it("un alto automático no se arrastra", async () => {
    select("t1");
    const label = [...container.querySelectorAll("label")].find((l) => l.textContent === "Al")!;
    act(() => {
      label.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientY: 300 }));
      label.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientY: 200 }));
      label.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientY: 200 }));
    });
    await settle();
    expect(ops).toHaveLength(0);
    expect(input("Alto").value).toBe("7,5");
  });
});
