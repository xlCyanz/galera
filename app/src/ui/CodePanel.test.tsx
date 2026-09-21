import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GeneratedCode, OpenedProject } from "../commands";
import { useDocumentStore } from "../store/document";
import { CodePanel } from "./CodePanel";

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
        id: "p1",
        size: { width: 200, height: 100, unit: "mm" },
        elements: [
          { type: "rect", id: "r1", x: 10, y: 10, w: 40, h: 20, rotation: 0, fill: "#ff0000", stroke: null, radius: 0 },
        ],
      },
    ],
  },
};

/** El código de mentira que devuelve el backend, con una tilde por delante. */
const HEAD = "// Página p1\n";
const RECT = '#place(top + left, dx: 10mm, dy: 10mm)[#rect(width: 40mm)] <el-r1>';
const code = `${HEAD}${RECT}\n`;

/** Los bytes que ocupa la cabecera: «Página» lleva una tilde. */
const headBytes = new TextEncoder().encode(HEAD).length;

const generated: GeneratedCode = {
  code,
  spans: [{ id: "r1", start: headBytes, end: headBytes + RECT.length }],
  revision: 1,
};

let container: HTMLDivElement;
let root: Root;
let asked: number;
let written: string[];
const restore: Array<() => void> = [];

beforeEach(async () => {
  asked = 0;
  written = [];

  const had = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (text: string) => {
        written.push(text);
        return Promise.resolve();
      },
    },
  });
  restore.push(() => {
    if (had === undefined) {
      delete (navigator as { clipboard?: unknown }).clipboard;
    } else {
      Object.defineProperty(navigator, "clipboard", had);
    }
  });

  // CodeMirror mide el texto con un rango del DOM, que jsdom no implementa.
  const proto = Range.prototype as unknown as { getClientRects?: unknown; getBoundingClientRect?: unknown };
  const rects = { list: proto.getClientRects, box: proto.getBoundingClientRect };
  proto.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  proto.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
  restore.push(() => {
    proto.getClientRects = rects.list;
    proto.getBoundingClientRect = rects.box;
  });

  mockIPC((command) => {
    if (command === "generated_code") {
      asked += 1;
      return generated;
    }
    return null;
  });

  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useDocumentStore.getState().open(project);

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<CodePanel />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMocks();
  while (restore.length > 0) restore.pop()?.();
});

const editor = () => container.querySelector<HTMLElement>(".cm-content");
const marked = () => container.querySelector<HTMLElement>(".cm-selected-element");
const copyButton = () => container.querySelector<HTMLButtonElement>("button");

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("el panel de código", () => {
  it("enseña el código generado, y no se edita", () => {
    expect(editor()?.textContent).toContain("#place(top + left");
    expect(editor()?.getAttribute("contenteditable")).toBe("false");
  });

  /** El criterio de la tarea: deja claro que el código es una salida. */
  it("dice que el código lo genera Galera y no se edita", () => {
    const notice = container.querySelector(".code-notice")?.textContent ?? "";
    expect(notice).toContain("genera");
    expect(notice).toContain("no se edita");
  });

  /** El criterio de la tarea: el elemento seleccionado se marca. */
  it("marca el trozo del elemento seleccionado", async () => {
    expect(marked()).toBeNull();

    act(() => useDocumentStore.getState().select("r1"));
    await settle();

    expect(marked()?.textContent).toContain("<el-r1>");
    // La cabecera lleva una tilde: si se marcara por el byte, entraría de
    // más y el trozo empezaría en otro sitio.
    expect(marked()?.textContent?.startsWith("#place(")).toBe(true);
  });

  /** El criterio de la tarea: el panel se actualiza con el documento. */
  it("vuelve a pedir el código cuando cambia el documento", async () => {
    expect(asked).toBe(1);

    act(() => {
      const next = structuredClone(project.document);
      next.meta.title = "otro";
      useDocumentStore.getState().replaceDocument(next);
    });
    await settle();

    expect(asked).toBe(2);
  });

  /** El criterio de la tarea: hay un botón para copiar el código. */
  it("copia el código entero al portapapeles", async () => {
    copyButton()?.click();
    await settle();

    expect(written).toEqual([code]);
    expect(copyButton()?.textContent).toBe("Copiado");
  });
});
