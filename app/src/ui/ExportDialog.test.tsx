import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OpenedProject } from "../commands";
import { useDocumentStore } from "../store/document";
import { ExportDialog } from "./ExportDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const page = (id: string) => ({
  id,
  size: { width: 210, height: 297, unit: "mm" as const },
  elements: [],
});

const project: OpenedProject = {
  root: "/p",
  archive: null,
  revision: 1,
  document: {
    version: 1,
    meta: { title: "Informe" },
    fonts: [],
    assets: {},
    variables: {},
    pages: [page("p1"), page("p2"), page("p3")],
  },
};

let container: HTMLDivElement;
let root: Root;
let asked: Array<{ command: string; args: Record<string, unknown> }>;
let closed: number;
let done: string[];
/** Lo que contesta `export_as`. */
let answer: unknown;

beforeEach(() => {
  asked = [];
  closed = 0;
  done = [];
  answer = { paths: ["/p/Informe.pdf"], bytes: 1024 };
  mockIPC((command, args) => {
    asked.push({ command, args: args as Record<string, unknown> });
    if (command === "export_as") {
      return answer;
    }
    return null;
  });

  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useDocumentStore.getState().open(project);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <ExportDialog
        onClose={() => {
          closed += 1;
        }}
        onDone={(message) => done.push(message)}
      />,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMocks();
});

const button = (label: string) =>
  [...container.querySelectorAll("button")].find((one) => one.textContent === label);
const field = <T extends HTMLElement>(label: string) =>
  container.querySelector<T>(`[aria-label="${label}"]`);
const radio = (index: number) =>
  [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')][index]!;

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function set(element: HTMLInputElement | HTMLSelectElement, value: string) {
  act(() => {
    const prototype =
      element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", {
      bubbles: true,
    }));
  });
}

async function exportNow() {
  act(() => button("Exportar…")!.click());
  await settle();
}

describe("el diálogo de exportar", () => {
  /** El criterio de la tarea: los cuatro formatos. */
  it("ofrece PDF, SVG, PNG y .typ", () => {
    const options = [...container.querySelectorAll("option")].map((one) => one.value);
    expect(options).toEqual(["pdf", "svg", "png", "typ"]);
  });

  it("exporta a PDF todo el documento sin más", async () => {
    await exportNow();

    const asking = asked.at(-1);
    expect(asking?.command).toBe("export_as");
    expect(asking?.args).toEqual({ format: { format: "pdf" }, pages: { pages: "all" } });
    expect(done).toEqual(["Exportado a /p/Informe.pdf"]);
    expect(closed).toBe(1);
  });

  /** El criterio de la tarea: la densidad del PNG se elige. */
  it("la densidad solo sale con PNG, y se manda", async () => {
    expect(field("Densidad en puntos por pulgada")).toBeNull();

    set(field<HTMLSelectElement>("Formato")!, "png");
    const ppi = field<HTMLInputElement>("Densidad en puntos por pulgada")!;
    expect(ppi.value).toBe("300");
    set(ppi, "150");
    await exportNow();

    expect(asked.at(-1)?.args).toMatchObject({ format: { format: "png", ppi: 150 } });
  });

  /** El criterio de la tarea: la página actual, un rango o todo. */
  it("exporta la página que se está viendo", async () => {
    act(() => useDocumentStore.getState().setCurrentPage(2));
    // Se cuentan desde 1 al verlas; dentro, desde 0.
    expect(container.textContent).toContain("La página actual (3)");

    act(() => radio(1).click());
    await exportNow();
    expect(asked.at(-1)?.args).toMatchObject({ pages: { pages: "only", page: 3 } });
  });

  it("exporta un rango", async () => {
    act(() => radio(2).click());
    set(field<HTMLInputElement>("Primera página")!, "2");
    set(field<HTMLInputElement>("Última página")!, "3");
    await exportNow();

    expect(asked.at(-1)?.args).toMatchObject({ pages: { pages: "range", from: 2, to: 3 } });
  });

  it("dice cuántos archivos salieron cuando hay varios", async () => {
    answer = { paths: ["/p/Informe-1.svg", "/p/Informe-2.svg"], bytes: 2048 };
    set(field<HTMLSelectElement>("Formato")!, "svg");
    await exportNow();

    expect(done).toEqual(["2 archivos exportados junto a /p/Informe-1.svg"]);
  });

  it("si se cancela el diálogo del sistema no se dice nada", async () => {
    answer = null;
    await exportNow();

    expect(done).toEqual([]);
    expect(closed).toBe(0);
  });

  it("cancelar cierra sin exportar", () => {
    act(() => button("Cancelar")!.click());
    expect(closed).toBe(1);
    expect(asked).toEqual([]);
  });
});
