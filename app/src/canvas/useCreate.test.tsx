import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppliedOp, OpenedProject } from "../commands";
import { useCompilationStore } from "../store/compilation";
import { useDocumentStore } from "../store/document";
import { useLayoutStore } from "../store/layout";
import { useToolStore } from "../store/tool";
import type { Element, TextStyle } from "../types/model";
import { Canvas } from "./Canvas";
import type { ImageLoader } from "./PageSvg";
import { DEFAULT_SIZE } from "./createGeometry";
import { PX_PER_MM } from "./geometry";
import { canvasTransform, toCanvas } from "./transform";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loader: ImageLoader = {
  createUrl: (svg) => `blob:${svg}`,
  revokeUrl: () => undefined,
  decode: () => Promise.resolve(),
};

const AREA = { width: 1000, height: 600 };
const size = { width: 200, height: 100, unit: "mm" } as const;
const project: OpenedProject = {
  root: "/p",
  archive: null,
  revision: 1,
  document: { version: 1, meta: { title: "x" }, fonts: [], assets: {}, variables: {}, pages: [{ id: "p1", size, elements: [] }] },
};

let container: HTMLDivElement;
let root: Root;
let ops: Array<{ op: string; page: string; index: number | null; element: Element }>;
/** Lo que contestan los comandos de fuentes. */
let style: TextStyle | null;
let fontDialog: "inter" | "cancel" | "not-a-font";
let calls: string[];

beforeEach(async () => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => AREA.width });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => AREA.height });
  ops = [];
  calls = [];
  style = { font: "Inter", size: 14, color: "#333333", align: "left", leading: 0.65 };
  fontDialog = "inter";
  mockIPC((command, args) => {
    calls.push(command);
    if (command === "text_defaults") {
      return style;
    }
    if (command === "add_font") {
      if (fontDialog === "cancel") {
        return null;
      }
      if (fontDialog === "not-a-font") {
        throw { kind: "font", message: "falsa.ttf no es una fuente que Galera sepa leer" };
      }
      style = { font: "Inter", size: 12, color: "#000000", align: "left", leading: 0.65 };
      const document = structuredClone(project.document);
      document.fonts = ["fonts/Inter-Regular.ttf"];
      const added: AppliedOp = { revision: 50, document, description: "Añadir la fuente", undo: null, redo: null };
      return added;
    }
    if (command === "apply_op") {
      const op = (args as { op: (typeof ops)[number] }).op;
      ops.push(op);
      // El backend aplica sobre lo que tiene: aquí, lo que hay en el store.
      // Una zona de texto llega en un lote, con su flujo.
      const document = structuredClone(useDocumentStore.getState().document ?? project.document);
      const steps = (op as unknown as { op: string; ops?: Array<Record<string, unknown>> }).ops ?? [op as unknown as Record<string, unknown>];
      let element = op.element;
      for (const step of steps) {
        if (step.op === "create") {
          element = step.element as Element;
          document.pages[0]!.elements.push(element);
        } else if (step.op === "create_flow") {
          document.flows = { ...document.flows, [step.name as string]: structuredClone(step.flow) as NonNullable<typeof document.flows>[string] };
        } else if (step.op === "link_zone") {
          const zones = document.flows![step.flow as string]!.zones;
          zones.splice((step.index as number | null) ?? zones.length, 0, step.zone as string);
        }
      }
      const applied: AppliedOp = { revision: 1 + ops.length, document, description: `Crear ${element.id}`, undo: `Crear ${element.id}`, redo: null };
      return applied;
    }
    return null;
  });
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useLayoutStore.setState(useLayoutStore.getInitialState(), true);
  useCompilationStore.setState(useCompilationStore.getInitialState(), true);
  useToolStore.setState(useToolStore.getInitialState(), true);
  useDocumentStore.getState().open(project);
  useCompilationStore.getState().finish({ revision: 1, ms: 1, reused: false, diagnostics: [], keys: [], pages: ["<svg/>"], boxes: [], flows: [], cells: [] });
  useLayoutStore.getState().update(1, []);

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Canvas loader={loader} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMocks();
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
});

/** Un punto de la página, en mm, en la pantalla (el área está en el origen en jsdom). */
function screen(x: number, y: number) {
  const { zoom, scroll } = useDocumentStore.getState();
  return toCanvas(canvasTransform(AREA, size, zoom, scroll), x, y);
}

const viewport = () => container.querySelector<HTMLElement>(".canvas-viewport")!;
const preview = () => container.querySelector<HTMLElement>(".create-preview");

function down(x: number, y: number) {
  const at = screen(x, y);
  act(() => {
    viewport().dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: at.x, clientY: at.y }));
  });
}

function move(x: number, y: number, init: MouseEventInit = {}) {
  const at = screen(x, y);
  act(() => {
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: at.x, clientY: at.y, ...init }));
  });
}

async function up() {
  await act(async () => {
    window.dispatchEvent(new MouseEvent("pointerup"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function tool(name: "rect" | "ellipse" | "line" | "text" | "code" | "table" | "flow") {
  act(() => useToolStore.getState().setTool(name));
}

describe("crear formas", () => {
  it("el arrastre enseña la forma antes de crearla", () => {
    tool("rect");
    down(20, 30);
    move(60, 55);
    expect(ops).toHaveLength(0);
    expect(preview()!.dataset.shape).toBe("rect");
    expect(parseFloat(preview()!.style.width)).toBeCloseTo(40 * PX_PER_MM * useDocumentStore.getState().zoom, 6);
  });

  it("al soltar se crea con un único comando, queda seleccionada y se vuelve a la selección", async () => {
    tool("rect");
    down(20, 30);
    move(60, 55);
    await up();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: "create", page: "p1", index: null });
    expect(ops[0]!.element).toMatchObject({ type: "rect", id: "rect-1", x: 20, y: 30, w: 40, h: 25, fill: "#cbd5e1" });
    expect(useDocumentStore.getState().selection).toEqual(["rect-1"]);
    expect(useToolStore.getState().tool).toBe("select");
    expect(useDocumentStore.getState().history.undo).toBe("Crear rect-1");

    // La vista previa se queda hasta que llega lo compilado con el elemento.
    expect(preview()).not.toBeNull();
    act(() => useLayoutStore.getState().update(2, []));
    expect(preview()).toBeNull();
  });

  it("un clic sin arrastrar crea el tamaño por defecto", async () => {
    tool("ellipse");
    down(20, 30);
    await up();
    expect(ops[0]!.element).toMatchObject({ type: "ellipse", x: 20, y: 30, ...DEFAULT_SIZE.ellipse });
  });

  it("Shift fuerza un círculo y una línea a 45°", async () => {
    tool("ellipse");
    down(20, 30);
    move(60, 40, { shiftKey: true });
    await up();
    expect(ops[0]!.element).toMatchObject({ w: 40, h: 40 });

    tool("line");
    down(10, 10);
    move(40, 12, { shiftKey: true });
    await up();
    const line = ops[1]!.element;
    expect(line).toMatchObject({ type: "line", id: "line-1", x: 10, y: 10, y2: 10 });
    expect(line.type === "line" && line.stroke).toEqual({ color: "#1f2733", width: 0.5 });
  });

  it("Esc cancela sin crear nada y sin cambiar de herramienta", async () => {
    tool("rect");
    down(20, 30);
    move(60, 55);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    });
    await up();
    expect(ops).toHaveLength(0);
    expect(preview()).toBeNull();
    expect(useToolStore.getState().tool).toBe("rect");
  });

  it("con la herramienta de selección, arrastrar no crea nada", async () => {
    down(20, 30);
    move(60, 55);
    await up();
    expect(ops).toHaveLength(0);
  });
});

describe("crear texto", () => {
  const notice = () => container.querySelector<HTMLElement>(".canvas-notice");
  const button = (text: string) => [...(notice()?.querySelectorAll("button") ?? [])].find((b) => b.textContent === text)!;

  it("arrastrar define el ancho, deja h: null y usa el estilo del documento", async () => {
    tool("text");
    down(20, 30);
    move(90, 80);
    expect(preview()!.dataset.shape).toBe("text");
    await up();
    expect(ops).toHaveLength(1);
    expect(ops[0]!.element).toMatchObject({
      type: "text",
      id: "text-1",
      x: 20,
      y: 30,
      w: 70,
      h: null,
      style: { font: "Inter", size: 14, color: "#333333" },
    });
    expect(useDocumentStore.getState().selection).toEqual(["text-1"]);
    expect(useToolStore.getState().tool).toBe("select");
  });

  it("sin fuentes avisa y ofrece añadir una; al añadirla se crea el texto", async () => {
    style = null;
    tool("text");
    down(20, 30);
    await up();
    expect(ops).toHaveLength(0);
    expect(notice()!.textContent).toContain("no tiene ninguna fuente");

    // Cancelar el diálogo deja el aviso.
    fontDialog = "cancel";
    await act(async () => {
      button("Añadir fuente…").click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(notice()).not.toBeNull();

    // Un archivo que no es una fuente: lo dice.
    fontDialog = "not-a-font";
    await act(async () => {
      button("Añadir fuente…").click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(notice()!.textContent).toContain("no es una fuente");

    fontDialog = "inter";
    await act(async () => {
      button("Añadir fuente…").click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(notice()).toBeNull();
    expect(useDocumentStore.getState().document?.fonts).toEqual(["fonts/Inter-Regular.ttf"]);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.element).toMatchObject({ type: "text", x: 20, y: 30, w: DEFAULT_SIZE.text.w, style: { font: "Inter", size: 12 } });
    expect(useDocumentStore.getState().selection).toEqual(["text-1"]);
  });

  it("Cancelar o Esc cierran el aviso sin crear nada", async () => {
    style = null;
    tool("text");
    down(20, 30);
    await up();
    act(() => button("Cancelar").click());
    expect(notice()).toBeNull();

    down(20, 30);
    await up();
    expect(notice()).not.toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    });
    expect(notice()).toBeNull();
    expect(ops).toHaveLength(0);
    expect(calls).not.toContain("add_font");
  });
});

describe("crear un bloque de código", () => {
  it("se crea arrastrando, como una forma, y queda seleccionado", async () => {
    tool("code");
    down(20, 30);
    move(100, 70);
    expect(preview()!.dataset.shape).toBe("code");
    await up();
    expect(ops[0]!.element).toMatchObject({ type: "code", id: "code-1", x: 20, y: 30, w: 80, h: 40 });
    expect(useDocumentStore.getState().selection).toEqual(["code-1"]);
    expect(useToolStore.getState().tool).toBe("select");
  });
});

describe("crear una tabla", () => {
  const notice = () => container.querySelector<HTMLElement>(".canvas-notice");

  it("arrastrar define el ancho; tres por tres, con el estilo del documento, y queda seleccionada", async () => {
    tool("table");
    down(20, 30);
    move(140, 80);
    expect(preview()!.dataset.shape).toBe("table");
    await up();
    expect(ops).toHaveLength(1);
    const table = ops[0]!.element;
    expect(table).toMatchObject({
      type: "table",
      id: "table-1",
      x: 20,
      y: 30,
      w: 120,
      h: null,
      style: { font: "Inter", size: 14 },
    });
    if (table.type !== "table") {
      throw new Error("es una tabla");
    }
    expect(table.columns).toHaveLength(3);
    expect(table.rows.map((row) => row.cells.length)).toEqual([3, 3, 3]);
    expect(useDocumentStore.getState().selection).toEqual(["table-1"]);
    expect(useToolStore.getState().tool).toBe("select");
  });

  /** Como un texto: sin fuentes no se puede, y lo dice. */
  it("sin fuentes avisa, hablando de tablas", async () => {
    style = null;
    tool("table");
    down(20, 30);
    await up();
    expect(ops).toHaveLength(0);
    expect(notice()!.textContent).toContain("para poder crear tablas");
  });
});

describe("crear una zona de texto", () => {
  it("sin nada seleccionado empieza un texto que fluye; con la zona seleccionada, la siguiente sigue su texto", async () => {
    tool("flow");
    down(20, 30);
    move(100, 130);
    expect(preview()!.dataset.shape).toBe("flow");
    await up();
    expect(ops[0]).toMatchObject({
      op: "batch",
      ops: [
        { op: "create_flow", name: "flujo-1", flow: { style: { font: "Inter" }, zones: [] } },
        { op: "create", element: { type: "flow", id: "flow-1", x: 20, y: 30, w: 80, h: 100, flow: "flujo-1" } },
        { op: "link_zone", flow: "flujo-1", zone: "flow-1", index: null },
      ],
    });
    // Queda seleccionada: la siguiente zona sigue su texto.
    expect(useDocumentStore.getState().selection).toEqual(["flow-1"]);

    tool("flow");
    down(110, 30);
    move(190, 130);
    await up();
    expect(ops[1]).toEqual({
      op: "batch",
      ops: [
        { op: "create", page: "p1", index: null, element: { type: "flow", id: "flow-2", x: 110, y: 30, w: 80, h: 100, rotation: 0, flow: "flujo-1" } },
        { op: "link_zone", flow: "flujo-1", zone: "flow-2", index: 1 },
      ],
    });
    expect(useDocumentStore.getState().document?.flows?.["flujo-1"]?.zones).toEqual(["flow-1", "flow-2"]);
  });
});

