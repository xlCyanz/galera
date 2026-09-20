import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { canvasTransform, toCanvas } from "../canvas/transform";
import { pretendMac } from "../hooks/useShortcuts";
import type { AppliedOp, OpenedProject } from "../commands";
import { useDocumentStore } from "../store/document";
import { useEditingStore } from "../store/editing";
import type { Glyph } from "../types/layout";
import type { Run } from "../types/model";
import { FormatBar } from "./FormatBar";
import { applyFormat, useTextFormat } from "./useTextFormat";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** «uno dos»: el segundo tramo en negrita. */
const runs: Run[] = [
  { text: "uno ", bold: false, italic: false, underline: false },
  { text: "dos", bold: true, italic: false, underline: false },
];

const project = (): OpenedProject => ({
  root: "/p",
  revision: 1,
  archive: null,
  document: {
    version: 1,
    meta: { title: "x" },
    fonts: ["fonts/Inter-Regular.ttf"],
    assets: {},
    variables: {},
    pages: [
      {
        id: "p1",
        size: { width: 210, height: 297, unit: "mm" },
        elements: [
          {
            type: "text",
            id: "t1",
            x: 20,
            y: 20,
            w: 80,
            h: null,
            rotation: 0,
            content: structuredClone(runs),
            style: { font: "Inter", size: 12, color: "#000000", align: "left", leading: 0.65 },
          },
        ],
      },
    ],
  },
});

/** Un glifo de 5 mm por letra de «uno dos», todo en una línea. */
const glyphs: Glyph[] = [0, 1, 2, 3, 4, 5, 6].map((text_index) => ({
  text_index,
  line: 0,
  x: 20 + text_index * 5,
  y: 20,
  width: 5,
  line_height: 5,
  baseline: 24,
}));

const transform = canvasTransform({ width: 800, height: 600 }, { width: 210, height: 297, unit: "mm" }, 1, {
  x: 0,
  y: 0,
});

let container: HTMLDivElement;
let root: Root;
let ops: Array<Record<string, unknown>>;
/** Si el núcleo tiene que rechazar el cambio, con este mensaje. */
let refuse: string | null;

/** La barra, y los atajos registrados como en el lienzo. */
function Harness() {
  useTextFormat();
  return <FormatBar runs={runs} transform={transform} onFormat={applyFormat} />;
}

/** Como `Harness`, pero con los tramos del documento al día. */
function Live() {
  useTextFormat();
  const document = useDocumentStore((state) => state.document);
  const element = document?.pages[0]?.elements[0];
  const content = element?.type === "text" ? element.content : [];
  useEffect(() => undefined, [content]);
  return <FormatBar runs={content} transform={transform} onFormat={applyFormat} />;
}

beforeEach(() => {
  pretendMac(true);
  ops = [];
  refuse = null;
  mockIPC((command, args) => {
    if (command === "apply_op") {
      ops.push((args as { op: Record<string, unknown> }).op);
      if (refuse !== null) {
        throw { kind: "op", message: refuse };
      }
      const applied: AppliedOp = {
        revision: 2,
        document: structuredClone(useDocumentStore.getState().document!),
        description: "Dar formato",
        undo: "Dar formato",
        redo: null,
      };
      return applied;
    }
    return null;
  });
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useEditingStore.setState(useEditingStore.getInitialState(), true);
  useDocumentStore.getState().open(project());
  useEditingStore.getState().edit("t1", 0);
  useEditingStore.getState().setGlyphs(glyphs);
  container = window.document.createElement("div");
  window.document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMocks();
});

const bar = () => container.querySelector<HTMLElement>(".format-bar");
const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

async function key(init: KeyboardEventInit) {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("la barra de formato", () => {
  it("no sale si no hay nada seleccionado", () => {
    act(() => root.render(<Harness />));
    expect(bar()).toBeNull();
  });

  it("sale encima de lo seleccionado y enseña su formato", () => {
    act(() => useEditingStore.getState().select(4, 7));
    act(() => root.render(<Harness />));

    expect(bar()).not.toBeNull();
    // Encima de la primera línea de la selección: donde empieza «dos».
    expect(bar()?.style.left).toBe(`${toCanvas(transform, 40, 20).x}px`);
    expect(button("Negrita")?.getAttribute("aria-pressed")).toBe("true");
    expect(button("Cursiva")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("lo que no comparten todos los tramos no sale marcado", () => {
    act(() => useEditingStore.getState().select(0, 7));
    act(() => root.render(<Harness />));
    expect(button("Negrita")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("pulsar aplica el formato al tramo seleccionado", async () => {
    act(() => useEditingStore.getState().select(0, 7));
    act(() => root.render(<Harness />));
    await act(async () => {
      button("Negrita")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(ops).toEqual([
      { op: "format_text", id: "t1", from: 0, to: 7, format: { bold: true } },
    ]);
  });

  it("pulsar otra vez lo quita", async () => {
    act(() => useEditingStore.getState().select(4, 7));
    act(() => root.render(<Harness />));
    await act(async () => {
      button("Negrita")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(ops).toEqual([
      { op: "format_text", id: "t1", from: 4, to: 7, format: { bold: false } },
    ]);
  });
});

describe("el enlace", () => {
  /** Abre el campo del destino y escribe en él. */
  async function typeTarget(value: string) {
    await act(async () => {
      button("Enlace")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Destino del enlace"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return input;
  }

  it("se pone escribiendo el destino y se quita vaciándolo", async () => {
    act(() => useEditingStore.getState().select(0, 4));
    act(() => root.render(<Harness />));

    await typeTarget("https://typst.app");
    expect(ops).toEqual([
      {
        op: "format_text",
        id: "t1",
        from: 0,
        to: 4,
        format: { link: "https://typst.app" },
      },
    ]);

    ops = [];
    await typeTarget("");
    expect(ops).toEqual([
      { op: "format_text", id: "t1", from: 0, to: 4, format: { link: null } },
    ]);
  });

  it("si el núcleo lo rechaza, se dice y el campo sigue abierto", async () => {
    refuse = "el enlace \"javascript:alert(1)\" no vale: solo http://, https:// y mailto:";
    act(() => useEditingStore.getState().select(0, 4));
    act(() => root.render(<Harness />));

    await typeTarget("javascript:alert(1)");
    expect(container.textContent).toContain("no vale");
    expect(container.querySelector('input[aria-label="Destino del enlace"]')).not.toBeNull();
  });
});

describe("los atajos de formato", () => {
  it("⌘B, ⌘I y ⌘U aplican sobre lo seleccionado", async () => {
    act(() => useEditingStore.getState().select(0, 4));
    act(() => root.render(<Live />));

    await key({ key: "b", metaKey: true });
    await key({ key: "i", metaKey: true });
    await key({ key: "u", metaKey: true });
    expect(ops).toEqual([
      { op: "format_text", id: "t1", from: 0, to: 4, format: { bold: true } },
      { op: "format_text", id: "t1", from: 0, to: 4, format: { italic: true } },
      { op: "format_text", id: "t1", from: 0, to: 4, format: { underline: true } },
    ]);
  });

  it("sin selección no hacen nada", async () => {
    act(() => root.render(<Live />));
    await key({ key: "b", metaKey: true });
    expect(ops).toEqual([]);
  });
});
