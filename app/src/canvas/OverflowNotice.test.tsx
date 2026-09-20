import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppliedOp, OpenedProject } from "../commands";
import { useDocumentStore } from "../store/document";
import { useLayoutStore, useOverflowing } from "../store/layout";
import type { LayoutBox } from "../types/layout";
import { OverflowNotice } from "./OverflowNotice";
import { canvasTransform, toCanvas } from "./transform";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const box = (overrides: Partial<LayoutBox> = {}): LayoutBox => ({
  id: "t1",
  page: 0,
  x: 20,
  y: 20,
  w: 80,
  h: 10,
  rotation: 0,
  bounds: { x: 20, y: 20, w: 80, h: 10 },
  line: null,
  overflow: 12.4,
  ...overrides,
});

const project: OpenedProject = {
  root: "/p",
  revision: 1,
  archive: null,
  document: {
    version: 1,
    meta: { title: "x" },
    fonts: [],
    assets: {},
    variables: {},
    pages: [{ id: "p1", size: { width: 210, height: 297, unit: "mm" }, elements: [] }],
  },
};

const transform = canvasTransform({ width: 800, height: 600 }, { width: 210, height: 297, unit: "mm" }, 1, {
  x: 0,
  y: 0,
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
        revision: 2,
        document: structuredClone(project.document),
        description: "Redimensionar t1",
        undo: "Redimensionar t1",
        redo: null,
      };
      return applied;
    }
    return null;
  });
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useLayoutStore.setState(useLayoutStore.getInitialState(), true);
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

const notice = () => container.querySelector<HTMLElement>(".overflow-notice");

describe("el aviso de lo que no cabe", () => {
  it("dice cuánto sobra, pegado debajo del elemento", () => {
    act(() => root.render(<OverflowNotice box={box()} transform={transform} />));

    expect(notice()?.textContent).toContain("12,4 mm");
    // Justo bajo la caja: en su esquina de abajo a la izquierda.
    const corner = toCanvas(transform, 20, 30);
    expect(notice()?.style.left).toBe(`${corner.x}px`);
    expect(notice()?.style.top).toBe(`${corner.y}px`);
  });

  it("ajustar el alto se lo quita, y lo mide Typst", async () => {
    act(() => root.render(<OverflowNotice box={box()} transform={transform} />));
    await act(async () => {
      container.querySelector("button")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(ops).toEqual([{ op: "resize", id: "t1", x: 20, y: 20, w: 80, h: null }]);
  });
});

describe("qué cajas se avisan", () => {
  /** Enseña los ids que devuelve el selector para una página. */
  function Listed({ page }: { page: number }) {
    const boxes = useOverflowing(page);
    return <p>{boxes.map((one) => one.id).join(",")}</p>;
  }

  it("solo las de la página, y solo las que se salen", () => {
    act(() =>
      useLayoutStore
        .getState()
        .update(1, [
          box({ id: "se-sale" }),
          box({ id: "cabe", overflow: 0 }),
          box({ id: "otra-pagina", page: 1 }),
        ]),
    );
    act(() => root.render(<Listed page={0} />));
    expect(container.textContent).toBe("se-sale");

    act(() => root.render(<Listed page={1} />));
    expect(container.textContent).toBe("otra-pagina");
  });
});
