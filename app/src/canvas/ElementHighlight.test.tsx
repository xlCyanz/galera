import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OpenedProject } from "../commands";
import { useDocumentStore } from "../store/document";
import { Canvas } from "./Canvas";
import type { ImageLoader } from "./PageSvg";
import { PX_PER_MM } from "./geometry";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loader: ImageLoader = {
  createUrl: (svg) => `blob:${svg}`,
  revokeUrl: () => undefined,
  decode: () => new Promise(() => undefined),
};

const project: OpenedProject = {
  root: "/p",
  revision: 1,
  document: {
    version: 1,
    meta: { title: "Informe" },
    fonts: [],
    assets: {},
    variables: {},
    pages: [
      { id: "p1", size: { width: 210, height: 297, unit: "mm" }, elements: [] },
      {
        id: "p2",
        size: { width: 210, height: 297, unit: "mm" },
        elements: [
          { type: "code", id: "c1", x: 120, y: 200, w: 60, h: 40, rotation: 0, source: "#table(" },
          {
            type: "text",
            id: "t1",
            x: 20,
            y: 30,
            w: 100,
            h: null,
            rotation: 0,
            content: [{ text: "Hola", bold: false, italic: false, underline: false }],
            style: { font: "Inter", size: 12, color: "#000000", align: "left", leading: 0.65 },
          },
        ],
      },
    ],
  },
};

// jsdom no maqueta: el área mide 800 × 600 px.
const AREA = { width: 800, height: 600 };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => AREA.width });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => AREA.height });
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useDocumentStore.getState().open(project);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Canvas loader={loader} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
});

/** Lee `translate(x, y)` de un estilo. */
function translate(element: Element | null) {
  const style = (element as HTMLElement | null)?.style.transform ?? "";
  const match = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\)/.exec(style);
  return { x: Number(match?.[1]), y: Number(match?.[2]) };
}

const highlight = () => container.querySelector<HTMLElement>(".element-highlight");

describe("ir a un elemento", () => {
  it("cambia a su página, lo centra en el área y lo recuadra", () => {
    act(() => useDocumentStore.getState().setZoom(2));
    act(() => {
      useDocumentStore.getState().focusElement("c1");
    });

    expect(container.querySelector(".canvas-page")?.getAttribute("aria-label")).toBe("Página 2 de 2");

    const scale = PX_PER_MM * 2;
    const box = highlight();
    expect(box).not.toBeNull();
    expect(parseFloat(box!.style.width)).toBeCloseTo(60 * scale, 6);
    expect(parseFloat(box!.style.height)).toBeCloseTo(40 * scale, 6);

    // El recuadro está donde dice el documento, sobre la página…
    const page = translate(container.querySelector(".canvas-page"));
    const at = translate(box);
    expect(at.x).toBeCloseTo(page.x + 120 * scale, 6);
    expect(at.y).toBeCloseTo(page.y + 200 * scale, 6);

    // …y su centro, en el centro del área.
    expect(at.x + (60 * scale) / 2).toBeCloseTo(AREA.width / 2, 6);
    expect(at.y + (40 * scale) / 2).toBeCloseTo(AREA.height / 2, 6);
  });

  it("si el alto lo decide Typst, el recuadro queda abierto por abajo", () => {
    act(() => {
      useDocumentStore.getState().focusElement("t1");
    });
    expect(highlight()?.className).toBe("element-highlight is-open");
  });

  it("Escape quita el resaltado", () => {
    act(() => {
      useDocumentStore.getState().focusElement("c1");
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(highlight()).toBeNull();
  });

  it("el resaltado solo se ve en la página del elemento", () => {
    act(() => {
      useDocumentStore.getState().focusElement("c1");
    });
    act(() => useDocumentStore.getState().setCurrentPage(0));
    expect(highlight()).toBeNull();
  });
});
