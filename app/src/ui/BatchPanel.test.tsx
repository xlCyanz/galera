import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BatchEvents, type LoadedCsv, type OpenedProject } from "../commands";
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
/** Cómo se contesta a `generate_batch`: se resuelve desde la prueba. */
let generation: { resolve: (outcome: unknown) => void };

beforeEach(() => {
  asked = [];
  cancelled = false;
  generation = { resolve: () => undefined };
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
    if (command === "generate_batch") {
      // Queda a medias hasta que la prueba lo resuelva: así se puede mirar
      // lo que se enseña mientras se genera.
      return new Promise((resolve) => {
        generation.resolve = resolve;
      });
    }
    return null;
  }, { shouldMockEvents: true });

  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useDocumentStore.getState().open(project);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<BatchPanel />));
});

afterEach(async () => {
  act(() => root.unmount());
  // Dejar de escuchar el avance es asíncrono: tiene que terminar antes de
  // quitar los mocks, o falla fuera de la prueba.
  await settle();
  container.remove();
  clearMocks();
});

const chooseButton = () =>
  [...container.querySelectorAll("button")].find((one) => one.textContent === "Elegir CSV…")!;
const select = (label: string) =>
  container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
const rows = () => [...container.querySelectorAll<HTMLElement>("[data-row]")];
const button = (label: string) =>
  [...container.querySelectorAll("button")].find((one) => one.textContent === label);

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

  /** El criterio de la tarea: un PDF por fila con el nombre de un patrón. */
  it("genera con el patrón que propone, que se puede cambiar", async () => {
    await choose();
    const pattern = container.querySelector<HTMLInputElement>('input[aria-label="Patrón del nombre"]')!;
    expect(pattern.value).toBe("{{empresa}}.pdf");

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(pattern, "{{empresa}}-2026.pdf");
      pattern.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => button("Generar")!.click());
    await settle();

    const asking = asked.at(-1);
    expect(asking?.command).toBe("generate_batch");
    expect(asking?.args).toMatchObject({ combined: false, pattern: "{{empresa}}-2026.pdf" });
  });

  /** El criterio de la tarea: también un solo PDF con todas las filas. */
  it("puede pedir un solo PDF con todas", async () => {
    await choose();
    const both = [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')][1]!;
    act(() => both.click());
    act(() => button("Generar")!.click());
    await settle();

    expect(asked.at(-1)?.args).toMatchObject({ combined: true });
    // Sin nombre por fila: el archivo lo pregunta el diálogo.
    expect(container.querySelector('input[aria-label="Patrón del nombre"]')).toBeNull();
  });

  /** El criterio de la tarea: se ve el avance y se puede cancelar. */
  it("enseña por qué fila va y deja cancelar", async () => {
    await choose();
    act(() => button("Generar")!.click());
    await settle();

    await act(async () => {
      await emit(BatchEvents.progress, { done: 1, total: 2 });
    });
    expect(container.textContent).toContain("Generando… 1 de 2");
    expect(container.querySelector("progress")?.value).toBe(1);

    act(() => button("Cancelar")!.click());
    await settle();
    expect(asked.at(-1)?.command).toBe("cancel_batch");

    act(() => generation.resolve({ written: ["/p/Una.pdf"], failures: [], cancelled: true }));
    await settle();
    expect(container.textContent).toContain("1 documento generado");
    expect(container.textContent).toContain("cancelado antes de acabar");
  });

  /** El criterio de la tarea: una fila que falla no para el lote. */
  it("dice qué filas no salieron", async () => {
    await choose();
    act(() => button("Generar")!.click());
    await settle();
    act(() =>
      generation.resolve({
        written: ["/p/Una.pdf"],
        failures: [{ row: 2, message: "no es una fecha AAAA-MM-DD que exista" }],
        cancelled: false,
      }),
    );
    await settle();

    expect(container.textContent).toContain("1 documento generado");
    const failure = container.querySelector("[data-failure='2']");
    expect(failure?.textContent).toContain("Fila 2");
    expect(failure?.textContent).toContain("no es una fecha");
    // Y el botón vuelve: el lote acabó.
    expect(button("Generar")).toBeDefined();
  });
});
