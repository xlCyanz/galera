import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppliedOp, OpenedProject } from "../commands";
import { useCompilationStore } from "../store/compilation";
import { useDocumentStore } from "../store/document";
import { useLayoutStore } from "../store/layout";
import type { LayoutBox } from "../types/layout";
import type { Element } from "../types/model";
import { pretendMac } from "../hooks/useShortcuts";
import { Canvas } from "./Canvas";
import type { ImageLoader } from "./PageSvg";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loader: ImageLoader = {
  createUrl: (svg) => `blob:${svg}`,
  revokeUrl: () => undefined,
  decode: () => Promise.resolve(),
};

const rect = (id: string, x: number, y: number): Element => ({
  type: "rect", id, x, y, w: 40, h: 20, rotation: 0, fill: "#ff0000", stroke: null, radius: 0,
});

/** El documento con dos rectángulos sueltos. */
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
      { id: "p1", size: { width: 200, height: 100, unit: "mm" }, elements: [rect("r1", 10, 10), rect("r2", 100, 50)] },
    ],
  },
};

/** El mismo documento con los dos dentro de un grupo. */
const grouped: OpenedProject = {
  ...project,
  document: {
    ...project.document,
    pages: [
      {
        id: "p1",
        size: { width: 200, height: 100, unit: "mm" },
        elements: [
          {
            type: "group", id: "grupo-1", x: 10, y: 10, w: 130, h: 60, rotation: 0,
            children: [rect("r1", 0, 0), rect("r2", 90, 40)],
          },
        ],
      },
    ],
  },
};

const box = (id: string, x: number, y: number, w: number, h: number): LayoutBox => ({
  id, page: 0, x, y, w, h, rotation: 0, bounds: { x, y, w, h }, line: null, overflow: 0,
});

let container: HTMLDivElement;
let root: Root;
let ops: Array<Record<string, unknown>>;
/** Lo que contesta `element_at`, por lo que se le pregunta. */
let hits: Array<{ below: string | null; id: string | null }>;
const restore: Array<() => void> = [];

beforeEach(async () => {
  // Los atajos de agrupar llevan ⌘ en macOS y Ctrl en el resto.
  pretendMac(true);
  const proto = HTMLElement.prototype;
  const original = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function (this: HTMLElement) {
    return this.classList.contains("canvas-viewport") ? new DOMRect(0, 0, 1000, 600) : original.call(this);
  };
  Object.defineProperty(proto, "clientWidth", { configurable: true, get: () => 1000 });
  Object.defineProperty(proto, "clientHeight", { configurable: true, get: () => 600 });
  restore.push(() => {
    proto.getBoundingClientRect = original;
    delete (proto as { clientWidth?: number }).clientWidth;
    delete (proto as { clientHeight?: number }).clientHeight;
  });

  ops = [];
  hits = [];
  mockIPC((command, args) => {
    if (command === "apply_op") {
      const op = (args as { op: Record<string, unknown> }).op;
      ops.push(op);
      const applied: AppliedOp = {
        revision: 1 + ops.length,
        // Lo que devuelve el núcleo: el documento ya agrupado.
        document: structuredClone(op.op === "group" ? grouped.document : project.document),
        description: "",
        undo: null,
        redo: null,
      };
      return applied;
    }
    if (command === "element_at") {
      const below = (args as { below: string | null }).below;
      return hits.find((one) => one.below === below)?.id ?? null;
    }
    return null;
  });

  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useLayoutStore.setState(useLayoutStore.getInitialState(), true);
  useCompilationStore.setState(useCompilationStore.getInitialState(), true);
  useDocumentStore.getState().open(project);
  const boxes = [box("r1", 10, 10, 40, 20), box("r2", 100, 50, 40, 20)];
  useCompilationStore
    .getState()
    .finish({ revision: 1, ms: 1, reused: false, diagnostics: [], keys: [], pages: ["<svg/>"], boxes, flows: [], cells: [] });
  useLayoutStore.getState().update(1, boxes);

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
  while (restore.length > 0) restore.pop()?.();
});

const viewport = () => container.querySelector<HTMLElement>(".canvas-viewport")!;
const entered = () => container.querySelector(".entered-group");
const store = () => useDocumentStore.getState();

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function press(key: string, init: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  });
}

function doubleClick(x: number, y: number) {
  act(() => {
    viewport().dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }),
    );
  });
}

describe("agrupar y desagrupar", () => {
  /** El criterio de la tarea: ⌘G agrupa con la caja conjunta. */
  it("⌘G manda un solo comando con la caja que contiene a los dos", async () => {
    act(() => store().selectMany(["r1", "r2"]));
    press("g", { metaKey: true });
    await settle();

    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({
      op: "group",
      ids: ["r1", "r2"],
      id: "grupo-1",
      // De (10,10) a (140,70).
      rect: { x: 10, y: 10, w: 130, h: 60 },
    });
    // Y el grupo nuevo queda seleccionado.
    expect(store().selection).toEqual(["grupo-1"]);
  });

  it("con menos de dos elementos no agrupa nada", async () => {
    act(() => store().select("r1"));
    press("g", { metaKey: true });
    await settle();
    expect(ops).toHaveLength(0);
  });

  /** El criterio de la tarea: ⇧⌘G desagrupa. */
  it("⌘⇧G deshace el grupo y deja seleccionado lo que llevaba dentro", async () => {
    act(() => {
      store().open(grouped);
      store().select("grupo-1");
    });
    press("g", { metaKey: true, shiftKey: true });
    await settle();

    expect(ops).toEqual([{ op: "ungroup", id: "grupo-1" }]);
    expect(store().selection).toEqual(["r1", "r2"]);
  });

  it("sin ningún grupo seleccionado no desagrupa nada", async () => {
    act(() => store().select("r1"));
    press("g", { metaKey: true, shiftKey: true });
    await settle();
    expect(ops).toHaveLength(0);
  });
});

describe("entrar en un grupo", () => {
  beforeEach(async () => {
    act(() => {
      store().open(grouped);
      store().select("grupo-1");
    });
    const boxes = [box("r1", 10, 10, 40, 20), box("r2", 100, 50, 40, 20), box("grupo-1", 10, 10, 130, 60)];
    act(() => useLayoutStore.getState().update(1, boxes));
    await settle();
  });

  /** El criterio de la tarea: doble clic entra en el grupo. */
  it("doble clic coge al hijo que hay debajo y marca el grupo", async () => {
    hits = [
      { below: null, id: "grupo-1" },
      { below: "grupo-1", id: "r2" },
    ];
    doubleClick(400, 300);
    await settle();

    expect(store().enteredGroup).toBe("grupo-1");
    expect(store().selection).toEqual(["r2"]);
    expect(entered()).not.toBeNull();
  });

  it("Escape sale del grupo sin deseleccionar el documento entero", async () => {
    hits = [
      { below: null, id: "grupo-1" },
      { below: "grupo-1", id: "r2" },
    ];
    doubleClick(400, 300);
    await settle();

    press("Escape");
    expect(store().enteredGroup).toBeNull();
    expect(entered()).toBeNull();
  });

  it("seleccionar algo de fuera del grupo sale de él", async () => {
    hits = [
      { below: null, id: "grupo-1" },
      { below: "grupo-1", id: "r1" },
    ];
    doubleClick(400, 300);
    await settle();
    expect(store().enteredGroup).toBe("grupo-1");

    act(() => store().select("grupo-1"));
    expect(store().enteredGroup).toBeNull();
  });
});
