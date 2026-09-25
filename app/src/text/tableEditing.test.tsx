import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Canvas } from "../canvas/Canvas";
import type { ImageLoader } from "../canvas/PageSvg";
import { PX_PER_MM } from "../canvas/geometry";
import type { OpenedProject } from "../commands";
import { useDocumentStore } from "../store/document";
import { useEditingStore } from "../store/editing";
import { useLayoutStore } from "../store/layout";
import { useToolStore } from "../store/tool";
import type { CellBox, Glyph, LayoutBox } from "../types/layout";
import type { Element as ModelElement } from "../types/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loader: ImageLoader = {
  createUrl: (svg) => `blob:${svg}`,
  revokeUrl: () => undefined,
  decode: () => new Promise(() => undefined),
};

const cell = (text: string) => ({
  content: [{ text, bold: false, italic: false, underline: false }],
  colspan: 1,
  rowspan: 1,
});

/** Una tabla de dos columnas y dos filas, en (10, 10) y de 80 × 20 mm. */
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
        elements: [
          {
            type: "table",
            id: "tb1",
            x: 10,
            y: 10,
            w: 80,
            h: null,
            rotation: 0,
            columns: [{ width: "auto" }, { width: "auto" }],
            rows: [
              { cells: [cell("Enero"), cell("Norte")] },
              { cells: [cell("Marzo"), cell("Sur")] },
            ],
            style: { font: "Inter", size: 10, color: "#000000", align: "left", leading: 0.65 },
            inset: 2,
          },
        ],
      },
    ],
  },
};

const tableBox: LayoutBox = {
  id: "tb1",
  page: 0,
  x: 10,
  y: 10,
  w: 80,
  h: 20,
  rotation: 0,
  bounds: { x: 10, y: 10, w: 80, h: 20 },
  line: null,
  overflow: 0,
};

/** Las cuatro celdas, de 40 × 10 mm cada una. */
const cells: CellBox[] = [
  { table: "tb1", page: 0, row: 0, column: 0, colspan: 1, rowspan: 1, x: 10, y: 10, w: 40, h: 10 },
  { table: "tb1", page: 0, row: 0, column: 1, colspan: 1, rowspan: 1, x: 50, y: 10, w: 40, h: 10 },
  { table: "tb1", page: 0, row: 1, column: 0, colspan: 1, rowspan: 1, x: 10, y: 20, w: 40, h: 10 },
  { table: "tb1", page: 0, row: 1, column: 1, colspan: 1, rowspan: 1, x: 50, y: 20, w: 40, h: 10 },
];

/** Los glifos de «Enero», uno por letra, dentro de la primera celda. */
const scene: Glyph[] = [..."Enero"].map((_, text_index) => ({
  page: 0,
  text_index,
  line: 0,
  x: 12 + text_index * 3,
  y: 12,
  width: 3,
  line_height: 5,
  baseline: 16,
}));

// jsdom no maqueta: el área mide 1000 × 600 px y empieza en (40, 30).
const AREA = { left: 40, top: 30, width: 1000, height: 600 };

let container: HTMLDivElement;
let root: Root;
/** Qué contesta el núcleo a `element_at`. */
let found: string | null;
/** Si no es null, el núcleo se niega a aplicar comandos con este mensaje. */
let refuse: string | null;
/** Lo que se le ha pedido al backend. */
let asked: Array<{ command: string; args: Record<string, unknown> }>;
const restore: Array<() => void> = [];

beforeEach(() => {
  const proto = HTMLElement.prototype;
  const original = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function (this: HTMLElement) {
    return this.classList.contains("canvas-viewport")
      ? new DOMRect(AREA.left, AREA.top, AREA.width, AREA.height)
      : original.call(this);
  };
  Object.defineProperty(proto, "clientWidth", { configurable: true, get: () => AREA.width });
  Object.defineProperty(proto, "clientHeight", { configurable: true, get: () => AREA.height });
  restore.push(() => {
    proto.getBoundingClientRect = original;
    delete (proto as { clientWidth?: number }).clientWidth;
    delete (proto as { clientHeight?: number }).clientHeight;
  });

  found = null;
  refuse = null;
  asked = [];
  mockIPC((command, args) => {
    asked.push({ command, args: args as Record<string, unknown> });
    if (command === "element_at") {
      return found;
    }
    if (command === "cell_glyphs") {
      return scene;
    }
    if (command === "column_edges") {
      return [10, 50, 90];
    }
    if (command === "apply_op") {
      if (refuse !== null) {
        throw { kind: "op", message: refuse };
      }
      return {
        revision: 2,
        document: project.document,
        description: "Escribir",
        undo: null,
        redo: null,
      };
    }
    return command === "glyphs" ? [] : null;
  });

  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useLayoutStore.setState(useLayoutStore.getInitialState(), true);
  useEditingStore.setState(useEditingStore.getInitialState(), true);
  useToolStore.setState(useToolStore.getInitialState(), true);
  useDocumentStore.getState().open(project);
  useLayoutStore.getState().update(1, [tableBox], cells);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Canvas loader={loader} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMocks();
  while (restore.length > 0) restore.pop()?.();
});

const viewport = () => container.querySelector<HTMLElement>(".canvas-viewport")!;
const input = () => container.querySelector("textarea");
const marked = () => [...container.querySelectorAll<HTMLElement>(".table-cell.is-marked")];

/** El punto de la pantalla donde cae un punto de la página, en mm. */
function screenPoint(x: number, y: number) {
  const left = AREA.left + (AREA.width - 200 * PX_PER_MM) / 2;
  const top = AREA.top + (AREA.height - 100 * PX_PER_MM) / 2;
  return { clientX: left + x * PX_PER_MM, clientY: top + y * PX_PER_MM };
}

async function doubleClick(x: number, y: number) {
  const { clientX, clientY } = screenPoint(x, y);
  await act(async () => {
    viewport().dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, cancelable: true, button: 0, clientX, clientY }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function press(x: number, y: number, modifiers: { shiftKey?: boolean } = {}) {
  const { clientX, clientY } = screenPoint(x, y);
  await act(async () => {
    viewport().dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX,
        clientY,
        ...modifiers,
      }),
    );
    window.dispatchEvent(new MouseEvent("pointerup", { clientX, clientY }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Entra a escribir la primera celda. */
async function enter() {
  found = "tb1";
  await doubleClick(12, 12);
}

const opsAsked = () =>
  asked
    .filter((one) => one.command === "apply_op")
    .map((one) => one.args.op as Record<string, unknown>);

describe("escribir en una tabla", () => {
  /** El criterio de la tarea: doble clic en una celda entra a editarla. */
  it("doble clic entra en la celda que hay debajo, no en la tabla", async () => {
    await enter();

    const state = useEditingStore.getState();
    expect(state.cell).toEqual({ table: "tb1", row: 0, column: 0 });
    expect(state.element).toBeNull();
    expect(input()).not.toBeNull();
    // El cursor entra al final del texto de esa celda.
    expect(state.start).toBe("Enero".length);
  });

  it("pulsar en otra celda pasa a escribir esa", async () => {
    await enter();
    await press(60, 12);

    expect(useEditingStore.getState().cell).toEqual({ table: "tb1", row: 0, column: 1 });
  });

  /** El criterio de la tarea: el tabulador pasa a la siguiente. */
  it("el tabulador pasa a la celda siguiente y ⇧ a la anterior", async () => {
    await enter();
    const field = input()!;

    await act(async () => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(useEditingStore.getState().cell).toEqual({ table: "tb1", row: 0, column: 1 });

    await act(async () => {
      input()!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(useEditingStore.getState().cell).toEqual({ table: "tb1", row: 0, column: 0 });
  });

  it("escribir manda un comando de la celda", async () => {
    await enter();
    const field = input()!;

    await act(async () => {
      field.value = "Enero!";
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const op = opsAsked().find((one) => one.op === "insert_cell_text");
    expect(op).toMatchObject({ id: "tb1", row: 0, column: 0, text: "!" });
  });

  it("pide los glifos de la celda", async () => {
    await enter();
    expect(asked.some((one) => one.command === "cell_glyphs")).toBe(true);
  });

  /** El criterio de la tarea: se marcan varias celdas para el formato. */
  it("⇧ + clic suma otra celda a las marcadas", async () => {
    await enter();
    await press(60, 12, { shiftKey: true });

    const state = useEditingStore.getState();
    expect(state.cell).toEqual({ table: "tb1", row: 0, column: 0 });
    expect(state.marked).toEqual([{ row: 0, column: 1 }]);
    // La que se escribe y la marcada se ven señaladas en el lienzo.
    expect(marked()).toHaveLength(2);
  });

  it("el formato con varias marcadas va a todas en un solo comando", async () => {
    await enter();
    await press(60, 12, { shiftKey: true });

    const { applyFormat } = await import("./useTextFormat");
    await act(async () => {
      await applyFormat({ bold: true });
    });

    const op = opsAsked().at(-1);
    expect(op?.op).toBe("batch");
    const ops = op?.ops as Array<Record<string, unknown>>;
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({ op: "format_cell_text", row: 0, column: 0 });
    expect(ops[1]).toMatchObject({ op: "format_cell_text", row: 0, column: 1 });
  });
});

describe("la rejilla desde el lienzo", () => {
  /** El criterio de la tarea: filas y columnas desde el menú contextual. */
  it("el botón derecho sobre una celda ofrece meter y quitar", async () => {
    const { clientX, clientY } = screenPoint(12, 12);
    await act(async () => {
      viewport().dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX, clientY }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const menu = container.querySelector(".table-menu");
    expect(menu).not.toBeNull();

    const button = [...menu!.querySelectorAll("button")].find(
      (one) => one.textContent === "Insertar fila debajo",
    );
    await act(async () => {
      button!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(opsAsked().at(-1)).toMatchObject({ op: "insert_table_row", id: "tb1", index: 1 });
  });

  /** El criterio de la tarea: arrastrar el borde de una columna. */
  it("arrastrar un borde cambia el ancho de las dos columnas que toca", async () => {
    // La tabla se selecciona: entonces salen sus bordes.
    found = "tb1";
    await press(12, 12);
    await act(async () => {
      useDocumentStore.getState().select("tb1");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const handle = container.querySelector<HTMLElement>("[data-column-edge='1']");
    expect(handle).not.toBeNull();

    const from = screenPoint(50, 15);
    const to = screenPoint(60, 15);
    await act(async () => {
      handle!.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: from.clientX,
          clientY: from.clientY,
        }),
      );
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: to.clientX, clientY: to.clientY }));
      window.dispatchEvent(new MouseEvent("pointerup", { clientX: to.clientX, clientY: to.clientY }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const op = opsAsked().at(-1);
    expect(op?.op).toBe("batch");
    const ops = op?.ops as Array<Record<string, unknown>>;
    expect(ops[0]).toMatchObject({ op: "set_column_width", column: 0, width: { width: "fixed", mm: 50 } });
    expect(ops[1]).toMatchObject({ op: "set_column_width", column: 1, width: { width: "fixed", mm: 30 } });
  });
});

describe("el menú de la tabla con el teclado", () => {
  const menuItems = () => [...container.querySelectorAll<HTMLElement>('.table-menu [role="menuitem"]')];

  async function key(target: HTMLElement, name: string, shiftKey = false) {
    await act(async () => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key: name, shiftKey, bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  /** El criterio de la tarea: ninguna función es solo del ratón. El menú
   * era el botón derecho. */
  it("⇧F10 escribiendo en una celda abre el menú, con el foco dentro", async () => {
    await enter();
    const field = input()!;
    field.focus();
    await key(field, "F10", true);

    expect(container.querySelector(".table-menu")).not.toBeNull();
    expect(document.activeElement).toBe(menuItems()[0]);
  });

  it("las flechas recorren las opciones dando la vuelta", async () => {
    await enter();
    await key(input()!, "ContextMenu");
    const items = menuItems();

    await key(document.activeElement as HTMLElement, "ArrowDown");
    expect(document.activeElement).toBe(items[1]);
    await key(document.activeElement as HTMLElement, "ArrowUp");
    await key(document.activeElement as HTMLElement, "ArrowUp");
    // La última a la que se llega: las desactivadas —combinar sin nada
    // marcado, separar una celda que no está combinada— no cogen el foco.
    expect(document.activeElement).toBe(items.filter((item) => !(item as HTMLButtonElement).disabled).at(-1));
  });

  it("Esc lo cierra y el foco vuelve al texto de la celda", async () => {
    await enter();
    const field = input()!;
    field.focus();
    await key(field, "ContextMenu");
    await key(document.activeElement as HTMLElement, "Escape");

    expect(container.querySelector(".table-menu")).toBeNull();
    expect(document.activeElement).toBe(field);
    // Y se sigue escribiendo en la misma celda.
    expect(useEditingStore.getState().cell).toEqual({ table: "tb1", row: 0, column: 0 });
  });
});

describe("la barra de formato con el teclado", () => {
  async function key(target: HTMLElement, name: string, modifiers: { altKey?: boolean } = {}) {
    await act(async () => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...modifiers }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  /** El criterio de la tarea: el color y el enlace de la barra no son solo
   * del ratón. */
  it("⌥F10 lleva a la barra, ← y → la recorren y Esc vuelve al texto", async () => {
    await enter();
    act(() => useEditingStore.getState().select(0, 3));
    const field = input()!;
    field.focus();

    await key(field, "F10", { altKey: true });
    const buttons = [...container.querySelectorAll<HTMLElement>(".format-bar > button")];
    expect(buttons.length).toBeGreaterThan(0);
    expect(document.activeElement).toBe(buttons[0]);
    // Ir a la barra no deja de escribir.
    expect(useEditingStore.getState().cell).not.toBeNull();

    await key(buttons[0]!, "ArrowRight");
    expect(document.activeElement).toBe(buttons[1]);
    await key(buttons[1]!, "ArrowLeft");
    await key(buttons[0]!, "ArrowLeft");
    expect(document.activeElement).not.toBe(buttons[0]);

    await key(document.activeElement as HTMLElement, "Escape");
    expect(document.activeElement).toBe(field);
    expect(useEditingStore.getState().cell).toEqual({ table: "tb1", row: 0, column: 0 });
  });
});

describe("combinar y separar celdas", () => {
  const item = (text: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('.table-menu [role="menuitem"]')].find(
      (one) => one.textContent === text,
    )!;

  async function openMenu() {
    await act(async () => {
      input()!.dispatchEvent(new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function click(button: HTMLButtonElement) {
    await act(async () => {
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  /** El criterio de la tarea: se combinan las celdas marcadas. */
  it("combina la celda con las marcadas, en el rectángulo que las contiene", async () => {
    await enter();
    await openMenu();
    // Sin nada marcado no hay qué combinar, y una celda suelta no se separa.
    expect(item("Combinar celdas").disabled).toBe(true);
    expect(item("Separar la celda").disabled).toBe(true);
    act(() => {
      useEditingStore.getState().markCell(1, 1);
    });
    expect(item("Combinar celdas").disabled).toBe(false);

    await click(item("Combinar celdas"));
    expect(opsAsked().at(-1)).toEqual({ op: "merge_cells", id: "tb1", row: 0, column: 0, rows: 2, columns: 2 });
    expect(container.querySelector(".table-menu")).toBeNull();
  });

  it("si el núcleo no puede, el menú se queda y dice por qué", async () => {
    await enter();
    act(() => {
      useEditingStore.getState().markCell(0, 1);
    });
    await openMenu();
    refuse = "no se puede en la tabla \"tb1\": el borde parte una celda combinada";
    await click(item("Combinar celdas"));
    expect(container.querySelector(".table-menu")).not.toBeNull();
    expect(container.querySelector('.table-menu [role="alert"]')?.textContent).toContain("el borde parte una celda combinada");
  });

  it("una celda combinada se separa", async () => {
    const merged = structuredClone(project);
    const table = merged.document.pages[0]!.elements[0] as Extract<ModelElement, { type: "table" }>;
    table.rows[0]!.cells = [{ ...table.rows[0]!.cells[0]!, colspan: 2 }];
    act(() => useDocumentStore.getState().open(merged));
    await enter();
    await openMenu();
    expect(item("Separar la celda").disabled).toBe(false);
    await click(item("Separar la celda"));
    expect(opsAsked().at(-1)).toEqual({ op: "split_cell", id: "tb1", row: 0, column: 0 });
  });
});

