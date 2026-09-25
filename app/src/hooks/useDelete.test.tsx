import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppliedOp, OpenedProject } from "../commands";
import { useDocumentStore } from "../store/document";
import type { Element } from "../types/model";
import { deleteOp, deletesFrom, splitLocked, useDelete } from "./useDelete";
import { pretendMac } from "./useShortcuts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rect = (id: string, x: number, locked = false): Element => ({
  type: "rect", id, x, y: 10, w: 40, h: 20, rotation: 0, fill: "#ff0000", stroke: null, radius: 0,
  ...(locked ? { locked: true } : {}),
});

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
        elements: [rect("r1", 10), rect("r2", 60), rect("fondo", 0, true)],
      },
    ],
  },
};

/** Lo que devuelve el backend al aplicar: el documento sin nada. */
const emptied = structuredClone(project.document);
emptied.pages[0]!.elements = [rect("fondo", 0, true)];

function Probe() {
  useDelete();
  return null;
}

let container: HTMLDivElement;
let root: Root;
/** Los comandos que se han mandado a aplicar. */
let applied: unknown[];

beforeEach(() => {
  pretendMac(true);
  applied = [];
  mockIPC((command, args) => {
    if (command === "apply_op") {
      applied.push((args as { op: unknown }).op);
      const result: AppliedOp = {
        revision: 2,
        document: structuredClone(emptied),
        description: "Eliminar 2 elementos",
        undo: "Eliminar 2 elementos",
        redo: null,
      };
      return result;
    }
    return null;
  });

  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useDocumentStore.getState().open(project);

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Probe />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMocks();
});

const store = () => useDocumentStore.getState();

/** Pulsa una tecla con el foco en `target`, o en ninguna parte. */
function press(key: string, target: EventTarget = window, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("borrar con Supr", () => {
  /** El criterio de la tarea: Supr o ⌫ borra lo seleccionado, de una vez. */
  it("borra lo seleccionado en un solo paso, y deja sin selección", async () => {
    act(() => store().selectMany(["r1", "r2"]));
    const event = press("Backspace");
    await settle();

    expect(event.defaultPrevented).toBe(true);
    expect(applied).toEqual([
      {
        op: "batch",
        ops: [
          { op: "delete", id: "r1" },
          { op: "delete", id: "r2" },
        ],
      },
    ]);
    expect(store().selection).toEqual([]);
    expect(store().history.undo).toBe("Eliminar 2 elementos");
  });

  it("Supr hace lo mismo, y con uno solo va el borrado suelto", async () => {
    act(() => store().select("r1"));
    press("Delete");
    await settle();
    expect(applied).toEqual([{ op: "delete", id: "r1" }]);
  });

  it("sin nada seleccionado, la tecla sigue su camino", async () => {
    const event = press("Delete");
    await settle();
    expect(applied).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  /** Lo bloqueado está bloqueado para no tocarlo por accidente. */
  it("lo bloqueado no se borra y se queda seleccionado", async () => {
    act(() => store().selectMany(["r1", "fondo"]));
    press("Delete");
    await settle();
    expect(applied).toEqual([{ op: "delete", id: "r1" }]);
    expect(store().selection).toEqual(["fondo"]);
  });

  it("si solo hay bloqueados, no hace nada", async () => {
    act(() => store().select("fondo"));
    const event = press("Delete");
    await settle();
    expect(applied).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it("con ⌘ u otra tecla de más, no es este atajo", async () => {
    act(() => store().select("r1"));
    press("Backspace", window, { metaKey: true });
    press("Delete", window, { altKey: true });
    await settle();
    expect(applied).toEqual([]);
  });
});

describe("dónde vale la tecla", () => {
  /** El criterio de la tarea: escribiendo, la tecla es del texto. */
  it("escribiendo en un campo borra texto, no elementos", async () => {
    act(() => store().select("r1"));
    for (const tag of ["input", "textarea", "select"]) {
      const field = document.createElement(tag);
      container.append(field);
      press("Backspace", field);
      field.remove();
    }
    await settle();
    expect(applied).toEqual([]);
  });

  it("en el lienzo y en la lista de capas, sí", async () => {
    act(() => store().select("r1"));
    const canvas = document.createElement("div");
    canvas.setAttribute("role", "application");
    const inside = document.createElement("span");
    canvas.append(inside);
    const layers = document.createElement("ol");
    layers.className = "layers is-dragging";
    container.append(canvas, layers);

    expect(deletesFrom(canvas)).toBe(true);
    expect(deletesFrom(inside)).toBe(true);
    expect(deletesFrom(layers)).toBe(true);
    expect(deletesFrom(document.body)).toBe(true);

    press("Delete", canvas);
    await settle();
    expect(applied).toHaveLength(1);
  });

  /** El criterio de la tarea: ni en un diálogo. Tampoco donde la tecla
   * puede querer decir otra cosa. */
  it("en un diálogo, un menú, la lista de páginas o un botón, no", async () => {
    act(() => store().select("r1"));
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const button = document.createElement("button");
    dialog.append(button);
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const pages = document.createElement("ol");
    pages.setAttribute("role", "listbox");
    pages.setAttribute("aria-label", "Páginas");
    const panelButton = document.createElement("button");
    container.append(dialog, menu, pages, panelButton);

    for (const target of [button, menu, pages, panelButton]) {
      expect(deletesFrom(target)).toBe(false);
      const event = press("Delete", target);
      expect(event.defaultPrevented).toBe(false);
    }
    await settle();
    expect(applied).toEqual([]);
  });
});

describe("las piezas", () => {
  it("deleteOp: uno suelto o un lote", () => {
    expect(deleteOp(["a"])).toEqual({ op: "delete", id: "a" });
    expect(deleteOp(["a", "b"])).toEqual({
      op: "batch",
      ops: [
        { op: "delete", id: "a" },
        { op: "delete", id: "b" },
      ],
    });
  });

  it("splitLocked mira también dentro de los grupos", () => {
    const document = structuredClone(project.document);
    document.pages[0]!.elements.push({
      type: "group", id: "g1", x: 0, y: 0, w: 10, h: 10, rotation: 0,
      children: [rect("hijo", 0, true), rect("libre", 5)],
    } as Element);
    expect(splitLocked(document, ["r1", "hijo", "libre", "fondo"])).toEqual({
      deletable: ["r1", "libre"],
      locked: ["hijo", "fondo"],
    });
  });
});
