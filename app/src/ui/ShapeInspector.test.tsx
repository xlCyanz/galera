import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppliedOp, OpenedProject } from "../commands";
import { useDocumentStore } from "../store/document";
import { useRecentColors } from "../store/recentColors";
import type { Element } from "../types/model";
import { ShapeInspector } from "./ShapeInspector";
import { SCRUB_PX_PER_STEP } from "./fieldValue";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rect: Element = { type: "rect", id: "r1", x: 0, y: 0, w: 10, h: 10, rotation: 0, fill: "#ff0000", stroke: null, radius: 2 };
const line: Element = { type: "line", id: "l1", x: 0, y: 0, x2: 10, y2: 0, rotation: 0, stroke: { color: "#000000", width: 0.5 } };

const project: OpenedProject = {
  root: "/p",
  archive: null,
  revision: 1,
  document: { version: 1, meta: { title: "x" }, fonts: [], assets: {}, variables: {}, pages: [{ id: "p1", size: { width: 10, height: 10, unit: "mm" }, elements: [rect, line] }] },
};

let container: HTMLDivElement;
let root: Root;
let ops: Array<{ op: Record<string, unknown>; group: string | null }>;

beforeEach(() => {
  ops = [];
  mockIPC((command, args) => {
    if (command === "apply_op") {
      const { op, group } = args as { op: { id: string; property: { name: string; value: unknown } }; group: string | null };
      ops.push({ op: op as unknown as Record<string, unknown>, group });
      const document = structuredClone(useDocumentStore.getState().document!);
      const element = document.pages[0]!.elements.find((e) => e.id === op.id)! as Record<string, unknown>;
      element[op.property.name] = op.property.value;
      const applied: AppliedOp = { revision: 2, document, description: "x", undo: "x", redo: null };
      return applied;
    }
    return null;
  });
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useRecentColors.setState({ colors: [] });
  useDocumentStore.getState().open(project);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMocks();
});

/** Pinta el inspector con los elementos de ahora del store. */
function render(ids: string[]) {
  const all = useDocumentStore.getState().document!.pages[0]!.elements;
  act(() => root.render(<ShapeInspector elements={ids.map((id) => all.find((e) => e.id === id)!)} />));
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 4; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

const swatch = (label: string) => container.querySelector<HTMLButtonElement>(`.color-swatch[aria-label^="${label}"]`)!;
const sent = () => ops.map(({ op }) => op);

function typeHex(text: string) {
  const hex = container.querySelector<HTMLInputElement>(".color-hex")!;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(hex, text);
    hex.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    hex.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
}

describe("inspector de formas", () => {
  it("el relleno se cambia con el campo hexadecimal, con opacidad, y queda entre los recientes", async () => {
    render(["r1"]);
    expect(swatch("Relleno").textContent).toContain("#ff0000");
    act(() => swatch("Relleno").click());
    expect(container.querySelector(".color-wheel")).not.toBeNull();
    typeHex("#00FF0080");
    await settle();
    expect(sent()).toEqual([{ op: "set_property", id: "r1", property: { name: "fill", value: "#00ff0080" } }]);
    expect(useRecentColors.getState().colors).toEqual(["#00ff0080"]);
    expect(container.querySelector('.color-recent [aria-label="#00ff0080"]')).not.toBeNull();
  });

  it("el relleno se quita del todo", async () => {
    render(["r1"]);
    act(() => swatch("Relleno").click());
    await act(async () => {
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Sin relleno")!.click();
    });
    await settle();
    expect(sent()).toEqual([{ op: "set_property", id: "r1", property: { name: "fill", value: null } }]);
  });

  it("el borde se activa con el de por defecto, se cambia su grosor y estilo, y se quita", async () => {
    render(["r1"]);
    const check = container.querySelector<HTMLInputElement>('input[aria-label="Borde"]')!;
    expect(check.checked).toBe(false);
    await act(async () => check.click());
    await settle();
    expect(sent()[0]).toEqual({ op: "set_property", id: "r1", property: { name: "stroke", value: { color: "#1f2733", width: 0.5 } } });

    render(["r1"]);
    const dash = container.querySelector<HTMLSelectElement>('select[aria-label="Estilo del trazo"]')!;
    await act(async () => {
      dash.value = "dashed";
      dash.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(sent()[1]).toEqual({
      op: "set_property", id: "r1", property: { name: "stroke", value: { color: "#1f2733", width: 0.5, dash: "dashed" } },
    });

    render(["r1"]);
    await act(async () => container.querySelector<HTMLInputElement>('input[aria-label="Borde"]')!.click());
    await settle();
    expect(sent()[2]).toEqual({ op: "set_property", id: "r1", property: { name: "stroke", value: null } });
  });

  it("el radio se ajusta con el campo y arrastrando su etiqueta", async () => {
    render(["r1"]);
    const radius = container.querySelector<HTMLInputElement>('input[aria-label="Radio de las esquinas"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(radius, "5");
      radius.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      radius.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    await settle();
    expect(sent()).toEqual([{ op: "set_property", id: "r1", property: { name: "radius", value: 5 } }]);

    render(["r1"]);
    const label = [...container.querySelectorAll("label")].find((l) => l.textContent === "Radio")!;
    act(() => {
      label.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientY: 100 }));
      label.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientY: 100 - 3 * SCRUB_PX_PER_STEP }));
      label.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientY: 100 - 3 * SCRUB_PX_PER_STEP }));
    });
    await settle();
    expect(sent()[1]).toEqual({ op: "set_property", id: "r1", property: { name: "radius", value: 8 } });
  });

  it("una línea tiene trazo sin casilla y sin relleno ni radio", () => {
    render(["l1"]);
    expect(container.querySelector('input[aria-label="Borde"]')).toBeNull();
    expect(container.textContent).toContain("Trazo");
    expect(swatch("Relleno")).toBeNull();
    expect(container.querySelector('input[aria-label="Radio de las esquinas"]')).toBeNull();
  });

  it("con varias formas, lo distinto sale mixto y un cambio es un solo paso para todas", async () => {
    render(["r1", "l1"]);
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Borde"]')!.indeterminate).toBe(true);
    // El grosor que se ve es el de los trazos que hay: el de la línea.
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Grosor del trazo"]')!.value).toBe("0,5");

    // Con el borde en las dos, el grosor distinto sale «Mixto».
    act(() => {
      const document = structuredClone(useDocumentStore.getState().document!);
      (document.pages[0]!.elements[0] as Record<string, unknown>).stroke = { color: "#000000", width: 2 };
      useDocumentStore.getState().replaceDocument(document);
    });
    render(["r1", "l1"]);
    const mixed = container.querySelector<HTMLInputElement>('input[aria-label="Grosor del trazo"]')!;
    expect(mixed.value).toBe("");
    expect(mixed.placeholder).toBe("Mixto");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(mixed, "1");
      mixed.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      mixed.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    await settle();
    expect(ops.map(({ op }) => op.id)).toEqual(["r1", "l1"]);
    expect(new Set(ops.map(({ group }) => group)).size).toBe(1);
    expect(ops[0]!.group).toMatch(/^shape-/);
  });
});
