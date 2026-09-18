import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppliedOp, FileDrop, ImportedImages, OpenedProject } from "../commands";
import { useCompilationStore } from "../store/compilation";
import { useDocumentStore } from "../store/document";
import { useLayoutStore } from "../store/layout";
import { useToolStore } from "../store/tool";
import type { Document, Element } from "../types/model";
import { Canvas } from "./Canvas";
import type { ImageLoader } from "./PageSvg";
import { canvasTransform, toCanvas } from "./transform";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loader: ImageLoader = { createUrl: (svg) => `blob:${svg}`, revokeUrl: () => undefined, decode: () => Promise.resolve() };
const AREA = { width: 1000, height: 600 };
const size = { width: 200, height: 100, unit: "mm" } as const;
const project: OpenedProject = {
  root: "/p",
  revision: 1,
  document: { version: 1, meta: { title: "x" }, fonts: [], assets: {}, variables: {}, pages: [{ id: "p1", size, elements: [] }] },
};

let container: HTMLDivElement;
let root: Root;
let drop: ((drop: FileDrop) => void) | null;
let calls: Array<{ command: string; args: unknown }>;
let created: Element[];
let groups: Array<string | null>;
/** Lo que contesta el backend al añadir imágenes. */
let answer: (paths: string[]) => ImportedImages;

const withAssets = (keys: string[]): Document => {
  const document = structuredClone(useDocumentStore.getState().document!);
  for (const key of keys) {
    document.assets[key] = `assets/${key}.png`;
  }
  return document;
};

const imported = (keys: string[], rejected: ImportedImages["rejected"] = []): ImportedImages => ({
  applied: keys.length === 0 ? null : { revision: 2, document: withAssets(keys), description: "Añadir imágenes", undo: null, redo: null },
  images: keys.map((key) => ({ key, path: `assets/${key}.png` })),
  rejected,
});

beforeEach(async () => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => AREA.width });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => AREA.height });
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ left: 0, top: 0, right: AREA.width, bottom: AREA.height, width: AREA.width, height: AREA.height }),
  });
  drop = null;
  calls = [];
  created = [];
  groups = [];
  answer = (paths) => imported(paths.map((path) => path.replace(/^.*\//, "").replace(/\..*$/, "")));
  mockIPC((command, args) => {
    calls.push({ command, args });
    if (command === "import_images") {
      return answer((args as { paths: string[] }).paths);
    }
    if (command === "choose_images") {
      return answer(["/elegida/foto.jpg"]);
    }
    if (command === "apply_op") {
      const { op, group } = args as { op: { element: Element }; group: string | null };
      created.push(op.element);
      groups.push(group);
      const document = structuredClone(useDocumentStore.getState().document!);
      document.pages[0]!.elements.push(op.element);
      const applied: AppliedOp = { revision: 3, document, description: "Crear", undo: "Crear", redo: null };
      return applied;
    }
    return null;
  });
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useLayoutStore.setState(useLayoutStore.getInitialState(), true);
  useCompilationStore.setState(useCompilationStore.getInitialState(), true);
  useToolStore.setState(useToolStore.getInitialState(), true);
  useDocumentStore.getState().open(project);

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const subscribe = (handler: (event: FileDrop) => void) => {
    drop = handler;
    return Promise.resolve(() => {
      drop = null;
    });
  };
  await act(async () => {
    root.render(<Canvas loader={loader} subscribeToDrops={subscribe} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMocks();
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  delete (HTMLElement.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
});

function screen(x: number, y: number) {
  const { zoom, scroll } = useDocumentStore.getState();
  return toCanvas(canvasTransform(AREA, size, zoom, scroll), x, y);
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

async function dropAt(paths: string[], x: number, y: number) {
  const at = screen(x, y);
  act(() => drop!({ type: "over", x: at.x, y: at.y }));
  act(() => drop!({ type: "drop", paths, x: at.x, y: at.y }));
  await settle();
}

const viewport = () => container.querySelector<HTMLElement>(".canvas-viewport")!;
const notice = () => container.querySelector<HTMLElement>(".canvas-notice");

describe("soltar imágenes desde el sistema", () => {
  it("mientras se arrastra encima, el lienzo lo marca", () => {
    const at = screen(10, 10);
    act(() => drop!({ type: "over", x: at.x, y: at.y }));
    expect(viewport().className).toContain("is-drop-target");
    act(() => drop!({ type: "leave" }));
    expect(viewport().className).not.toContain("is-drop-target");
  });

  it("inserta la imagen en el punto donde se soltó, con su proporción, y la selecciona", async () => {
    await dropAt(["/fotos/logo.png"], 40, 25);
    expect(calls.find((c) => c.command === "import_images")?.args).toEqual({ paths: ["/fotos/logo.png"] });
    expect(useDocumentStore.getState().document?.assets).toMatchObject({ logo: "assets/logo.png" });
    expect(created).toEqual([{ type: "image", id: "image-1", x: 40, y: 25, w: 60, h: null, rotation: 0, asset: "logo" }]);
    expect(useDocumentStore.getState().selectedElement).toBe("image-1");
  });

  it("varias a la vez se insertan todas, en un único paso del historial", async () => {
    await dropAt(["/fotos/a.png", "/fotos/b.jpg", "/fotos/c.svg"], 10, 10);
    expect(created.map((e) => e.type === "image" && e.asset)).toEqual(["a", "b", "c"]);
    expect(new Set(groups).size).toBe(1);
    expect(groups[0]).toMatch(/^insert-images-/);
    expect(useDocumentStore.getState().selectedElement).toBe("image-3");
  });

  it("lo que no es una imagen se rechaza con un mensaje claro, y el resto se inserta", async () => {
    answer = () => imported(["logo"], [{ file: "/docs/informe.pdf", message: "informe.pdf no es una imagen que Galera sepa usar" }]);
    await dropAt(["/docs/informe.pdf", "/fotos/logo.png"], 10, 10);
    expect(notice()!.textContent).toContain("informe.pdf no es una imagen");
    expect(created).toHaveLength(1);
    act(() => [...notice()!.querySelectorAll("button")].find((b) => b.textContent === "Cerrar")!.click());
    expect(notice()).toBeNull();
  });

  it("lo que se suelta fuera del lienzo no es para él", async () => {
    act(() => drop!({ type: "over", x: AREA.width + 50, y: 10 }));
    expect(viewport().className).not.toContain("is-drop-target");
    act(() => drop!({ type: "drop", paths: ["/fotos/logo.png"], x: AREA.width + 50, y: 10 }));
    await settle();
    expect(calls.some((c) => c.command === "import_images")).toBe(false);
  });

  it("si nada se puede añadir, no se crea nada", async () => {
    answer = () => imported([], [{ file: "/x.pdf", message: "x.pdf no es una imagen" }]);
    await dropAt(["/x.pdf"], 10, 10);
    expect(created).toHaveLength(0);
    expect(notice()).not.toBeNull();
  });
});

describe("herramienta de imagen", () => {
  it("un clic abre el diálogo e inserta lo elegido donde se pulsó; vuelve a selección", async () => {
    act(() => useToolStore.getState().setTool("image"));
    const at = screen(30, 20);
    act(() => {
      viewport().dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: at.x, clientY: at.y }));
    });
    await settle();
    expect(calls.some((c) => c.command === "choose_images")).toBe(true);
    expect(created).toEqual([{ type: "image", id: "image-1", x: 30, y: 20, w: 60, h: null, rotation: 0, asset: "foto" }]);
    expect(useToolStore.getState().tool).toBe("select");
  });

  it("si se cancela el diálogo, no pasa nada y sigue la herramienta", async () => {
    answer = () => imported([]);
    act(() => useToolStore.getState().setTool("image"));
    const at = screen(30, 20);
    act(() => {
      viewport().dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: at.x, clientY: at.y }));
    });
    await settle();
    expect(created).toHaveLength(0);
    expect(notice()).toBeNull();
    expect(useToolStore.getState().tool).toBe("image");
  });
});
