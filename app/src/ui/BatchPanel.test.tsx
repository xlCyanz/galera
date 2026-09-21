import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LoadedCsv, OpenedProject } from "../commands";
import { useDocumentStore } from "../store/document";
import { BatchPanel } from "./BatchPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const project: OpenedProject = {
  root: "/p",
  archive: null,
  revision: 1,
  document: {
    version: 1,
    meta: { title: "Lote" },
    fonts: [],
    assets: {},
    variables: {
      empresa: { kind: "text", value: "" },
      fecha: { kind: "date", value: "" },
    },
    pages: [{ id: "p1", size: { width: 210, height: 297, unit: "mm" }, elements: [] }],
  },
};

/** Lo que devuelve el backend al leer el CSV. */
const loaded: LoadedCsv = {
  path: "/p/clientes.csv",
  separator: ";",
  encoding: "utf8",
  headers: ["Empresa", "Fecha"],
  rows: [
    ["Una", "2026-09-21"],
    ["", "2026-02-31"],
  ],
  mapping: { columns: { empresa: 0, fecha: 1 } },
  checked: [
    { number: 1, values: { empresa: "Una", fecha: "2026-09-21" }, problems: [] },
    {
      number: 2,
      values: { empresa: "", fecha: "2026-02-31" },
      problems: [
        { variable: "empresa", message: "la fila no trae valor" },
        { variable: "fecha", message: "no es una fecha AAAA-MM-DD que exista" },
      ],
    },
  ],
};

let container: HTMLDivElement;
let root: Root;
let asked: Array<{ command: string; args: Record<string, unknown> }>;
/** Si el diálogo se cancela. */
let cancelled: boolean;

beforeEach(() => {
  asked = [];
  cancelled = false;
  mockIPC((command, args) => {
    asked.push({ command, args: args as Record<string, unknown> });
    if (command === "choose_csv") {
      return cancelled ? null : loaded;
    }
    if (command === "read_csv") {
      const { separator } = args as { separator: string };
      return { ...loaded, separator };
    }
    if (command === "check_rows") {
      return loaded.checked;
    }
    return null;
  });

  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useDocumentStore.getState().open(project);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<BatchPanel />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMocks();
});

const chooseButton = () =>
  [...container.querySelectorAll("button")].find((one) => one.textContent === "Elegir CSV…")!;
const select = (label: string) =>
  container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
const rows = () => [...container.querySelectorAll<HTMLElement>("[data-row]")];

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function choose() {
  act(() => chooseButton().click());
  await settle();
}

function change(element: HTMLSelectElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    setter.call(element, value);
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("el panel de lote", () => {
  it("sin CSV solo ofrece elegir uno", () => {
    expect(chooseButton()).toBeDefined();
    expect(container.querySelector(".batch-preview")).toBeNull();
  });

  /** El criterio de la tarea: se ven el separador y la codificación. */
  it("al elegir un CSV enseña lo que el núcleo ha detectado", async () => {
    await choose();

    const separator = container.querySelector<HTMLSelectElement>(".batch-options select")!;
    expect(separator.value).toBe(";");
    expect(container.textContent).toContain("2 filas");
    expect(container.textContent).toContain("1 con problemas");
  });

  /** El criterio de la tarea: el emparejamiento se ve y se cambia. */
  it("enseña qué columna rellena cada variable, y se puede cambiar", async () => {
    await choose();
    expect(select("Columna de empresa")?.value).toBe("0");
    expect(select("Columna de fecha")?.value).toBe("1");

    change(select("Columna de fecha")!, "");
    await settle();

    const asking = asked.at(-1);
    expect(asking?.command).toBe("check_rows");
    expect((asking?.args as { mapping: { columns: Record<string, number | null> } }).mapping.columns)
      .toEqual({ empresa: 0, fecha: null });
  });

  /** El criterio de la tarea: vista previa de las primeras filas. */
  it("enseña las primeras filas con sus valores", async () => {
    await choose();
    expect(rows()).toHaveLength(2);
    expect(rows()[0]?.textContent).toContain("Una");
    expect(rows()[0]?.textContent).toContain("2026-09-21");
  });

  /** El criterio de la tarea: las filas con problemas se marcan. */
  it("marca la fila incompleta y dice qué le pasa", async () => {
    await choose();
    const broken = rows()[1]!;
    expect(broken.className).toContain("is-broken");
    expect(broken.textContent).toContain("no trae valor");
    expect(broken.textContent).toContain("no es una fecha");
  });

  it("cambiar el separador vuelve a leer el archivo", async () => {
    await choose();
    const separator = container.querySelector<HTMLSelectElement>(".batch-options select")!;
    change(separator, ",");
    await settle();

    const asking = asked.at(-1);
    expect(asking?.command).toBe("read_csv");
    expect(asking?.args).toMatchObject({ path: "/p/clientes.csv", separator: "," });
  });

  it("si se cancela el diálogo no se enseña nada", async () => {
    cancelled = true;
    await choose();
    expect(container.querySelector(".batch-preview")).toBeNull();
  });
});
