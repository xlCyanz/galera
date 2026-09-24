/**
 * El lienzo sin ratón (F8-02, #89): recibe el foco, crea con Intro, entra
 * con Intro y selecciona todo con ⌘A.
 */
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OpenedProject } from "../commands";
import { useDocumentStore } from "../store/document";
import { useEditingStore } from "../store/editing";
import { useLayoutStore } from "../store/layout";
import { useToolStore } from "../store/tool";
import type { Element } from "../types/model";
import { Canvas } from "./Canvas";
import type { ImageLoader } from "./PageSvg";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loader: ImageLoader = {
  createUrl: (svg) => `blob:${svg}`,
  revokeUrl: () => undefined,
  decode: () => new Promise(() => undefined),
};

const rect = (id: string, extra: Partial<Element> = {}): Element =>
  ({ type: "rect", id, x: 10, y: 10, w: 20, h: 10, rotation: 0, fill: null, stroke: null, radius: 0, ...extra }) as Element;

const text: Element = {
  type: "text",
  id: "t1",
  x: 10,
  y: 40,
  w: 60,
  h: null,
  rotation: 0,
  content: [{ text: "Hola", bold: false, italic: false, underline: false }],
  style: { font: "Inter", size: 12, color: "#000000", align: "left", leading: 0.65 },
};

const group: Element = {
  type: "group",
  id: "g1",
  x: 100,
  y: 10,
  w: 40,
  h: 30,
  rotation: 0,
  children: [rect("hijo-abajo"), rect("hijo-arriba")],
} as Element;

/** Una página de 200 × 100 mm con de todo: suelto, bloqueado, oculto y
 * agrupado. */
const project: OpenedProject = {
  root: "/p",
  archive: null,
  revision: 1,
  document: {
    version: 1,
    meta: { title: "x" },
    fonts: ["fonts/Inter-Regular.ttf"],
    assets: {},
    variables: {},
    flows: {},
    pages: [
      {
        id: "p1",
        size: { width: 200, height: 100, unit: "mm" },
        elements: [rect("r1"), rect("bloqueado", { locked: true }), rect("oculto", { hidden: true }), text, group],
      },
    ],
  },
};

let container: HTMLDivElement;
let root: Root;
let asked: Array<{ command: string; args: Record<string, unknown> }>;

beforeEach(() => {
  asked = [];
  mockIPC((command, args) => {
    asked.push({ command, args: args as Record<string, unknown> });
    if (command === "apply_op") {
      return { revision: 2, document: project.document, description: "x", undo: null, redo: null };
    }
    if (command === "text_defaults") {
      return { font: "Inter", size: 12, color: "#000000", align: "left", leading: 0.65 };
    }
    return command === "glyphs" ? [] : null;
  });
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useLayoutStore.setState(useLayoutStore.getInitialState(), true);
  useEditingStore.setState(useEditingStore.getInitialState(), true);
  useToolStore.setState(useToolStore.getInitialState(), true);
  useDocumentStore.getState().open(project);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Canvas loader={loader} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMocks();
});

const viewport = () => container.querySelector<HTMLElement>(".canvas-viewport")!;

async function press(key: string, modifiers: { metaKey?: boolean; ctrlKey?: boolean } = {}, target?: HTMLElement) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers });
  await act(async () => {
    (target ?? viewport()).dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return event;
}

const created = () =>
  asked.filter((one) => one.command === "apply_op").map((one) => one.args.op as Record<string, unknown>);

describe("el lienzo con el teclado", () => {
  /** El criterio de la tarea: el tabulador llega al lienzo. */
  it("el lienzo es una parada del tabulador, con nombre", () => {
    expect(viewport().tabIndex).toBe(0);
    expect(viewport().getAttribute("role")).toBe("application");
    expect(viewport().getAttribute("aria-label")).toBe("Lienzo, página 1");
  });

  /** El criterio de la tarea: ninguna función es solo del ratón. Crear era
   * pulsar o arrastrar sobre la página. */
  it("Intro con una herramienta crea el elemento en el centro de la página", async () => {
    act(() => useToolStore.getState().setTool("rect"));
    const event = await press("Enter");

    expect(event.defaultPrevented).toBe(true);
    const op = created().find((one) => one.op === "create");
    expect(op).toBeDefined();
    const element = op!.element as { type: string; x: number; y: number; w: number; h: number };
    expect(element.type).toBe("rect");
    // 40 × 30 mm en una página de 200 × 100: la esquina en (80, 35).
    expect([element.x, element.y, element.w, element.h]).toEqual([80, 35, 40, 30]);
  });

  /** Entrar a escribir era doble clic. */
  it("Intro sobre un texto seleccionado entra a escribirlo", async () => {
    act(() => useDocumentStore.getState().select("t1"));
    await press("Enter");
    expect(useEditingStore.getState().element).toBe("t1");
  });

  /** Entrar en un grupo era doble clic. */
  it("Intro sobre un grupo entra en él y coge lo de arriba", async () => {
    act(() => useDocumentStore.getState().select("g1"));
    await press("Enter");

    expect(useDocumentStore.getState().enteredGroup).toBe("g1");
    expect(useDocumentStore.getState().selection).toEqual(["hijo-arriba"]);
  });

  it("Intro que llega de dentro del lienzo, de paso, no hace nada", async () => {
    act(() => useToolStore.getState().setTool("rect"));
    const child = document.createElement("span");
    viewport().append(child);
    await press("Enter", {}, child);
    child.remove();

    expect(created()).toEqual([]);
  });

  /** Seleccionar varios era arrastrar un rectángulo. */
  it("⌘A selecciona todo lo de la página, menos lo bloqueado y lo oculto", async () => {
    await press("a", { ctrlKey: true });
    expect(useDocumentStore.getState().selection).toEqual(["r1", "t1", "g1"]);
  });

  it("y dentro de un grupo, todo lo del grupo", async () => {
    act(() => useDocumentStore.getState().enterGroup("g1"));
    await press("a", { ctrlKey: true });
    expect(useDocumentStore.getState().selection).toEqual(["hijo-abajo", "hijo-arriba"]);
  });
});
