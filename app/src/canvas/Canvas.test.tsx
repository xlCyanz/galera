import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OpenedProject } from "../commands";
import { useCompilationStore } from "../store/compilation";
import { useDocumentStore } from "../store/document";
import { Canvas } from "./Canvas";
import { type ImageLoader, PageSvg } from "./PageSvg";
import { PX_PER_MM } from "./geometry";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Un cargador de imágenes controlado desde la prueba: cada decodificación
 * queda pendiente hasta que se llama a `finish(url)`.
 */
function controlledLoader() {
  let next = 0;
  const pending = new Map<string, () => void>();
  const revoked: string[] = [];
  const loader: ImageLoader = {
    createUrl: (svg) => `blob:${next++}:${svg}`,
    revokeUrl: (url) => revoked.push(url),
    decode: (url) => new Promise((resolve) => pending.set(url, resolve)),
  };
  async function finish(url: string) {
    await act(async () => {
      pending.get(url)?.();
      await Promise.resolve();
    });
  }
  return { loader, finish, revoked };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useCompilationStore.setState(useCompilationStore.getInitialState(), true);
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
});

const image = () => container.querySelector("img");

describe("PageSvg", () => {
  it("enseña el SVG cuando está decodificado, no antes", async () => {
    const { loader, finish } = controlledLoader();
    act(() => root.render(<PageSvg svg="<svg>1</svg>" width={100} height={141} label="Página 1" loader={loader} />));

    expect(image()).toBeNull();
    await finish("blob:0:<svg>1</svg>");
    expect(image()?.getAttribute("src")).toBe("blob:0:<svg>1</svg>");
  });

  it("al recompilar, la imagen anterior sigue a la vista hasta que la nueva está lista", async () => {
    const { loader, finish, revoked } = controlledLoader();
    const render = (svg: string) =>
      act(() => root.render(<PageSvg svg={svg} width={100} height={141} label="Página 1" loader={loader} />));

    render("<svg>1</svg>");
    await finish("blob:0:<svg>1</svg>");

    render("<svg>2</svg>");
    expect(image()?.getAttribute("src")).toBe("blob:0:<svg>1</svg>");
    expect(revoked).toEqual([]);

    await finish("blob:1:<svg>2</svg>");
    expect(image()?.getAttribute("src")).toBe("blob:1:<svg>2</svg>");
    expect(revoked).toEqual(["blob:0:<svg>1</svg>"]);
  });

  it("una versión que se queda vieja antes de decodificarse no llega a enseñarse", async () => {
    const { loader, finish, revoked } = controlledLoader();
    const render = (svg: string) =>
      act(() => root.render(<PageSvg svg={svg} width={100} height={141} label="Página 1" loader={loader} />));

    render("<svg>1</svg>");
    render("<svg>2</svg>");
    await finish("blob:1:<svg>2</svg>");
    await finish("blob:0:<svg>1</svg>");

    expect(image()?.getAttribute("src")).toBe("blob:1:<svg>2</svg>");
    expect(revoked).toEqual(["blob:0:<svg>1</svg>"]);
  });

  it("al desmontar libera la imagen", async () => {
    const { loader, finish, revoked } = controlledLoader();
    act(() => root.render(<PageSvg svg="<svg>1</svg>" width={100} height={141} label="Página 1" loader={loader} />));
    await finish("blob:0:<svg>1</svg>");

    act(() => root.render(<div />));
    expect(revoked).toEqual(["blob:0:<svg>1</svg>"]);
  });
});

/** Un proyecto con un texto que no debe aparecer nunca en el HTML. */
function project(): OpenedProject {
  return {
    root: "/proyectos/informe",
    revision: 1,
    archive: null,
    document: {
      version: 1,
      meta: { title: "Informe" },
      fonts: [],
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
              w: 170,
              h: null,
              rotation: 0,
              content: [{ text: "Texto secreto del documento", bold: false, italic: false, underline: false }],
              style: { font: "Inter", size: 12, color: "#000000", align: "left", leading: 0.65 },
            },
          ],
        },
        { id: "p2", size: { width: 8.5, height: 11, unit: "in" }, elements: [] },
      ],
    },
  };
}

const page = () => container.querySelector<HTMLElement>(".canvas-page");

describe("Canvas", () => {
  it("sin documento no hay página", () => {
    act(() => root.render(<Canvas />));
    expect(page()).toBeNull();
  });

  it("la página mide su tamaño en mm por la escala y el zoom", () => {
    const { loader } = controlledLoader();
    act(() => useDocumentStore.getState().open(project()));
    act(() => root.render(<Canvas loader={loader} />));

    expect(parseFloat(page()?.style.width ?? "")).toBeCloseTo(210 * PX_PER_MM, 6);
    expect(parseFloat(page()?.style.height ?? "")).toBeCloseTo(297 * PX_PER_MM, 6);

    act(() => useDocumentStore.getState().setZoom(2));
    const width = parseFloat(page()?.style.width ?? "");
    const height = parseFloat(page()?.style.height ?? "");
    expect(width).toBeCloseTo(420 * PX_PER_MM, 6);
    expect(height / width).toBeCloseTo(297 / 210, 9);

    const canvas = container.querySelector<HTMLElement>(".canvas");
    expect(parseFloat(canvas?.style.getPropertyValue("--px-per-mm") ?? "")).toBeCloseTo(2 * PX_PER_MM, 9);
  });

  it("enseña la página actual con su propio tamaño", async () => {
    const { loader, finish } = controlledLoader();
    act(() => useDocumentStore.getState().open(project()));
    act(() =>
      useCompilationStore.getState().finish({
        revision: 1,
        ms: 1,
        reused: false,
        diagnostics: [],
        pages: ["<svg>a4</svg>", "<svg>carta</svg>"],
        boxes: [],
        flows: [],
      }),
    );
    act(() => useDocumentStore.getState().setCurrentPage(1));
    act(() => root.render(<Canvas loader={loader} />));
    await finish("blob:0:<svg>carta</svg>");

    expect(page()?.getAttribute("aria-label")).toBe("Página 2 de 2");
    expect(parseFloat(page()?.style.width ?? "")).toBeCloseTo(816, 6);
    expect(image()?.getAttribute("src")).toBe("blob:0:<svg>carta</svg>");
  });

  it("con errores, sigue enseñando la última compilación buena", async () => {
    const { loader, finish } = controlledLoader();
    act(() => useDocumentStore.getState().open(project()));
    act(() =>
      useCompilationStore.getState().finish({
        revision: 1,
        ms: 1,
        reused: false,
        diagnostics: [],
        pages: ["<svg>bueno</svg>", "<svg>2</svg>"],
        boxes: [],
        flows: [],
      }),
    );
    act(() => root.render(<Canvas loader={loader} />));
    await finish("blob:0:<svg>bueno</svg>");

    act(() =>
      useCompilationStore.getState().fail({
        revision: 2,
        ms: 1,
        reused: false,
        diagnostics: [{ severity: "error", message: "unclosed delimiter", hints: [], element_id: "t1" }],
        error: { kind: "typst", message: "Typst encontró 1 error" },
      }),
    );
    expect(useCompilationStore.getState().status).toBe("error");
    expect(image()?.getAttribute("src")).toBe("blob:0:<svg>bueno</svg>");
  });

  it("mientras no hay SVG se ve la hoja en blanco, ya con su tamaño", () => {
    act(() => useDocumentStore.getState().open(project()));
    act(() => root.render(<Canvas loader={controlledLoader().loader} />));

    expect(page()).not.toBeNull();
    expect(image()).toBeNull();
  });

  it("ningún texto del documento se pinta con HTML", async () => {
    const { loader, finish } = controlledLoader();
    act(() => useDocumentStore.getState().open(project()));
    act(() =>
      useCompilationStore.getState().finish({
        revision: 1,
        ms: 1,
        reused: false,
        diagnostics: [],
        pages: ["<svg>glifos</svg>", "<svg>2</svg>"],
        boxes: [],
        flows: [],
      }),
    );
    act(() => root.render(<Canvas loader={loader} />));
    await finish("blob:0:<svg>glifos</svg>");

    // Lo que pinta el documento: solo la hoja y la imagen de Typst. Los
    // controles de zoom van aparte y solo traen sus propios textos.
    const viewport = container.querySelector(".canvas-viewport");
    expect(viewport?.textContent).toBe("");
    const tags = [...(viewport?.querySelectorAll("*") ?? [])].map((element) => element.tagName);
    expect(tags).toEqual(["DIV", "IMG"]);
    expect(image()?.getAttribute("alt")).toBe("");
    expect(container.innerHTML).not.toContain("secreto");
  });
});
