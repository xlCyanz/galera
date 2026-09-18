import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppliedOp, OpenedProject } from "../commands";
import { useDocumentStore } from "../store/document";
import type { Element } from "../types/model";
import { TextInspector } from "./TextInspector";
import { SCRUB_PX_PER_STEP } from "./fieldValue";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const style = { font: "Inter", size: 12, color: "#000000", align: "left", leading: 0.65 } as const;
const text: Extract<Element, { type: "text" }> = {
  type: "text", id: "t1", x: 0, y: 0, w: 50, h: null, rotation: 0, content: [], style,
};

const project: OpenedProject = {
  root: "/p",
  revision: 1,
  document: { version: 1, meta: { title: "x" }, fonts: ["fonts/Inter-Regular.ttf"], assets: {}, variables: {}, pages: [{ id: "p1", size: { width: 10, height: 10, unit: "mm" }, elements: [text] }] },
};

let container: HTMLDivElement;
let root: Root;
let styles: unknown[];

beforeEach(async () => {
  styles = [];
  mockIPC((command, args) => {
    if (command === "font_families") {
      return ["Inter"];
    }
    if (command === "apply_op") {
      const { op } = args as { op: { property: { value: typeof style } } };
      styles.push(op.property.value);
      const document = structuredClone(useDocumentStore.getState().document!);
      (document.pages[0]!.elements[0] as typeof text).style = op.property.value;
      const applied: AppliedOp = { revision: 2, document, description: "x", undo: "x", redo: null };
      return applied;
    }
    return null;
  });
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useDocumentStore.getState().open(project);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  await settle();
  clearMocks();
});

async function settle() {
  await act(async () => {
    for (let i = 0; i < 4; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

/** Pinta el inspector con el texto de ahora del store. */
async function render() {
  const element = useDocumentStore.getState().document!.pages[0]!.elements[0] as typeof text;
  act(() => root.render(<TextInspector element={element} />));
  await settle();
}

const input = (title: string) => container.querySelector<HTMLInputElement>(`input[aria-label="${title}"]`)!;

async function type(title: string, text: string) {
  const field = input(title);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  await settle();
  await render();
}

describe("inspector de texto", () => {
  it("la fuente sale de las del proyecto", () => {
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Fuente"]')!;
    expect([...select.options].map((option) => option.value)).toEqual(["Inter"]);
  });

  it("el tamaño en puntos, con el campo y arrastrando su etiqueta", async () => {
    expect(input("Tamaño").value).toBe("12");
    expect(container.textContent).toContain("pt");
    await type("Tamaño", "18");
    expect(styles.at(-1)).toEqual({ ...style, size: 18 });

    const label = [...container.querySelectorAll("label")].find((l) => l.textContent === "Tam")!;
    act(() => {
      label.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientY: 100 }));
      label.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientY: 100 - 4 * SCRUB_PX_PER_STEP }));
      label.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientY: 100 - 4 * SCRUB_PX_PER_STEP }));
    });
    await settle();
    expect(styles.at(-1)).toEqual({ ...style, size: 22 });
  });

  it("las cuatro alineaciones, con la activa marcada", async () => {
    const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    expect(button("Izquierda").getAttribute("aria-pressed")).toBe("true");
    for (const [label, align] of [["Centro", "center"], ["Derecha", "right"], ["Justificado", "justify"]] as const) {
      await act(async () => button(label).click());
      await settle();
      expect(styles.at(-1)).toEqual({ ...style, align });
      await render();
      expect(button(label).getAttribute("aria-pressed")).toBe("true");
    }
  });

  it("interlineado con pasos pequeños y espacio entre párrafos, que vuelve a «auto» con el de Typst", async () => {
    await act(async () => {
      input("Interlineado").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
    });
    await settle();
    expect(styles.at(-1)).toEqual({ ...style, leading: 0.7 });
    await render();

    expect(input("Espacio entre párrafos").value).toBe("1,2");
    expect(container.textContent).toContain("auto");
    await type("Espacio entre párrafos", "2");
    expect(styles.at(-1)).toEqual({ ...style, leading: 0.7, spacing: 2 });
    expect(container.textContent).not.toContain("auto");
  });

  it("el color con el selector", async () => {
    await act(async () => container.querySelector<HTMLButtonElement>(".color-swatch")!.click());
    const hex = container.querySelector<HTMLInputElement>(".color-hex")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(hex, "#1e40af");
      hex.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      hex.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    await settle();
    expect(styles.at(-1)).toEqual({ ...style, color: "#1e40af" });
  });
});
