import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useDocumentStore } from "../store/document";
import type { Element } from "../types/model";
import { TableInspector } from "./TableInspector";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cell = (text: string) => ({
  content: [{ text, bold: false, italic: false, underline: false }],
  colspan: 1,
  rowspan: 1,
});

const table: Element & { type: "table" } = {
  type: "table",
  id: "tb1",
  x: 10,
  y: 10,
  w: 80,
  h: null,
  rotation: 0,
  columns: [{ width: "auto" }, { width: "fixed", mm: 25 }],
  rows: [{ cells: [cell("Enero"), cell("12")] }],
  style: { font: "Inter", size: 10, color: "#000000", align: "left", leading: 0.65 },
  inset: 2,
};

let container: HTMLDivElement;
let root: Root;
let asked: Array<Record<string, unknown>>;

beforeEach(() => {
  asked = [];
  mockIPC((command, args) => {
    if (command === "apply_op") {
      asked.push((args as { op: Record<string, unknown> }).op);
      return { revision: 2, document: null, description: "x", undo: null, redo: null };
    }
    return null;
  });
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<TableInspector element={table} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMocks();
});

const button = (label: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

async function click(label: string) {
  await act(async () => {
    button(label)!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("el inspector de una tabla", () => {
  /** El criterio de la tarea: filas y columnas desde el inspector. */
  it("añade y quita filas", async () => {
    await click("Añadir una fila");
    expect(asked.at(-1)).toMatchObject({ op: "insert_table_row", id: "tb1", index: 1 });
    // Con una sola fila no se puede quitar la última: dejaría una tabla
    // sin nada que componer.
    expect(button("Quitar la última fila")?.disabled).toBe(true);
  });

  it("añade y quita columnas", async () => {
    await click("Añadir una columna");
    // La nueva mide como la última, para que la tabla no dé un salto.
    expect(asked.at(-1)).toMatchObject({
      op: "insert_table_column",
      id: "tb1",
      index: 2,
      width: { width: "fixed", mm: 25 },
    });

    await click("Quitar la última columna");
    expect(asked.at(-1)).toMatchObject({ op: "remove_table_column", id: "tb1", index: 1 });
  });

  /** El criterio de la tarea: lo que mide cada columna. */
  it("cambia cómo mide una columna", async () => {
    const select = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Ancho de la columna 1"]',
    )!;
    expect(select.value).toBe("auto");

    await act(async () => {
      select.value = "fraction";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(asked.at(-1)).toMatchObject({
      op: "set_column_width",
      id: "tb1",
      column: 0,
      width: { width: "fraction", fr: 1 },
    });
  });

  /** Una columna automática no enseña número: lo que mide lo decide Typst. */
  it("solo las columnas con número tienen campo", () => {
    expect(
      container.querySelector('input[aria-label="Ancho de la columna 1"]'),
    ).toBeNull();
    expect(
      container.querySelector('input[aria-label="Ancho de la columna 2"]'),
    ).not.toBeNull();
  });
});
